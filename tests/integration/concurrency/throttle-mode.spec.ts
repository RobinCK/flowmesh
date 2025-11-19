import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, UnlockAfter } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';
import { executeConcurrently } from '../../helpers/concurrent-execution';

enum ThrottleState {
  START = 'START',
  PROCESS = 'PROCESS',
  END = 'END',
}

interface ThrottleData extends Record<string, unknown> {
  userId: string;
  value: number;
}

interface ThrottleOutputs extends Record<string, unknown> {
  [ThrottleState.START]: { started: boolean };
  [ThrottleState.PROCESS]: { processed: boolean };
  [ThrottleState.END]: { completed: boolean };
}

@Workflow({
  name: 'ThrottleWorkflow',
  states: ThrottleState,
  initialState: ThrottleState.START,
  concurrency: {
    groupBy: 'userId',
    mode: ConcurrencyMode.THROTTLE,
    maxConcurrentAfterUnlock: 2,
  },
})
class ThrottleWorkflow {}

@State(ThrottleState.START)
@UnlockAfter()
class StartState implements IState<ThrottleData, ThrottleOutputs, ThrottleState.START> {
  execute(
    ctx: WorkflowContext<ThrottleData, ThrottleOutputs>,
    actions: StateActions<ThrottleData, ThrottleOutputs, ThrottleState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(ThrottleState.PROCESS)
class ProcessState implements IState<ThrottleData, ThrottleOutputs, ThrottleState.PROCESS> {
  execute(
    ctx: WorkflowContext<ThrottleData, ThrottleOutputs>,
    actions: StateActions<ThrottleData, ThrottleOutputs, ThrottleState.PROCESS>
  ) {
    actions.next({ output: { processed: true } });
  }
}

@State(ThrottleState.END)
class EndState implements IState<ThrottleData, ThrottleOutputs, ThrottleState.END> {
  execute(
    ctx: WorkflowContext<ThrottleData, ThrottleOutputs>,
    actions: StateActions<ThrottleData, ThrottleOutputs, ThrottleState.END>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Throttle Mode', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    const lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([new StartState(), new ProcessState(), new EndState()]);
  });

  it('should allow up to maxConcurrentAfterUnlock executions', async () => {
    const results = await executeConcurrently(2, async i => {
      return engine.execute(ThrottleWorkflow, {
        data: { userId: 'user1', value: i },
      });
    });

    // Both should succeed (maxConcurrentAfterUnlock = 2)
    const successes = results.filter(r => !r.error);
    expect(successes).toHaveLength(2);
  });

  it('should reject when limit exceeded', async () => {
    const results = await executeConcurrently(3, async i => {
      return engine.execute(ThrottleWorkflow, {
        data: { userId: 'user1', value: i },
      });
    });

    // Only 2 should succeed
    const successes = results.filter(r => !r.error);
    const failures = results.filter(r => r.error);

    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
  });

  it('should allow new execution after one completes', async () => {
    // Start first 2 executions
    await Promise.all([
      engine.execute(ThrottleWorkflow, { data: { userId: 'user1', value: 1 } }),
      engine.execute(ThrottleWorkflow, { data: { userId: 'user1', value: 2 } }),
    ]);

    // Third should now succeed (previous ones completed)
    const result3 = await engine.execute(ThrottleWorkflow, {
      data: { userId: 'user1', value: 3 },
    });

    expect(result3.status).toBe('completed');
  });

  it('should allow different groups independently', async () => {
    const results = await executeConcurrently(4, async i => {
      const userId = i < 2 ? 'user1' : 'user2';
      return engine.execute(ThrottleWorkflow, {
        data: { userId, value: i },
      });
    });

    // All should succeed (2 per group)
    const successes = results.filter(r => !r.error);
    expect(successes).toHaveLength(4);
  });

  it('should not call lock adapter (throttle is soft lock)', async () => {
    const lockAdapter = new InMemoryLockAdapter();
    const spy = jest.spyOn(lockAdapter, 'acquire');

    engine = new WorkflowEngine({ persistence, lockAdapter });
    StateRegistry.clear();
    StateRegistry.autoRegister([new StartState(), new ProcessState(), new EndState()]);

    await engine.execute(ThrottleWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
