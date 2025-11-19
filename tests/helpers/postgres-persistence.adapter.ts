import { Pool } from 'pg';
import { PersistenceAdapter, WorkflowExecution, ExecutionFilter } from '../../src/types';

export class PostgresPersistenceAdapter implements PersistenceAdapter {
  constructor(private readonly pool: Pool) {}

  async save(execution: WorkflowExecution): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_executions
       (id, workflow_name, group_id, current_state, status, data, outputs, history, metadata, suspension)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        execution.id,
        execution.workflowName,
        execution.groupId || null,
        execution.currentState,
        execution.status,
        JSON.stringify(execution.data),
        JSON.stringify(execution.outputs),
        JSON.stringify(execution.history),
        JSON.stringify(execution.metadata),
        execution.suspension ? JSON.stringify(execution.suspension) : null,
      ]
    );
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    const result = await this.pool.query('SELECT * FROM workflow_executions WHERE id = $1', [executionId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return this.mapRowToExecution(row);
  }

  async update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void> {
    const existing = await this.load(executionId);
    if (!existing) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const merged = { ...existing, ...updates, id: executionId };

    await this.pool.query(
      `UPDATE workflow_executions
       SET workflow_name = $2, group_id = $3, current_state = $4, status = $5,
           data = $6, outputs = $7, history = $8, metadata = $9, suspension = $10,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        merged.id,
        merged.workflowName,
        merged.groupId || null,
        merged.currentState,
        merged.status,
        JSON.stringify(merged.data),
        JSON.stringify(merged.outputs),
        JSON.stringify(merged.history),
        JSON.stringify(merged.metadata),
        merged.suspension ? JSON.stringify(merged.suspension) : null,
      ]
    );
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
    const query = `SELECT * FROM workflow_executions ${whereClause} ORDER BY created_at DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map(row => this.mapRowToExecution(row));
  }

  private mapRowToExecution(row: any): WorkflowExecution {
    return {
      id: row.id,
      workflowName: row.workflow_name,
      groupId: row.group_id,
      currentState: row.current_state,
      status: row.status,
      data: row.data,
      outputs: row.outputs,
      history: row.history,
      metadata: row.metadata,
      suspension: row.suspension,
    };
  }
}
