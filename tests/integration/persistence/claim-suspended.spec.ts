import {
  ConcurrencyMode,
  ExecutionFilter,
  IState,
  InMemoryLockAdapter,
  InMemoryPersistenceAdapter,
  PersistenceAdapter,
  State,
  StateActions,
  StateRegistry,
  Workflow,
  WorkflowContext,
  WorkflowEngine,
  WorkflowExecution,
  WorkflowStatus,
} from '../../../src';

enum ClaimState {
  START = 'CLAIM_START',
  WAITING = 'CLAIM_WAITING',
  DONE = 'CLAIM_DONE',
}

interface ClaimData extends Record<string, unknown> {
  merchantId: string;
  resumeSignal?: boolean;
}

interface ClaimOutputs extends Record<string, unknown> {
  [ClaimState.START]: { started: boolean };
  [ClaimState.WAITING]: { waited: boolean };
  [ClaimState.DONE]: { done: boolean };
}

@Workflow({
  name: 'ClaimWorkflow',
  states: ClaimState,
  initialState: ClaimState.START,
  concurrency: {
    groupBy: 'merchantId',
    mode: ConcurrencyMode.THROTTLE,
    maxConcurrentAfterUnlock: 10,
  },
})
class ClaimWorkflow {}

@State(ClaimState.START)
class ClaimStartState implements IState<ClaimData, ClaimOutputs, ClaimState.START> {
  execute(_ctx: WorkflowContext<ClaimData, ClaimOutputs>, actions: StateActions<ClaimData, ClaimOutputs, ClaimState.START>) {
    actions.next({ output: { started: true } });
  }
}

@State(ClaimState.WAITING)
class ClaimWaitingState implements IState<ClaimData, ClaimOutputs, ClaimState.WAITING> {
  execute(ctx: WorkflowContext<ClaimData, ClaimOutputs>, actions: StateActions<ClaimData, ClaimOutputs, ClaimState.WAITING>) {
    if (!ctx.data.resumeSignal) {
      actions.suspend({ waitingFor: 'webhook', output: { waited: true } });

      return;
    }

    actions.next({ output: { waited: true } });
  }
}

@State(ClaimState.DONE)
class ClaimDoneState implements IState<ClaimData, ClaimOutputs, ClaimState.DONE> {
  execute(_ctx: WorkflowContext<ClaimData, ClaimOutputs>, actions: StateActions<ClaimData, ClaimOutputs, ClaimState.DONE>) {
    actions.complete({ output: { done: true } });
  }
}

/**
 * Mirrors a SQL adapter: claimSuspended is the only way to leave the suspended state,
 * and it succeeds for exactly one caller.
 */
class ClaimingPersistenceAdapter implements PersistenceAdapter {
  private readonly delegate = new InMemoryPersistenceAdapter();
  private readonly statuses = new Map<string, WorkflowStatus>();

  claimAttempts = 0;

  async save(execution: WorkflowExecution): Promise<void> {
    this.statuses.set(execution.id, execution.status);

    return this.delegate.save(execution);
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    return this.delegate.load(executionId);
  }

  async update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void> {
    if (updates.status !== undefined) {
      this.statuses.set(executionId, updates.status);
    }

    return this.delegate.update(executionId, updates);
  }

  async find(filter: ExecutionFilter): Promise<WorkflowExecution[]> {
    return this.delegate.find(filter);
  }

  async claimSuspended(executionId: string): Promise<boolean> {
    this.claimAttempts++;

    // The compare and the set must not be separated by an await, otherwise this double
    // reproduces the very race it stands in for. A SQL adapter gets that from the row lock
    // taken by UPDATE ... WHERE status = 'suspended'.
    if (this.statuses.get(executionId) !== WorkflowStatus.SUSPENDED) {
      return false;
    }

    this.statuses.set(executionId, WorkflowStatus.RUNNING);

    await this.delegate.update(executionId, { status: WorkflowStatus.RUNNING });

    return true;
  }
}

describe('Atomic resume via claimSuspended', () => {
  let persistence: ClaimingPersistenceAdapter;
  let engine: WorkflowEngine;

  const merchantId = 'merchant-1';

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new ClaimingPersistenceAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter: new InMemoryLockAdapter() });
    StateRegistry.autoRegister([new ClaimStartState(), new ClaimWaitingState(), new ClaimDoneState()]);
    engine.registerWorkflow(ClaimWorkflow);
  });

  const suspend = async (): Promise<WorkflowExecution> => {
    const execution = await engine.execute(ClaimWorkflow, { data: { merchantId } });

    expect(execution.status).toBe(WorkflowStatus.SUSPENDED);

    return execution;
  };

  it('lets exactly one of two concurrent resumes through', async () => {
    const execution = await suspend();

    const results = await Promise.allSettled([
      engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } }),
      engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } }),
    ]);

    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('is not suspended');
  });

  it('does not let the loser roll the execution back to its stale snapshot', async () => {
    const execution = await suspend();

    await Promise.allSettled([
      engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } }),
      engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } }),
    ]);

    const stored = await persistence.load(execution.id);

    expect(stored?.status).toBe(WorkflowStatus.COMPLETED);
    expect(stored?.currentState).toBe(ClaimState.DONE);
    expect(stored?.suspension).toBeUndefined();
  });

  it('refuses a second resume once the first has completed the execution', async () => {
    const execution = await suspend();

    await engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } });

    await expect(engine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } })).rejects.toThrow(
      'is not suspended'
    );
  });

  it('keeps working for adapters that do not implement claimSuspended', async () => {
    StateRegistry.clear();

    const plain = new InMemoryPersistenceAdapter();
    const plainEngine = new WorkflowEngine({ persistence: plain, lockAdapter: new InMemoryLockAdapter() });

    StateRegistry.autoRegister([new ClaimStartState(), new ClaimWaitingState(), new ClaimDoneState()]);
    plainEngine.registerWorkflow(ClaimWorkflow);

    const execution = await plainEngine.execute(ClaimWorkflow, { data: { merchantId } });

    expect(execution.status).toBe(WorkflowStatus.SUSPENDED);

    const resumed = await plainEngine.resume(ClaimWorkflow, execution.id, { data: { resumeSignal: true } });

    expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
  });
});
