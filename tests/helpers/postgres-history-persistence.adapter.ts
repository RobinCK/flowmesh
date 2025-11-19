import { Pool, PoolClient } from 'pg';
import { PersistenceAdapter, WorkflowExecution, ExecutionFilter, StateTransition } from '../../src/types';

/**
 * Alternative PostgreSQL adapter that stores each state transition as a separate record.
 * This approach:
 * 1. Creates a unique constraint on (execution_id, state_name) to prevent duplicate processing
 * 2. Uses database-level locks to prevent race conditions
 * 3. Maintains immutable history by storing each transition separately
 */
export class PostgresHistoryPersistenceAdapter implements PersistenceAdapter {
  constructor(private readonly pool: Pool) {}

  async save(execution: WorkflowExecution): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Insert main execution record
      await client.query(
        `INSERT INTO workflow_executions_main
         (id, workflow_name, group_id, current_state, status, data, outputs, metadata, suspension)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           current_state = EXCLUDED.current_state,
           status = EXCLUDED.status,
           data = EXCLUDED.data,
           outputs = EXCLUDED.outputs,
           metadata = EXCLUDED.metadata,
           suspension = EXCLUDED.suspension,
           updated_at = CURRENT_TIMESTAMP`,
        [
          execution.id,
          execution.workflowName,
          execution.groupId || null,
          execution.currentState,
          execution.status,
          JSON.stringify(execution.data),
          JSON.stringify(execution.outputs),
          JSON.stringify(execution.metadata),
          execution.suspension ? JSON.stringify(execution.suspension) : null,
        ]
      );

      // Insert history records (each transition as separate row)
      for (const transition of execution.history || []) {
        await client.query(
          `INSERT INTO workflow_state_history
           (execution_id, state_name, from_state, to_state, status, started_at, completed_at, duration, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (execution_id, state_name, started_at) DO NOTHING`,
          [
            execution.id,
            String(transition.to),
            String(transition.from),
            String(transition.to),
            transition.status,
            transition.startedAt,
            transition.completedAt,
            transition.duration,
            transition.error || null,
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    const client = await this.pool.connect();
    try {
      // Load main execution
      const mainResult = await client.query('SELECT * FROM workflow_executions_main WHERE id = $1', [executionId]);

      if (mainResult.rows.length === 0) {
        return null;
      }

      const main = mainResult.rows[0];

      // Load history
      const historyResult = await client.query(
        `SELECT * FROM workflow_state_history
         WHERE execution_id = $1
         ORDER BY started_at ASC`,
        [executionId]
      );

      const history: StateTransition<any>[] = historyResult.rows.map(row => ({
        from: row.from_state,
        to: row.to_state,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        duration: row.duration,
        error: row.error,
      }));

      return {
        id: main.id,
        workflowName: main.workflow_name,
        groupId: main.group_id,
        currentState: main.current_state,
        status: main.status,
        data: main.data,
        outputs: main.outputs,
        history,
        metadata: main.metadata,
        suspension: main.suspension,
      };
    } finally {
      client.release();
    }
  }

  async update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void> {
    const existing = await this.load(executionId);
    if (!existing) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const merged = { ...existing, ...updates, id: executionId };
    await this.save(merged);
  }

  async find(filter: ExecutionFilter): Promise<WorkflowExecution[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filter.workflowName) {
      conditions.push(`workflow_name = $${paramIndex++}`);
      params.push(filter.workflowName);
    }

    if (filter.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filter.status);
    }

    if (filter.groupId) {
      conditions.push(`group_id = $${paramIndex++}`);
      params.push(filter.groupId);
    }

    if (filter.currentState) {
      conditions.push(`current_state = $${paramIndex++}`);
      params.push(filter.currentState);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM workflow_executions_main ${whereClause} ORDER BY created_at DESC`;

    const result = await this.pool.query(query, params);

    // Load each execution with its history
    const executions: WorkflowExecution[] = [];
    for (const row of result.rows) {
      const execution = await this.load(row.id);
      if (execution) {
        executions.push(execution);
      }
    }

    return executions;
  }

  /**
   * Try to acquire exclusive lock on a state for processing.
   * Returns true if lock acquired, false if state is already being processed.
   */
  async tryLockState(executionId: string, stateName: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO workflow_state_locks (execution_id, state_name, locked_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (execution_id, state_name) DO NOTHING
         RETURNING id`,
        [executionId, stateName]
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Release lock on a state after processing.
   */
  async unlockState(executionId: string, stateName: string): Promise<void> {
    await this.pool.query('DELETE FROM workflow_state_locks WHERE execution_id = $1 AND state_name = $2', [
      executionId,
      stateName,
    ]);
  }

  /**
   * Clean up old locks (older than 5 minutes).
   */
  async cleanupStaleLocks(): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM workflow_state_locks
       WHERE locked_at < NOW() - INTERVAL '5 minutes'
       RETURNING id`
    );
    return result.rowCount || 0;
  }
}
