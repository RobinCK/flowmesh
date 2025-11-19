import { PersistenceAdapter, WorkflowExecution, ExecutionFilter } from '../types';

export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private executions: Map<string, WorkflowExecution> = new Map();

  async save(execution: WorkflowExecution): Promise<void> {
    this.executions.set(execution.id, { ...execution });
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    const execution = this.executions.get(executionId);

    return execution ? { ...execution } : null;
  }

  async update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void> {
    const execution = this.executions.get(executionId);

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    this.executions.set(executionId, { ...execution, ...updates });
  }

  async find(filter: ExecutionFilter): Promise<WorkflowExecution[]> {
    const results: WorkflowExecution[] = [];

    for (const execution of this.executions.values()) {
      let matches = true;

      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        matches = matches && statuses.includes(execution.status);
      }

      if (filter.groupId !== undefined) {
        matches = matches && execution.groupId === filter.groupId;
      }

      if (filter.workflowName !== undefined) {
        matches = matches && execution.workflowName === filter.workflowName;
      }

      if (filter.currentState !== undefined) {
        matches = matches && execution.currentState === filter.currentState;
      }

      if (matches) {
        results.push({ ...execution });
      }
    }

    return results;
  }

  clear(): void {
    this.executions.clear();
  }
}
