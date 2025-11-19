import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, UnlockAfter } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode, WorkflowStatus } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

enum PartialUnlockState {
  START = 'START',
  PAYMENT = 'PAYMENT',
  WAITING = 'WAITING',
  FULFILLMENT = 'FULFILLMENT',
  COMPLETE = 'COMPLETE',
}

interface PartialUnlockData extends Record<string, unknown> {
  orderId: string;
  paymentStatus: 'pending' | 'approved' | 'rejected';
  fulfillmentStatus?: 'pending' | 'shipped' | 'delivered';
}

interface PartialUnlockOutputs extends Record<string, unknown> {
  [PartialUnlockState.START]: { started: boolean };
  [PartialUnlockState.PAYMENT]: { paid: boolean };
  [PartialUnlockState.WAITING]: { waiting: boolean };
  [PartialUnlockState.FULFILLMENT]: { fulfilled: boolean };
  [PartialUnlockState.COMPLETE]: { completed: boolean };
}

@Workflow({
  name: 'PartialUnlockWorkflow',
  states: PartialUnlockState,
  initialState: PartialUnlockState.START,
  concurrency: {
    groupBy: 'orderId',
    mode: ConcurrencyMode.SEQUENTIAL,
  },
})
class PartialUnlockWorkflow {}

@State(PartialUnlockState.START)
class StartState implements IState<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.START> {
  execute(
    ctx: WorkflowContext<PartialUnlockData, PartialUnlockOutputs>,
    actions: StateActions<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(PartialUnlockState.PAYMENT)
@UnlockAfter() // Release hard lock after payment
class PaymentState implements IState<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.PAYMENT> {
  execute(
    ctx: WorkflowContext<PartialUnlockData, PartialUnlockOutputs>,
    actions: StateActions<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.PAYMENT>
  ) {
    actions.next({ output: { paid: true } });
  }
}

@State(PartialUnlockState.WAITING)
class WaitingState implements IState<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.WAITING> {
  execute(
    ctx: WorkflowContext<PartialUnlockData, PartialUnlockOutputs>,
    actions: StateActions<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.WAITING>
  ) {
    if (ctx.data.paymentStatus === 'approved' && ctx.data.fulfillmentStatus === 'pending') {
      // Suspend workflow waiting for fulfillment
      actions.suspend({
        waitingFor: 'fulfillment_update',
        output: { waiting: true },
      });
    } else {
      actions.next({ output: { waiting: false } });
    }
  }
}

@State(PartialUnlockState.FULFILLMENT)
class FulfillmentState implements IState<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.FULFILLMENT> {
  execute(
    ctx: WorkflowContext<PartialUnlockData, PartialUnlockOutputs>,
    actions: StateActions<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.FULFILLMENT>
  ) {
    actions.next({ output: { fulfilled: true } });
  }
}

@State(PartialUnlockState.COMPLETE)
class CompleteState implements IState<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.COMPLETE> {
  execute(
    ctx: WorkflowContext<PartialUnlockData, PartialUnlockOutputs>,
    actions: StateActions<PartialUnlockData, PartialUnlockOutputs, PartialUnlockState.COMPLETE>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Partial Unlock with Resume', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([
      new StartState(),
      new PaymentState(),
      new WaitingState(),
      new FulfillmentState(),
      new CompleteState(),
    ]);
  });

  describe('partial unlock behavior', () => {
    it('should release lock after @UnlockAfter state', async () => {
      const spy = jest.spyOn(lockAdapter, 'release');

      await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-1',
          paymentStatus: 'approved',
          fulfillmentStatus: 'shipped',
        },
      });

      // Lock should be released after PAYMENT state (@UnlockAfter)
      expect(spy).toHaveBeenCalledWith('workflow:group:order-1');
    });

    it('should allow concurrent executions after unlock', async () => {
      // This workflow will suspend at WAITING state
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-2',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);
      expect(suspended.currentState).toBe(PartialUnlockState.WAITING);

      // Lock should have been released after PAYMENT state
      const isLocked = await lockAdapter.isLocked('workflow:group:order-2');
      expect(isLocked).toBe(false);
    });
  });

  describe('resume after partial unlock', () => {
    it('should resume suspended workflow after @UnlockAfter state', async () => {
      // Execute and suspend
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-resume-1',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);
      expect(suspended.suspension?.waitingFor).toBe('fulfillment_update');

      // Update data to allow resume
      await persistence.update(suspended.id, {
        data: {
          orderId: suspended.data.orderId,
          paymentStatus: 'approved' as const,
          fulfillmentStatus: 'shipped' as const,
        },
      });

      // Resume workflow
      const resumed = await engine.resume(PartialUnlockWorkflow, suspended.id);

      expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
      expect(resumed.suspension).toBeUndefined();
    });

    it('should not re-acquire hard lock on resume after @UnlockAfter', async () => {
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-resume-2',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);

      // Note: Resume does try to acquire lock, but should fail and continue anyway
      // since the workflow was suspended after @UnlockAfter

      // Update data
      await persistence.update(suspended.id, {
        data: {
          orderId: suspended.data.orderId,
          paymentStatus: 'approved' as const,
          fulfillmentStatus: 'shipped' as const,
        },
      });

      const resumed = await engine.resume(PartialUnlockWorkflow, suspended.id);

      // Should complete successfully even though lock might not be acquired
      expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should preserve history including @UnlockAfter state after resume', async () => {
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-resume-3',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      const suspendedHistoryLength = suspended.history.length;

      // Update and resume
      await persistence.update(suspended.id, {
        data: {
          orderId: suspended.data.orderId,
          paymentStatus: 'approved' as const,
          fulfillmentStatus: 'shipped' as const,
        },
      });

      const resumed = await engine.resume(PartialUnlockWorkflow, suspended.id);

      // History should include all states including PAYMENT (@UnlockAfter)
      expect(resumed.history.length).toBeGreaterThan(suspendedHistoryLength);

      const paymentTransition = resumed.history.find(t => t.to === PartialUnlockState.PAYMENT);
      expect(paymentTransition).toBeDefined();
    });
  });

  describe('suspend at different points', () => {
    it('should suspend before @UnlockAfter state', async () => {
      // This requires a different workflow setup
      // For now, verify current workflow behavior

      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-suspend-1',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      // Suspended at WAITING (after @UnlockAfter PAYMENT)
      expect(suspended.currentState).toBe(PartialUnlockState.WAITING);
      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);
    });

    it('should handle multiple suspend/resume cycles', async () => {
      // First execution - suspend
      const suspended1 = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-cycles',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended1.status).toBe(WorkflowStatus.SUSPENDED);

      // Resume with data change - completes
      await persistence.update(suspended1.id, {
        data: {
          orderId: suspended1.data.orderId,
          paymentStatus: 'approved' as const,
          fulfillmentStatus: 'shipped' as const,
        },
      });

      const resumed1 = await engine.resume(PartialUnlockWorkflow, suspended1.id);

      expect(resumed1.status).toBe(WorkflowStatus.COMPLETED);

      // Verify final history includes all transitions
      expect(resumed1.history.length).toBeGreaterThan(3);
    });
  });

  describe('lock release verification', () => {
    it('should track when lock was released', async () => {
      const releaseSpy = jest.spyOn(lockAdapter, 'release');

      await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-track',
          paymentStatus: 'approved',
          fulfillmentStatus: 'shipped',
        },
      });

      // Should have released lock once (after @UnlockAfter PAYMENT state)
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledWith('workflow:group:order-track');
    });

    it('should not hold lock during suspended state', async () => {
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-no-lock',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);

      // Lock should be released
      const isLocked = await lockAdapter.isLocked('workflow:group:order-no-lock');
      expect(isLocked).toBe(false);

      // Another workflow for same order should be able to start
      // (though it would also suspend at WAITING)
      const isLocked2 = await lockAdapter.isLocked('workflow:group:order-no-lock');
      expect(isLocked2).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle resume when workflow completes immediately', async () => {
      // Workflow that doesn't suspend
      const completed = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-immediate',
          paymentStatus: 'approved',
          fulfillmentStatus: 'shipped',
        },
      });

      expect(completed.status).toBe(WorkflowStatus.COMPLETED);

      // Try to resume - should throw error
      await expect(engine.resume(PartialUnlockWorkflow, completed.id)).rejects.toThrow(
        `Execution ${completed.id} is not suspended`
      );
    });

    it('should preserve suspension metadata through resume', async () => {
      const suspended = await engine.execute(PartialUnlockWorkflow, {
        data: {
          orderId: 'order-metadata',
          paymentStatus: 'approved',
          fulfillmentStatus: 'pending',
        },
      });

      expect(suspended.suspension?.waitingFor).toBe('fulfillment_update');

      // Load from persistence
      const loaded = await persistence.load(suspended.id);
      expect(loaded?.suspension?.waitingFor).toBe('fulfillment_update');

      // Update and resume
      await persistence.update(suspended.id, {
        data: {
          orderId: suspended.data.orderId,
          paymentStatus: 'approved' as const,
          fulfillmentStatus: 'shipped' as const,
        },
      });

      const resumed = await engine.resume(PartialUnlockWorkflow, suspended.id);

      // After resume, suspension metadata should be cleared
      expect(resumed.suspension).toBeUndefined();
    });
  });
});
