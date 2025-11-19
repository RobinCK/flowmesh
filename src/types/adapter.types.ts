import { WorkflowExecution, WorkflowStatus } from './context.types';

export interface ExecutionFilter {
  status?: WorkflowStatus | WorkflowStatus[];
  groupId?: string;
  workflowName?: string;
  currentState?: string;
}

export interface PersistenceAdapter {
  save(execution: WorkflowExecution): Promise<void>;
  load(executionId: string): Promise<WorkflowExecution | null>;
  update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void>;
  find(filter: ExecutionFilter): Promise<WorkflowExecution[]>;
}

export interface LockAdapter {
  acquire(key: string, executionId: string, ttl?: number): Promise<boolean>;
  release(key: string): Promise<void>;
  isLocked(key: string): Promise<boolean>;
  extend(key: string, ttl: number): Promise<boolean>;
}

export interface LoggerAdapter {
  log(message: string, context?: unknown): void;
  error(message: string, error?: Error, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  debug(message: string, context?: unknown): void;
}
