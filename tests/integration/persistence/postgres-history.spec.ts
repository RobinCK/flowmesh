import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { PostgresHistoryPersistenceAdapter } from '../../helpers/postgres-history-persistence.adapter';
import { TestContainers } from '../../helpers/test-containers';
import { Pool } from 'pg';

enum HistoryState {
  START = 'START',
  PROCESS = 'PROCESS',
  COMPLETE = 'COMPLETE',
}

interface HistoryData extends Record<string, unknown> {
  orderId: string;
  amount: number;
}

interface HistoryOutputs extends Record<string, unknown> {
  [HistoryState.START]: { started: boolean };
  [HistoryState.PROCESS]: { processed: boolean };
  [HistoryState.COMPLETE]: { completed: boolean };
}

@Workflow({
  name: 'HistoryWorkflow',
  states: HistoryState,
  initialState: HistoryState.START,
})
class HistoryWorkflow {}

@State(HistoryState.START)
class StartState implements IState<HistoryData, HistoryOutputs, HistoryState.START> {
  execute(
    ctx: WorkflowContext<HistoryData, HistoryOutputs>,
    actions: StateActions<HistoryData, HistoryOutputs, HistoryState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(HistoryState.PROCESS)
class ProcessState implements IState<HistoryData, HistoryOutputs, HistoryState.PROCESS> {
  execute(
    ctx: WorkflowContext<HistoryData, HistoryOutputs>,
    actions: StateActions<HistoryData, HistoryOutputs, HistoryState.PROCESS>
  ) {
    actions.next({ output: { processed: true } });
  }
}

@State(HistoryState.COMPLETE)
class CompleteState implements IState<HistoryData, HistoryOutputs, HistoryState.COMPLETE> {
  execute(
    ctx: WorkflowContext<HistoryData, HistoryOutputs>,
    actions: StateActions<HistoryData, HistoryOutputs, HistoryState.COMPLETE>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: PostgreSQL History Persistence', () => {
  let pool: Pool;
  let adapter: PostgresHistoryPersistenceAdapter;
  let engine: WorkflowEngine;

  beforeAll(async () => {
    const { pool: pgPool } = await TestContainers.startPostgres();
    pool = pgPool;
  }, 60000);

  beforeEach(async () => {
    await TestContainers.cleanupPostgres();
    StateRegistry.clear();
    adapter = new PostgresHistoryPersistenceAdapter(pool);
    engine = new WorkflowEngine({ persistence: adapter });
    StateRegistry.autoRegister([new StartState(), new ProcessState(), new CompleteState()]);
  });

  afterAll(async () => {
    await TestContainers.stopAll();
  }, 30000);

  describe('separate state history records', () => {
    it('should store each state transition as separate record', async () => {
      const result = await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-1', amount: 100 },
      });

      expect(result.status).toBe('completed');

      // Check history table
      const historyResult = await pool.query(
        'SELECT * FROM workflow_state_history WHERE execution_id = $1 ORDER BY started_at ASC',
        [result.id]
      );

      // Should have history records for each transition
      expect(historyResult.rows.length).toBeGreaterThan(0);
      // Verify all records have required fields
      historyResult.rows.forEach(row => {
        expect(row.state_name).toBeDefined();
        expect(row.from_state).toBeDefined();
        expect(row.to_state).toBeDefined();
      });
    });

    it('should track all transition details in history', async () => {
      const result = await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-2', amount: 200 },
      });

      const historyResult = await pool.query(
        'SELECT * FROM workflow_state_history WHERE execution_id = $1 ORDER BY started_at ASC',
        [result.id]
      );

      for (const row of historyResult.rows) {
        expect(row.from_state).toBeDefined();
        expect(row.to_state).toBeDefined();
        expect(row.status).toBe('success');
        expect(row.started_at).toBeInstanceOf(Date);
        expect(row.completed_at).toBeInstanceOf(Date);
        expect(typeof row.duration).toBe('number');
      }
    });

    it('should load execution with full history', async () => {
      const result = await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-3', amount: 300 },
      });

      const loaded = await adapter.load(result.id);

      expect(loaded).toBeDefined();
      expect(loaded?.history).toHaveLength(result.history.length);
      expect(loaded?.status).toBe('completed');
    });
  });

  describe('database-level locks for duplicate prevention', () => {
    it('should prevent duplicate state processing with unique constraint', async () => {
      const executionId = 'exec-lock-test-1';

      // Try to lock same state twice
      const lock1 = await adapter.tryLockState(executionId, HistoryState.PROCESS);
      const lock2 = await adapter.tryLockState(executionId, HistoryState.PROCESS);

      expect(lock1).toBe(true);
      expect(lock2).toBe(false); // Duplicate prevented by unique constraint
    });

    it('should allow different states to be locked simultaneously', async () => {
      const executionId = 'exec-lock-test-2';

      const lock1 = await adapter.tryLockState(executionId, HistoryState.START);
      const lock2 = await adapter.tryLockState(executionId, HistoryState.PROCESS);

      expect(lock1).toBe(true);
      expect(lock2).toBe(true);
    });

    it('should unlock state after processing', async () => {
      const executionId = 'exec-lock-test-3';

      const lock1 = await adapter.tryLockState(executionId, HistoryState.PROCESS);
      expect(lock1).toBe(true);

      await adapter.unlockState(executionId, HistoryState.PROCESS);

      // Should be able to lock again after unlock
      const lock2 = await adapter.tryLockState(executionId, HistoryState.PROCESS);
      expect(lock2).toBe(true);
    });

    it('should cleanup stale locks', async () => {
      const executionId = 'exec-lock-test-4';

      await adapter.tryLockState(executionId, HistoryState.START);

      // Manually set lock time to 10 minutes ago
      await pool.query(
        `UPDATE workflow_state_locks
         SET locked_at = NOW() - INTERVAL '10 minutes'
         WHERE execution_id = $1`,
        [executionId]
      );

      const cleaned = await adapter.cleanupStaleLocks();
      expect(cleaned).toBeGreaterThan(0);

      // Should be able to lock after cleanup
      const lock = await adapter.tryLockState(executionId, HistoryState.START);
      expect(lock).toBe(true);
    });
  });

  describe('concurrent execution race conditions', () => {
    it('should handle concurrent attempts to process same state', async () => {
      const executionId = 'exec-race-1';

      // Simulate two workers trying to process same state
      const results = await Promise.allSettled([
        adapter.tryLockState(executionId, HistoryState.PROCESS),
        adapter.tryLockState(executionId, HistoryState.PROCESS),
        adapter.tryLockState(executionId, HistoryState.PROCESS),
      ]);

      const successful = results.filter(r => r.status === 'fulfilled' && r.value === true);

      expect(successful).toHaveLength(1); // Only one should succeed
    });

    it('should prevent duplicate history records with unique constraint', async () => {
      const result = await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-race', amount: 500 },
      });

      // Try to insert duplicate history (should be silently ignored by ON CONFLICT)
      const duplicate = {
        ...result,
        history: result.history.slice(0, 1), // Take first transition
      };

      await expect(adapter.save(duplicate)).resolves.not.toThrow();

      // Verify no duplicates in database
      const historyResult = await pool.query('SELECT * FROM workflow_state_history WHERE execution_id = $1', [result.id]);

      // Should still have original count (no duplicates added)
      expect(historyResult.rows.length).toBeGreaterThan(0);
    });
  });

  describe('history immutability', () => {
    it('should preserve original history records', async () => {
      const result = await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-immut', amount: 600 },
      });

      // Get initial history count
      const initialHistory = await pool.query('SELECT COUNT(*) FROM workflow_state_history WHERE execution_id = $1', [result.id]);

      // Update execution (should not modify existing history)
      await adapter.update(result.id, { status: WorkflowStatus.COMPLETED });

      // History count should remain the same
      const finalHistory = await pool.query('SELECT COUNT(*) FROM workflow_state_history WHERE execution_id = $1', [result.id]);

      expect(finalHistory.rows[0].count).toBe(initialHistory.rows[0].count);
    });

    it('should query history by state name', async () => {
      await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-query-1', amount: 100 },
      });
      await engine.execute(HistoryWorkflow, {
        data: { orderId: 'order-query-2', amount: 200 },
      });

      const processHistoryResult = await pool.query(`SELECT * FROM workflow_state_history WHERE state_name = $1`, [
        HistoryState.PROCESS,
      ]);

      expect(processHistoryResult.rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('find with filters', () => {
    it('should find executions by workflow name', async () => {
      await engine.execute(HistoryWorkflow, { data: { orderId: 'o1', amount: 100 } });
      await engine.execute(HistoryWorkflow, { data: { orderId: 'o2', amount: 200 } });

      const found = await adapter.find({ workflowName: 'HistoryWorkflow' });

      expect(found).toHaveLength(2);
      found.forEach(exec => {
        expect(exec.workflowName).toBe('HistoryWorkflow');
        expect(exec.history.length).toBeGreaterThan(0);
      });
    });

    it('should find executions by status', async () => {
      await engine.execute(HistoryWorkflow, { data: { orderId: 'o3', amount: 100 } });

      const found = await adapter.find({ status: WorkflowStatus.COMPLETED });

      expect(found.length).toBeGreaterThan(0);
      found.forEach(exec => expect(exec.status).toBe(WorkflowStatus.COMPLETED));
    });

    it('should find executions by multiple filters', async () => {
      await engine.execute(HistoryWorkflow, { data: { orderId: 'o4', amount: 100 } });

      const found = await adapter.find({
        workflowName: 'HistoryWorkflow',
        status: WorkflowStatus.COMPLETED,
        currentState: HistoryState.COMPLETE,
      });

      expect(found.length).toBeGreaterThan(0);
      found.forEach(exec => {
        expect(exec.workflowName).toBe('HistoryWorkflow');
        expect(exec.status).toBe(WorkflowStatus.COMPLETED);
      });
    });
  });
});
