import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { ResumeStrategy } from '../../../src/core/workflow-executor';
import { PostgresPersistenceAdapter } from '../../helpers/postgres-persistence.adapter';
import { TestContainers } from '../../helpers/test-containers';
import { Pool } from 'pg';

enum SuspendState {
  START = 'START',
  WAITING = 'WAITING',
  RESUME = 'RESUME',
  COMPLETE = 'COMPLETE',
}

interface SuspendData extends Record<string, unknown> {
  userId: string;
  payment: {
    amount: number;
    status: 'pending' | 'approved' | 'rejected';
  };
}

interface SuspendOutputs extends Record<string, unknown> {
  [SuspendState.START]: { started: boolean };
  [SuspendState.WAITING]: { waiting: boolean };
  [SuspendState.RESUME]: { resumed: boolean };
  [SuspendState.COMPLETE]: { completed: boolean };
}

@Workflow({
  name: 'SuspendResumeWorkflow',
  states: SuspendState,
  initialState: SuspendState.START,
})
class SuspendResumeWorkflow {}

@State(SuspendState.START)
class StartState implements IState<SuspendData, SuspendOutputs, SuspendState.START> {
  execute(
    ctx: WorkflowContext<SuspendData, SuspendOutputs>,
    actions: StateActions<SuspendData, SuspendOutputs, SuspendState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(SuspendState.WAITING)
class WaitingState implements IState<SuspendData, SuspendOutputs, SuspendState.WAITING> {
  execute(
    ctx: WorkflowContext<SuspendData, SuspendOutputs>,
    actions: StateActions<SuspendData, SuspendOutputs, SuspendState.WAITING>
  ) {
    if (ctx.data.payment.status === 'pending') {
      // Suspend workflow until payment is approved
      actions.suspend({
        waitingFor: 'payment_approval',
        output: { waiting: true },
      });
    } else {
      actions.next({ output: { waiting: false } });
    }
  }
}

@State(SuspendState.RESUME)
class ResumeState implements IState<SuspendData, SuspendOutputs, SuspendState.RESUME> {
  execute(
    ctx: WorkflowContext<SuspendData, SuspendOutputs>,
    actions: StateActions<SuspendData, SuspendOutputs, SuspendState.RESUME>
  ) {
    actions.next({ output: { resumed: true } });
  }
}

@State(SuspendState.COMPLETE)
class CompleteState implements IState<SuspendData, SuspendOutputs, SuspendState.COMPLETE> {
  execute(
    ctx: WorkflowContext<SuspendData, SuspendOutputs>,
    actions: StateActions<SuspendData, SuspendOutputs, SuspendState.COMPLETE>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: PostgreSQL Suspend/Resume', () => {
  let pool: Pool;
  let adapter: PostgresPersistenceAdapter;
  let engine: WorkflowEngine;

  beforeAll(async () => {
    const { pool: pgPool } = await TestContainers.startPostgres();
    pool = pgPool;
  }, 60000);

  beforeEach(async () => {
    await TestContainers.cleanupPostgres();
    StateRegistry.clear();
    adapter = new PostgresPersistenceAdapter(pool);
    engine = new WorkflowEngine({ persistence: adapter });
    StateRegistry.autoRegister([new StartState(), new WaitingState(), new ResumeState(), new CompleteState()]);
  });

  afterAll(async () => {
    await TestContainers.stopAll();
  }, 30000);

  describe('suspend workflow', () => {
    it('should suspend workflow with pending payment', async () => {
      const result = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-1',
          payment: { amount: 100, status: 'pending' },
        },
      });

      expect(result.status).toBe('suspended');
      expect(result.suspension).toBeDefined();
      expect(result.suspension?.waitingFor).toBe('payment_approval');
      expect(result.currentState).toBe(SuspendState.WAITING);
    });

    it('should persist suspended workflow to database', async () => {
      const result = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-2',
          payment: { amount: 200, status: 'pending' },
        },
      });

      // Load from database
      const dbResult = await pool.query('SELECT * FROM workflow_executions WHERE id = $1', [result.id]);

      expect(dbResult.rows).toHaveLength(1);
      expect(dbResult.rows[0].status).toBe('suspended');
      expect(dbResult.rows[0].suspension).toBeDefined();
      expect(dbResult.rows[0].suspension.waitingFor).toBe('payment_approval');
    });

    it('should track suspension timestamp', async () => {
      const result = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-3',
          payment: { amount: 300, status: 'pending' },
        },
      });

      expect(result.suspension?.suspendedAt).toBeInstanceOf(Date);
    });
  });

  describe('resume workflow', () => {
    it('should resume suspended workflow with updated data', async () => {
      // First, suspend the workflow
      const suspended = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-4',
          payment: { amount: 400, status: 'pending' },
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);

      // Manually update the data in persistence to simulate external approval
      await adapter.update(suspended.id, {
        data: {
          userId: suspended.data.userId,
          payment: { amount: 400, status: 'approved' as const },
        },
      });

      // Resume without passing data (will use data from DB)
      const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id);

      expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
      expect((resumed.data as SuspendData).payment.status).toBe('approved');
      expect(resumed.suspension).toBeUndefined();
    });

    it('should continue from suspended state', async () => {
      const suspended = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-5',
          payment: { amount: 500, status: 'pending' },
        },
      });

      expect(suspended.currentState).toBe(SuspendState.WAITING);

      // Update data in DB first
      await adapter.update(suspended.id, {
        data: {
          userId: suspended.data.userId,
          payment: { amount: 500, status: 'approved' as const },
        },
      });

      const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id);

      expect(resumed.currentState).toBe(SuspendState.COMPLETE);
      expect(resumed.history.length).toBeGreaterThan(suspended.history.length);
    });

    it('should throw error when resuming non-existent execution', async () => {
      // Register workflow first
      engine.registerWorkflow(SuspendResumeWorkflow);

      await expect(engine.resume(SuspendResumeWorkflow, 'non-existent-id')).rejects.toThrow(
        'Execution non-existent-id not found'
      );
    });

    it('should throw error when resuming non-suspended workflow', async () => {
      const completed = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-6',
          payment: { amount: 600, status: 'approved' },
        },
      });

      expect(completed.status).toBe(WorkflowStatus.COMPLETED);

      await expect(engine.resume(SuspendResumeWorkflow, completed.id)).rejects.toThrow(
        `Execution ${completed.id} is not suspended`
      );
    });

    it('should preserve execution history after resume', async () => {
      const suspended = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-7',
          payment: { amount: 700, status: 'pending' },
        },
      });

      const suspendedHistoryLength = suspended.history.length;

      // Update data before resume
      await adapter.update(suspended.id, {
        data: {
          userId: suspended.data.userId,
          payment: { amount: 700, status: 'approved' as const },
        },
      });

      const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id);

      expect(resumed.history.length).toBeGreaterThan(suspendedHistoryLength);
      // Check that suspended transition is in history
      const suspendedTransition = resumed.history.find(t => t.status === 'suspended');
      expect(suspendedTransition).toBeDefined();
    });
  });

  describe('find suspended workflows', () => {
    it('should find all suspended workflows', async () => {
      // Create multiple suspended workflows
      await engine.execute(SuspendResumeWorkflow, {
        data: { userId: 'user-8', payment: { amount: 100, status: 'pending' } },
      });
      await engine.execute(SuspendResumeWorkflow, {
        data: { userId: 'user-9', payment: { amount: 200, status: 'pending' } },
      });
      await engine.execute(SuspendResumeWorkflow, {
        data: { userId: 'user-10', payment: { amount: 300, status: 'approved' } },
      });

      const suspended = await adapter.find({ status: WorkflowStatus.SUSPENDED });

      expect(suspended.length).toBeGreaterThanOrEqual(2);
      suspended.forEach(exec => {
        expect(exec.status).toBe(WorkflowStatus.SUSPENDED);
        expect(exec.suspension).toBeDefined();
      });
    });

    it('should find suspended workflows by current state', async () => {
      await engine.execute(SuspendResumeWorkflow, {
        data: { userId: 'user-11', payment: { amount: 150, status: 'pending' } },
      });

      const suspended = await adapter.find({
        status: WorkflowStatus.SUSPENDED,
        currentState: SuspendState.WAITING,
      });

      expect(suspended.length).toBeGreaterThan(0);
      suspended.forEach(exec => {
        expect(exec.currentState).toBe(SuspendState.WAITING);
      });
    });
  });

  describe('bulk suspend/resume operations', () => {
    it('should handle multiple suspended workflows', async () => {
      const executions = await Promise.all([
        engine.execute(SuspendResumeWorkflow, {
          data: { userId: 'bulk-1', payment: { amount: 100, status: 'pending' } },
        }),
        engine.execute(SuspendResumeWorkflow, {
          data: { userId: 'bulk-2', payment: { amount: 200, status: 'pending' } },
        }),
        engine.execute(SuspendResumeWorkflow, {
          data: { userId: 'bulk-3', payment: { amount: 300, status: 'pending' } },
        }),
      ]);

      executions.forEach(exec => {
        expect(exec.status).toBe('suspended');
      });

      // Update all and then resume
      await Promise.all(
        executions.map(exec =>
          adapter.update(exec.id, {
            data: {
              userId: exec.data.userId,
              payment: { amount: exec.data.payment.amount, status: 'approved' as const },
            },
          })
        )
      );

      const resumed = await Promise.all(executions.map(exec => engine.resume(SuspendResumeWorkflow, exec.id)));

      resumed.forEach(exec => {
        expect(exec.status).toBe('completed');
      });
    });
  });

  describe('suspension metadata', () => {
    it('should store custom suspension metadata', async () => {
      const result = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-meta',
          payment: { amount: 999, status: 'pending' },
        },
      });

      expect(result.suspension?.waitingFor).toBe('payment_approval');

      // Load from DB and verify metadata is preserved
      const loaded = await adapter.load(result.id);
      expect(loaded?.suspension?.waitingFor).toBe('payment_approval');
    });

    it('should clear suspension metadata after resume', async () => {
      const suspended = await engine.execute(SuspendResumeWorkflow, {
        data: {
          userId: 'user-clear',
          payment: { amount: 888, status: 'pending' },
        },
      });

      expect(suspended.suspension).toBeDefined();

      // Update data
      await adapter.update(suspended.id, {
        data: {
          userId: suspended.data.userId,
          payment: { amount: 888, status: 'approved' as const },
        },
      });

      const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id);

      expect(resumed.suspension).toBeUndefined();

      // Verify in DB
      const dbResult = await pool.query('SELECT suspension FROM workflow_executions WHERE id = $1', [resumed.id]);
      expect(dbResult.rows[0].suspension).toBeNull();
    });
  });

  describe('resume strategies', () => {
    describe('RETRY strategy', () => {
      it('should re-execute suspended state with RETRY strategy (default)', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'retry-1',
            payment: { amount: 1000, status: 'pending' },
          },
        });

        expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);
        expect(suspended.currentState).toBe(SuspendState.WAITING);

        await adapter.update(suspended.id, {
          data: {
            userId: suspended.data.userId,
            payment: { amount: 1000, status: 'approved' as const },
          },
        });

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.RETRY,
        });

        expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
        expect(resumed.currentState).toBe(SuspendState.COMPLETE);
      });

      it('should work without explicit strategy (defaults to RETRY)', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'retry-2',
            payment: { amount: 2000, status: 'pending' },
          },
        });

        await adapter.update(suspended.id, {
          data: {
            userId: suspended.data.userId,
            payment: { amount: 2000, status: 'approved' as const },
          },
        });

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id);

        expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
      });
    });

    describe('SKIP strategy', () => {
      it('should skip suspended state and move to next with SKIP strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'skip-1',
            payment: { amount: 3000, status: 'pending' },
          },
        });

        expect(suspended.currentState).toBe(SuspendState.WAITING);

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.SKIP,
        });

        expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
        expect(resumed.currentState).toBe(SuspendState.COMPLETE);

        const skipTransition = resumed.history.find(t => t.from === SuspendState.WAITING && t.to === SuspendState.RESUME);
        expect(skipTransition).toBeDefined();
        expect(skipTransition?.duration).toBe(0);
      });

      it('should complete workflow if SKIP leads to no next state', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'skip-2',
            payment: { amount: 4000, status: 'pending' },
          },
        });

        await adapter.update(suspended.id, {
          data: {
            userId: suspended.data.userId,
            payment: { amount: 4000, status: 'approved' as const },
          },
        });

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.RETRY,
        });

        expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
        expect(resumed.currentState).toBe(SuspendState.COMPLETE);

        const resumedAgain = await adapter.load(resumed.id);
        expect(resumedAgain?.status).toBe(WorkflowStatus.COMPLETED);
      });

      it('should update data when using SKIP strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'skip-3',
            payment: { amount: 5000, status: 'pending' },
          },
        });

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.SKIP,
          data: { payment: { amount: 5500, status: 'approved' as const } },
        });

        expect(resumed.data.payment.amount).toBe(5500);
        expect(resumed.data.payment.status).toBe('approved');
      });
    });

    describe('GOTO strategy', () => {
      it('should jump to specific state with GOTO strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'goto-1',
            payment: { amount: 6000, status: 'pending' },
          },
        });

        expect(suspended.currentState).toBe(SuspendState.WAITING);

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.GOTO,
          targetState: SuspendState.COMPLETE,
        });

        expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
        expect(resumed.currentState).toBe(SuspendState.COMPLETE);

        const gotoTransition = resumed.history.find(t => t.from === SuspendState.WAITING && t.to === SuspendState.COMPLETE);
        expect(gotoTransition).toBeDefined();
      });

      it('should throw error if targetState not provided with GOTO strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'goto-2',
            payment: { amount: 7000, status: 'pending' },
          },
        });

        await expect(
          engine.resume(SuspendResumeWorkflow, suspended.id, {
            strategy: ResumeStrategy.GOTO,
          })
        ).rejects.toThrow('targetState is required for GOTO strategy');
      });

      it('should throw error if targetState does not exist', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'goto-3',
            payment: { amount: 8000, status: 'pending' },
          },
        });

        await expect(
          engine.resume(SuspendResumeWorkflow, suspended.id, {
            strategy: ResumeStrategy.GOTO,
            targetState: 'NON_EXISTENT_STATE',
          })
        ).rejects.toThrow('Target state not found: NON_EXISTENT_STATE');
      });

      it('should update data when using GOTO strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'goto-4',
            payment: { amount: 9000, status: 'pending' },
          },
        });

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.GOTO,
          targetState: SuspendState.RESUME,
          data: { payment: { amount: 9500, status: 'approved' as const } },
        });

        expect(resumed.data.payment.amount).toBe(9500);
        expect(resumed.data.payment.status).toBe('approved');
      });
    });

    describe('strategy with history', () => {
      it('should preserve history with SKIP strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'history-1',
            payment: { amount: 10000, status: 'pending' },
          },
        });

        const historyLengthBefore = suspended.history.length;

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.SKIP,
        });

        expect(resumed.history.length).toBeGreaterThan(historyLengthBefore);

        const skipTransition = resumed.history.find(t => t.from === SuspendState.WAITING && t.to === SuspendState.RESUME);
        expect(skipTransition).toBeDefined();
        expect(skipTransition?.status).toBe('success');
      });

      it('should preserve history with GOTO strategy', async () => {
        const suspended = await engine.execute(SuspendResumeWorkflow, {
          data: {
            userId: 'history-2',
            payment: { amount: 11000, status: 'pending' },
          },
        });

        const historyLengthBefore = suspended.history.length;

        const resumed = await engine.resume(SuspendResumeWorkflow, suspended.id, {
          strategy: ResumeStrategy.GOTO,
          targetState: SuspendState.COMPLETE,
        });

        expect(resumed.history.length).toBeGreaterThan(historyLengthBefore);

        const gotoTransition = resumed.history.find(t => t.from === SuspendState.WAITING && t.to === SuspendState.COMPLETE);
        expect(gotoTransition).toBeDefined();
        expect(gotoTransition?.status).toBe('success');
      });
    });
  });
});
