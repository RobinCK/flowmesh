import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, UnlockAfter } from '../../../src/decorators/state.decorator';
import {
  WorkflowContext,
  StateActions,
  IState,
  ConcurrencyMode,
  PersistenceAdapter,
  WorkflowExecution,
  ExecutionFilter,
  WorkflowStatus,
} from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

enum LeakState {
  START = 'START',
  PROCESS = 'PROCESS',
  END = 'END',
}

interface LeakData extends Record<string, unknown> {
  userId: string;
  value: number;
}

interface LeakOutputs extends Record<string, unknown> {
  [LeakState.START]: { started: boolean };
  [LeakState.PROCESS]: { processed: boolean };
  [LeakState.END]: { completed: boolean };
}

@Workflow({
  name: 'LeakTestWorkflow',
  states: LeakState,
  initialState: LeakState.START,
  concurrency: {
    groupBy: 'userId',
    mode: ConcurrencyMode.THROTTLE,
    maxConcurrentAfterUnlock: 2,
  },
})
class LeakTestWorkflow {}

@State(LeakState.START)
@UnlockAfter()
class StartState implements IState<LeakData, LeakOutputs, LeakState.START> {
  execute(ctx: WorkflowContext<LeakData, LeakOutputs>, actions: StateActions<LeakData, LeakOutputs, LeakState.START>) {
    actions.next({ output: { started: true } });
  }
}

@State(LeakState.PROCESS)
class ProcessState implements IState<LeakData, LeakOutputs, LeakState.PROCESS> {
  execute(ctx: WorkflowContext<LeakData, LeakOutputs>, actions: StateActions<LeakData, LeakOutputs, LeakState.PROCESS>) {
    actions.suspend({ output: { processed: true }, waitingFor: 'webhook' });
  }
}

@State(LeakState.END)
class EndState implements IState<LeakData, LeakOutputs, LeakState.END> {
  execute(ctx: WorkflowContext<LeakData, LeakOutputs>, actions: StateActions<LeakData, LeakOutputs, LeakState.END>) {
    actions.next({ output: { completed: true } });
  }
}

class FailingPersistenceAdapter implements PersistenceAdapter {
  private delegate = new InMemoryPersistenceAdapter();
  shouldFailOnSave = false;
  shouldFailOnUpdate = false;

  async save(execution: WorkflowExecution): Promise<void> {
    if (this.shouldFailOnSave) {
      throw new Error('Database connection timeout');
    }
    return this.delegate.save(execution);
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    return this.delegate.load(executionId);
  }

  async update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void> {
    if (this.shouldFailOnUpdate) {
      throw new Error('Database connection timeout');
    }
    return this.delegate.update(executionId, updates);
  }

  async find(filter: ExecutionFilter): Promise<WorkflowExecution[]> {
    return this.delegate.find(filter);
  }
}

function createEngine(persistence: PersistenceAdapter): WorkflowEngine {
  return new WorkflowEngine({ persistence, lockAdapter: new InMemoryLockAdapter() });
}

describe('Integration: Throttle Lock Leak', () => {
  let persistence: FailingPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new FailingPersistenceAdapter();
    StateRegistry.autoRegister([new StartState(), new ProcessState(), new EndState()]);
  });

  it('should not leak throttle slot when persistence.save() fails in execute()', async () => {
    const engine = createEngine(persistence);

    persistence.shouldFailOnSave = true;

    for (let i = 0; i < 2; i++) {
      try {
        await engine.execute(LeakTestWorkflow, {
          data: { userId: 'user1', value: i },
        });
      } catch {
        // expected: persistence.save() throws
      }
    }

    persistence.shouldFailOnSave = false;

    const result = await engine.execute(LeakTestWorkflow, {
      data: { userId: 'user1', value: 99 },
    });

    expect(result.status).toBe(WorkflowStatus.SUSPENDED);
  });

  it('should not leak throttle slot when persistence.update() fails in resume()', async () => {
    const engine1 = createEngine(persistence);

    const w1 = await engine1.execute(LeakTestWorkflow, {
      data: { userId: 'user1', value: 1 },
    });
    const w2 = await engine1.execute(LeakTestWorkflow, {
      data: { userId: 'user1', value: 2 },
    });

    expect(w1.status).toBe(WorkflowStatus.SUSPENDED);
    expect(w2.status).toBe(WorkflowStatus.SUSPENDED);

    const engine2 = createEngine(persistence);
    engine2.registerWorkflow(LeakTestWorkflow);

    persistence.shouldFailOnUpdate = true;

    for (const w of [w1, w2]) {
      try {
        await engine2.resume(LeakTestWorkflow, w.id);
      } catch {
        // expected: persistence.update() throws
      }
    }

    persistence.shouldFailOnUpdate = false;

    const result = await engine2.execute(LeakTestWorkflow, {
      data: { userId: 'user1', value: 99 },
    });

    expect(result.status).toBe(WorkflowStatus.SUSPENDED);
  });

  it('should not accumulate leaked slots causing permanent throttle block', async () => {
    const engine = createEngine(persistence);

    persistence.shouldFailOnSave = true;

    for (let i = 0; i < 10; i++) {
      try {
        await engine.execute(LeakTestWorkflow, {
          data: { userId: 'user1', value: i },
        });
      } catch {
        // expected
      }
    }

    persistence.shouldFailOnSave = false;

    const results = await Promise.all([
      engine.execute(LeakTestWorkflow, { data: { userId: 'user1', value: 100 } }),
      engine.execute(LeakTestWorkflow, { data: { userId: 'user1', value: 101 } }),
    ]);

    expect(results[0].status).toBe(WorkflowStatus.SUSPENDED);
    expect(results[1].status).toBe(WorkflowStatus.SUSPENDED);
  });
});
