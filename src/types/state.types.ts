import { WorkflowContext } from './context.types';

export type ExtractOutput<TOutputs, TState extends keyof TOutputs> = TOutputs[TState];

export interface StateActions<
  TData extends Record<string, unknown>,
  TOutputs extends Record<string, unknown>,
  TCurrentState extends keyof TOutputs,
> {
  next(data?: { data?: Partial<TData>; output?: ExtractOutput<TOutputs, TCurrentState> }): void;

  goto<TTargetState extends keyof TOutputs>(
    state: TTargetState,
    data?: {
      data?: Partial<TData>;
      output?: ExtractOutput<TOutputs, TCurrentState>;
    }
  ): void;

  suspend(data?: { waitingFor?: string; data?: Partial<TData>; output?: ExtractOutput<TOutputs, TCurrentState> }): void;

  complete(data?: { data?: Partial<TData>; output?: ExtractOutput<TOutputs, TCurrentState> }): void;
}

export interface OutputsAccessor<TOutputs extends Record<string, unknown>> {
  get<TState extends keyof TOutputs>(state: TState): ExtractOutput<TOutputs, TState> | undefined;

  require<TState extends keyof TOutputs>(state: TState): ExtractOutput<TOutputs, TState>;

  has<TState extends keyof TOutputs>(state: TState): boolean;

  getAll(): Partial<TOutputs>;
}

export interface IState<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
  TCurrentState extends keyof TOutputs = keyof TOutputs,
> {
  execute(context: WorkflowContext<TData, TOutputs>, actions: StateActions<TData, TOutputs, TCurrentState>): Promise<void> | void;
}

export interface StateMetadata<TState = unknown> {
  stateValue: TState;
  stateName: string;
  states: TState[];
  timeout?: number;
  retry?: RetryConfig;
  concurrency?: StateConcurrencyConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  strategy?: 'fixed' | 'exponential' | 'linear';
  initialDelay?: number;
  maxDelay?: number;
  multiplier?: number;
}

export interface StateConcurrencyConfig {
  unlockAfter?: boolean;
}
