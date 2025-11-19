import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';
import { executeConcurrently } from '../../helpers/concurrent-execution';

enum SeqState {
  START = 'START',
  PROCESS = 'PROCESS',
  END = 'END',
}

interface SeqData extends Record<string, unknown> {
  userId: string;
  value: number;
}

interface SeqOutputs extends Record<string, unknown> {
  [SeqState.START]: { started: boolean };
  [SeqState.PROCESS]: { processed: boolean };
  [SeqState.END]: { completed: boolean };
}

@Workflow({
  name: 'SequentialWorkflow',
  states: SeqState,
  initialState: SeqState.START,
  concurrency: {
    groupBy: 'userId',
    mode: ConcurrencyMode.SEQUENTIAL,
  },
})
class SequentialWorkflow {}

@State(SeqState.START)
class StartState implements IState<SeqData, SeqOutputs, SeqState.START> {
  execute(ctx: WorkflowContext<SeqData, SeqOutputs>, actions: StateActions<SeqData, SeqOutputs, SeqState.START>) {
    actions.next({ output: { started: true } });
  }
}

@State(SeqState.PROCESS)
class ProcessState implements IState<SeqData, SeqOutputs, SeqState.PROCESS> {
  execute(ctx: WorkflowContext<SeqData, SeqOutputs>, actions: StateActions<SeqData, SeqOutputs, SeqState.PROCESS>) {
    actions.next({ output: { processed: true } });
  }
}

@State(SeqState.END)
class EndState implements IState<SeqData, SeqOutputs, SeqState.END> {
  execute(ctx: WorkflowContext<SeqData, SeqOutputs>, actions: StateActions<SeqData, SeqOutputs, SeqState.END>) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Sequential Mode', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([new StartState(), new ProcessState(), new EndState()]);
  });

  it('should allow first execution for a group', async () => {
    const result = await engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.groupId).toBe('user1');
  });

  it('should block second execution for same group', async () => {
    // Start first execution
    const exec1Promise = engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    // Try to start second execution immediately (should fail to acquire lock)
    await expect(
      engine.execute(SequentialWorkflow, {
        data: { userId: 'user1', value: 2 },
      })
    ).rejects.toThrow('Cannot acquire lock');

    // Wait for first to complete
    await exec1Promise;
  });

  it('should allow execution after previous completes', async () => {
    // First execution
    await engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    // Second execution should succeed after first completes
    const result2 = await engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 2 },
    });

    expect(result2.status).toBe('completed');
  });

  it('should allow different groups in parallel', async () => {
    const results = await executeConcurrently(3, async i => {
      return engine.execute(SequentialWorkflow, {
        data: { userId: `user${i}`, value: i },
      });
    });

    // All should succeed (different groups)
    const successes = results.filter(r => !r.error);
    expect(successes).toHaveLength(3);
  });

  it('should enforce lock for same group across concurrent attempts', async () => {
    const results = await executeConcurrently(5, async i => {
      return engine.execute(SequentialWorkflow, {
        data: { userId: 'user1', value: i },
      });
    });

    // Only one should succeed
    const successes = results.filter(r => !r.error);
    const failures = results.filter(r => r.error);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);

    // All failures should be lock errors
    failures.forEach(f => {
      expect(f.error?.message).toContain('Cannot acquire lock');
    });
  });

  it('should track execution in persistence', async () => {
    const result = await engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    const loaded = await persistence.load(result.id);
    expect(loaded).toBeDefined();
    expect(loaded?.groupId).toBe('user1');
    expect(loaded?.status).toBe('completed');
  });

  it('should release lock on completion', async () => {
    await engine.execute(SequentialWorkflow, {
      data: { userId: 'user1', value: 1 },
    });

    // Lock should be released, check adapter
    const isLocked = await lockAdapter.isLocked('workflow:group:user1');
    expect(isLocked).toBe(false);
  });
});
