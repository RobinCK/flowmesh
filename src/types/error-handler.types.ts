import { WorkflowContext } from './context.types';

export enum ErrorHandlingDecision {
  CONTINUE = 'continue',
  EXIT = 'exit',
  FAIL = 'fail',
  FAIL_NO_PERSIST = 'fail_no_persist',
  TRANSITION_TO = 'transition_to',
  STOP_RETRY = 'stop_retry',
}

export interface TransitionToDecision<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  decision: ErrorHandlingDecision.TRANSITION_TO;
  targetState: string;
  output?: any;
  onContextTransform?: (context: WorkflowContext<TData, TOutputs>) => void;
}

export type ErrorHandlingResult<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> = ErrorHandlingDecision | TransitionToDecision<TData, TOutputs>;

export type ErrorPhase =
  | 'lock_acquisition'
  | 'workflow_start'
  | 'before_state'
  | 'state_execute'
  | 'after_state'
  | 'workflow_complete';

export interface ErrorContext<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  error: Error;
  phase: ErrorPhase;
  workflowContext: WorkflowContext<TData, TOutputs>;
  attempt?: number;
  maxAttempts?: number;
}

export interface ErrorHandler<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  handle(
    context: ErrorContext<TData, TOutputs>
  ): Promise<ErrorHandlingResult<TData, TOutputs>> | ErrorHandlingResult<TData, TOutputs>;
}
