import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';
import { executeConcurrently } from '../../helpers/concurrent-execution';

enum ParState {
  START = 'START',
  END = 'END',
}

interface ParData extends Record<string, unknown> {
  userId: string;
  value: number;
}

interface ParOutputs extends Record<string, unknown> {
  [ParState.START]: { started: boolean };
  [ParState.END]: { completed: boolean };
}

@Workflow({
  name: 'ParallelWorkflow',
  states: ParState,
  initialState: ParState.START,
  concurrency: {
    groupBy: 'userId',
    mode: ConcurrencyMode.PARALLEL,
  },
})
class ParallelWorkflow {}

@State(ParState.START)
class StartState implements IState<ParData, ParOutputs, ParState.START> {
  execute(ctx: WorkflowContext<ParData, ParOutputs>, actions: StateActions<ParData, ParOutputs, ParState.START>) {
    actions.next({ output: { started: true } });
  }
}

@State(ParState.END)
class EndState implements IState<ParData, ParOutputs, ParState.END> {
  execute(ctx: WorkflowContext<ParData, ParOutputs>, actions: StateActions<ParData, ParOutputs, ParState.END>) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Parallel Mode', () => {
  let engine: WorkflowEngine;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    const persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([new StartState(), new EndState()]);
  });

  it('should allow unlimited concurrent executions for same group', async () => {
    const results = await executeConcurrently(10, async i => {
      return engine.execute(ParallelWorkflow, {
        data: { userId: 'user1', value: i },
      });
    });

    // All should succeed
    const successes = results.filter(r => !r.error);
    expect(successes).toHaveLength(10);
  });

  it('should not call lock adapter', async () => {
    const spy = jest.spyOn(lockAdapter, 'acquire');

    await engine.execute(ParallelWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('should complete all executions successfully', async () => {
    const results = await executeConcurrently(5, async i => {
      return engine.execute(ParallelWorkflow, {
        data: { userId: 'user1', value: i },
      });
    });

    results.forEach(r => {
      expect(r.result?.status).toBe('completed');
    });
  });
});
