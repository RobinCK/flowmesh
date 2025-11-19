export interface WorkflowMetadata {
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  totalAttempts: number;
  [key: string]: unknown;
}

export enum WorkflowStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SUSPENDED = 'suspended',
}

export interface SuspensionInfo {
  waitingFor?: string;
  metadata?: Record<string, unknown>;
  suspendedAt: Date;
}

export interface StateTransition<TState = unknown> {
  from: TState;
  to: TState;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  status: 'success' | 'failure' | 'suspended' | 'error_recovery';
  error?: string;
}

export interface WorkflowContext<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  executionId: string;
  groupId?: string;
  currentState: keyof TOutputs;
  data: TData;
  outputs: TOutputs;
  history: StateTransition<keyof TOutputs>[];
  metadata: WorkflowMetadata;
}

export interface WorkflowExecution<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  workflowName: string;
  groupId?: string;
  currentState: string;
  status: WorkflowStatus;
  suspension?: SuspensionInfo;
  data: TData;
  outputs: Record<string, unknown>;
  history: StateTransition[];
  metadata: WorkflowMetadata;
}
