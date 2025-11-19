import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';

enum SharedWorkflowState {
  START = 'START',
  CALCULATING = 'CALCULATING',
  CALCULATING_RETRY = 'CALCULATING_RETRY',
  ADDING_HOLD = 'ADDING_HOLD',
  ADDING_HOLD_RETRY = 'ADDING_HOLD_RETRY',
  VALIDATING = 'VALIDATING',
  VALIDATING_RETRY = 'VALIDATING_RETRY',
  QUEUE = 'QUEUE',
  PROCESSING = 'PROCESSING',
  COMPLETE = 'COMPLETE',
}

interface SharedOutputs extends Record<string, unknown> {
  START: { initialized: boolean };
  CALCULATING: { calculated: number; attemptNumber: number };
  CALCULATING_RETRY: { calculated: number; attemptNumber: number };
  ADDING_HOLD: { holdAdded: boolean; attemptNumber: number };
  ADDING_HOLD_RETRY: { holdAdded: boolean; attemptNumber: number };
  VALIDATING: { validated: boolean; attemptNumber: number };
  VALIDATING_RETRY: { validated: boolean; attemptNumber: number };
  QUEUE: { queued: boolean };
  PROCESSING: { processed: boolean };
  COMPLETE: { completed: boolean };
}

interface SharedData extends Record<string, unknown> {
  amount: number;
  isFromQueue?: boolean;
}

// Shared state for both CALCULATING and CALCULATING_RETRY
@State([SharedWorkflowState.CALCULATING, SharedWorkflowState.CALCULATING_RETRY])
class CalculatingState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, any>) {
    const attemptNumber = ctx.currentState === SharedWorkflowState.CALCULATING ? 1 : 2;
    const calculated = ctx.data.amount * 0.95;

    actions.next({
      output: {
        calculated,
        attemptNumber,
      },
    });
  }
}

// Shared state for both ADDING_HOLD and ADDING_HOLD_RETRY
@State([SharedWorkflowState.ADDING_HOLD, SharedWorkflowState.ADDING_HOLD_RETRY])
class AddingHoldState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, any>) {
    const attemptNumber = ctx.currentState === SharedWorkflowState.ADDING_HOLD ? 1 : 2;

    actions.next({
      output: {
        holdAdded: true,
        attemptNumber,
      },
    });
  }
}

// Shared state for both VALIDATING and VALIDATING_RETRY
@State([SharedWorkflowState.VALIDATING, SharedWorkflowState.VALIDATING_RETRY])
class ValidatingState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, any>) {
    const attemptNumber = ctx.currentState === SharedWorkflowState.VALIDATING ? 1 : 2;

    actions.next({
      output: {
        validated: true,
        attemptNumber,
      },
    });
  }
}

@State(SharedWorkflowState.START)
class StartState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, 'START'>) {
    actions.next({ output: { initialized: true } });
  }
}

@State(SharedWorkflowState.QUEUE)
class QueueState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, 'QUEUE'>) {
    actions.next({
      data: { isFromQueue: true },
      output: { queued: true },
    });
  }
}

@State(SharedWorkflowState.PROCESSING)
class ProcessingState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, 'PROCESSING'>) {
    actions.next({ output: { processed: true } });
  }
}

@State(SharedWorkflowState.COMPLETE)
class CompleteState implements IState<SharedData, SharedOutputs> {
  execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, 'COMPLETE'>) {
    actions.complete({ output: { completed: true } });
  }
}

@Workflow({
  name: 'SharedStateWorkflow',
  states: SharedWorkflowState,
  initialState: SharedWorkflowState.START,
  transitions: [
    // First pass
    { from: [SharedWorkflowState.START], to: SharedWorkflowState.CALCULATING },
    { from: [SharedWorkflowState.CALCULATING], to: SharedWorkflowState.ADDING_HOLD },
    { from: [SharedWorkflowState.ADDING_HOLD], to: SharedWorkflowState.VALIDATING },
    { from: [SharedWorkflowState.VALIDATING], to: SharedWorkflowState.QUEUE },

    // Retry pass - same states with _RETRY suffix
    { from: [SharedWorkflowState.QUEUE], to: SharedWorkflowState.CALCULATING_RETRY },
    { from: [SharedWorkflowState.CALCULATING_RETRY], to: SharedWorkflowState.ADDING_HOLD_RETRY },
    { from: [SharedWorkflowState.ADDING_HOLD_RETRY], to: SharedWorkflowState.VALIDATING_RETRY },
    { from: [SharedWorkflowState.VALIDATING_RETRY], to: SharedWorkflowState.PROCESSING },

    // Final
    { from: [SharedWorkflowState.PROCESSING], to: SharedWorkflowState.COMPLETE },
  ],
})
class SharedStateWorkflow {}

