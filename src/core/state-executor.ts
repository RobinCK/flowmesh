import { IState, WorkflowContext, StateActions, LoggerAdapter } from '../types';
import {
  getStateOnStart,
  getStateOnSuccess,
  getStateOnFailure,
  getStateOnFinish,
  getStateTimeout,
  getStateDelay,
} from '../decorators';
import { StateTimeoutException } from '../types/state-timeout.exception';

export enum ExecutionAction {
  NEXT = 'next',
  GOTO = 'goto',
  SUSPEND = 'suspend',
  COMPLETE = 'complete',
}

interface SettlementGuard {
  settled: boolean;
}

export interface ExecutionResult<TState = unknown> {
  action: ExecutionAction;
  targetState?: TState;
  data?: Record<string, any>;
  output?: unknown;
  error?: Error;
  suspensionMetadata?: {
    waitingFor?: string;
  };
}

export class StateExecutor {
  constructor(private readonly logger?: LoggerAdapter) {}

  async execute<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    context: WorkflowContext<TData, TOutputs>,
    currentState: TCurrentState
  ): Promise<ExecutionResult<keyof TOutputs>> {
    const startTime = Date.now();
    const result: ExecutionResult<keyof TOutputs> = { action: ExecutionAction.NEXT };
    const guard: SettlementGuard = { settled: false };

    // Get timeout from decorator
    const timeout = getStateTimeout(state.constructor);

    try {
      if (timeout) {
        // Execute with timeout enforcement
        await this.executeWithTimeout(state, context, currentState, result, timeout, startTime, guard);
      } else {
        // Execute without timeout
        await this.executeWithoutTimeout(state, context, currentState, result, startTime, guard);
      }

      this.logger?.debug(`State ${String(currentState)} executed successfully in ${Date.now() - startTime}ms`);
    } catch (error) {
      result.error = error as Error;

      let finalError = error as Error;

      // Call onFailure hook and check if it returns/throws an override error
      try {
        const overriddenError = await this.callLifecycleHook(state, 'onFailure', context, error);
        if (overriddenError) {
          finalError = overriddenError;
          this.logger?.debug(`OnStateFailure hook overrode error to ${finalError.constructor.name}`);
        }
      } catch (hookError) {
        // Hook threw an error - use it as the override
        finalError = hookError as Error;
        this.logger?.debug(`OnStateFailure hook threw error, using as override: ${finalError.constructor.name}`);
      }

      this.logger?.error(`State ${String(currentState)} failed after ${Date.now() - startTime}ms`, finalError);

      throw finalError;
    } finally {
      guard.settled = true;
      await this.callLifecycleHook(state, 'onFinish', context);
    }

    return result;
  }

  private async executeWithTimeout<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    context: WorkflowContext<TData, TOutputs>,
    currentState: TCurrentState,
    result: ExecutionResult<keyof TOutputs>,
    timeout: number,
    startTime: number,
    guard: SettlementGuard
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        reject(new StateTimeoutException(String(currentState), timeout, elapsed));
      }, timeout);
    });

    try {
      await Promise.race([this.executeStateLogic(state, context, result, currentState, guard), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async executeWithoutTimeout<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    context: WorkflowContext<TData, TOutputs>,
    currentState: TCurrentState,
    result: ExecutionResult<keyof TOutputs>,
    _startTime: number,
    guard: SettlementGuard
  ): Promise<void> {
    await this.executeStateLogic(state, context, result, currentState, guard);
  }

  private async executeStateLogic<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    context: WorkflowContext<TData, TOutputs>,
    result: ExecutionResult<keyof TOutputs>,
    currentState: TCurrentState,
    guard: SettlementGuard
  ): Promise<void> {
    // Get delay from decorator
    const delay = getStateDelay(state.constructor);

    // Wait before executing if delay is configured
    if (delay) {
      this.logger?.debug(`Delaying state execution by ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await this.callLifecycleHook(state, 'onStart', context);

    const actions = this.createActions<TData, TOutputs, TCurrentState>(result, currentState, guard);

    await state.execute(context, actions);

    if (guard.settled) {
      this.logger?.warn(`State ${String(currentState)} resolved after it had already settled (timeout), skipping onSuccess hook`);

      return;
    }

    await this.callLifecycleHook(state, 'onSuccess', context, result.output);
  }

  private createActions<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    result: ExecutionResult<keyof TOutputs>,
    currentState: TCurrentState,
    guard: SettlementGuard
  ): StateActions<TData, TOutputs, TCurrentState> {
    const isStale = (action: string): boolean => {
      if (!guard.settled) {
        return false;
      }

      this.logger?.warn(
        `State ${String(currentState)} called actions.${action}() after it had already settled (timeout), ignoring`
      );

      return true;
    };

    const assign = (data?: { data?: Partial<TData>; output?: unknown }): void => {
      if (data?.data) {
        result.data = data.data;
      }

      if (data && 'output' in data) {
        result.output = data.output;
      }
    };

    return {
      next: data => {
        if (isStale('next')) {
          return;
        }

        result.action = ExecutionAction.NEXT;
        assign(data);
      },
      goto: (state, data) => {
        if (isStale('goto')) {
          return;
        }

        result.action = ExecutionAction.GOTO;
        result.targetState = state;
        assign(data);
      },
      suspend: data => {
        if (isStale('suspend')) {
          return;
        }

        result.action = ExecutionAction.SUSPEND;
        assign(data);
        result.suspensionMetadata = { waitingFor: data?.waitingFor };
      },
      complete: data => {
        if (isStale('complete')) {
          return;
        }

        result.action = ExecutionAction.COMPLETE;
        assign(data);
      },
    };
  }

  private async callLifecycleHook<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    hookName: 'onStart' | 'onFinish' | 'onSuccess' | 'onFailure',
    context: WorkflowContext<TData, TOutputs>,
    ...args: any[]
  ): Promise<Error | void> {
    let methodName: string | symbol | undefined;

    switch (hookName) {
      case 'onStart':
        methodName = getStateOnStart(state.constructor);
        break;
      case 'onFinish':
        methodName = getStateOnFinish(state.constructor);
        break;
      case 'onSuccess':
        methodName = getStateOnSuccess(state.constructor);
        break;
      case 'onFailure':
        methodName = getStateOnFailure(state.constructor);
        break;
    }

    if (!methodName || typeof (state as any)[methodName] !== 'function') {
      return;
    }

    if (hookName === 'onFailure') {
      return await (state as any)[methodName](context, ...args);
    }

    try {
      await (state as any)[methodName](context, ...args);
    } catch (error) {
      this.logger?.warn(`Lifecycle hook ${hookName} failed`, error as Error);
    }
  }
}
