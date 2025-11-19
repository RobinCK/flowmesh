import { WorkflowContext } from './context.types';
import { ErrorHandler } from './error-handler.types';
import { PersistenceAdapter, LockAdapter, LoggerAdapter } from './adapter.types';
import { IWorkflowPlugin } from './plugin.types';

export enum ConcurrencyMode {
  SEQUENTIAL = 'sequential',
  PARALLEL = 'parallel',
  THROTTLE = 'throttle',
}

export interface ConcurrencyConfig<TData extends Record<string, unknown> = Record<string, unknown>> {
  groupBy: string | ((context: WorkflowContext<TData>) => string);
  mode: ConcurrencyMode;
  maxConcurrentAfterUnlock?: number;
}

export interface TransitionConfig<TState = unknown> {
  from: TState | TState[];
  to: TState;
  condition?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export interface ConditionalTransition<TState = unknown> {
  from: TState;
  conditions: Array<{
    condition: (context: WorkflowContext) => boolean | Promise<boolean>;
    to: TState;
    virtualOutputs?: Partial<
      Record<TState extends string | number | symbol ? TState : never, any | ((context: WorkflowContext) => any | Promise<any>)>
    >;
  }>;
  default?: TState;
  defaultVirtualOutputs?: Partial<
    Record<TState extends string | number | symbol ? TState : never, any | ((context: WorkflowContext) => any | Promise<any>)>
  >;
}

export interface WorkflowMetadataConfig<TState = unknown> {
  name: string;
  states: Record<string, TState>;
  initialState: TState;
  concurrency?: ConcurrencyConfig;
  transitions?: TransitionConfig<TState>[];
  conditionalTransitions?: ConditionalTransition<TState>[];
  errorHandler?: ErrorHandler;
}

export interface WorkflowLifecycleHooks<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  onStart?: (context: WorkflowContext<TData, TOutputs>) => Promise<void> | void;
  onComplete?: (context: WorkflowContext<TData, TOutputs>) => Promise<void> | void;
  onError?: (context: WorkflowContext<TData, TOutputs>, error: Error) => Promise<void> | void;
  beforeState?: (context: WorkflowContext<TData, TOutputs>) => Promise<void> | void;
  afterState?: (context: WorkflowContext<TData, TOutputs>) => Promise<void> | void;
}

export interface WorkflowConfigOptions {
  persistence?: PersistenceAdapter | (new (...args: any[]) => PersistenceAdapter);
  lockAdapter?: LockAdapter | (new (...args: any[]) => LockAdapter);
  logger?: LoggerAdapter | (new (...args: any[]) => LoggerAdapter);
  plugins?: Array<IWorkflowPlugin | (new (...args: any[]) => IWorkflowPlugin)>;
}