describe('Integration: Shared State Classes', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    StateRegistry.clear();
    StateRegistry.autoRegister([
      new StartState(),
      new CalculatingState(),
      new AddingHoldState(),
      new ValidatingState(),
      new QueueState(),
      new ProcessingState(),
      new CompleteState(),
    ]);

    engine = new WorkflowEngine();
    engine.registerWorkflow(SharedStateWorkflow);
  });

  afterEach(() => {
    StateRegistry.clear();
  });

  it('should execute workflow with shared state classes', async () => {
    const result = await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    });

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.currentState).toBe(SharedWorkflowState.COMPLETE);
  });

  it('should execute same state class twice with different state values', async () => {
    const result = (await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    })) as any;

    // First pass through CALCULATING
    expect(result.outputs.CALCULATING).toEqual({
      calculated: 950,
      attemptNumber: 1,
    });

    // Second pass through CALCULATING_RETRY (same class, different state)
    expect(result.outputs.CALCULATING_RETRY).toEqual({
      calculated: 950,
      attemptNumber: 2,
    });
  });

  it('should track separate outputs for each state', async () => {
    const result = (await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    })) as any;

    // All states should have separate outputs
    expect(result.outputs.CALCULATING).toBeDefined();
    expect(result.outputs.CALCULATING_RETRY).toBeDefined();
    expect(result.outputs.ADDING_HOLD).toBeDefined();
    expect(result.outputs.ADDING_HOLD_RETRY).toBeDefined();
    expect(result.outputs.VALIDATING).toBeDefined();
    expect(result.outputs.VALIDATING_RETRY).toBeDefined();

    // Verify attempt numbers are different
    expect(result.outputs.CALCULATING.attemptNumber).toBe(1);
    expect(result.outputs.CALCULATING_RETRY.attemptNumber).toBe(2);
  });

  it('should track complete history with both state passes', async () => {
    const result = await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    });

    // Should have transitions through both CALCULATING and CALCULATING_RETRY
    const calculatingTransitions = result.history.filter(
      t => t.to === SharedWorkflowState.CALCULATING || t.to === SharedWorkflowState.CALCULATING_RETRY
    );

    expect(calculatingTransitions.length).toBe(2);
    expect(calculatingTransitions[0].to).toBe(SharedWorkflowState.CALCULATING);
    expect(calculatingTransitions[1].to).toBe(SharedWorkflowState.CALCULATING_RETRY);
  });

  it('should use context.currentState to determine which state is active', async () => {
    const result = (await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    })) as any;

    // The shared CalculatingState uses ctx.currentState to determine attemptNumber
    // First pass: currentState = CALCULATING, attemptNumber = 1
    // Second pass: currentState = CALCULATING_RETRY, attemptNumber = 2

    expect(result.outputs.CALCULATING.attemptNumber).toBe(1);
    expect(result.outputs.CALCULATING_RETRY.attemptNumber).toBe(2);
  });

  it('should allow different logic paths based on currentState', async () => {
    @State([SharedWorkflowState.CALCULATING, SharedWorkflowState.CALCULATING_RETRY])
    class ConditionalCalculatingState implements IState<SharedData, SharedOutputs> {
      execute(ctx: WorkflowContext<SharedData, SharedOutputs>, actions: StateActions<SharedData, SharedOutputs, any>) {
        let calculated: number;

        if (ctx.currentState === SharedWorkflowState.CALCULATING) {
          // First pass - normal calculation
          calculated = ctx.data.amount * 0.95;
        } else {
          // Retry pass - different calculation
          calculated = ctx.data.amount * 0.9;
        }

        actions.next({
          output: {
            calculated,
            attemptNumber: ctx.currentState === SharedWorkflowState.CALCULATING ? 1 : 2,
          },
        });
      }
    }

    StateRegistry.clear();
    StateRegistry.autoRegister([
      new StartState(),
      new ConditionalCalculatingState(),
      new AddingHoldState(),
      new ValidatingState(),
      new QueueState(),
      new ProcessingState(),
      new CompleteState(),
    ]);

    const result = (await engine.execute(SharedStateWorkflow, {
      data: { amount: 1000 },
    })) as any;

    expect(result.outputs.CALCULATING.calculated).toBe(950); // First pass: 95%
    expect(result.outputs.CALCULATING_RETRY.calculated).toBe(900); // Retry: 90%
  });
});
