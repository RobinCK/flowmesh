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

    // Get timeout from decorator
    const timeout = getStateTimeout(state.constructor);

    try {
      if (timeout) {
        // Execute with timeout enforcement
        await this.executeWithTimeout(state, context, currentState, result, timeout, startTime);
      } else {
        // Execute without timeout
        await this.executeWithoutTimeout(state, context, currentState, result, startTime);
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
    startTime: number
  ): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const elapsed = Date.now() - startTime;
        reject(new StateTimeoutException(String(currentState), timeout, elapsed));
      }, timeout);
    });

    await Promise.race([this.executeStateLogic(state, context, result), timeoutPromise]);
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
    _startTime: number
  ): Promise<void> {
    await this.executeStateLogic(state, context, result);
  }

  private async executeStateLogic<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(
    state: IState<TData, TOutputs, TCurrentState>,
    context: WorkflowContext<TData, TOutputs>,
    result: ExecutionResult<keyof TOutputs>
  ): Promise<void> {
    // Get delay from decorator
    const delay = getStateDelay(state.constructor);

    // Wait before executing if delay is configured
    if (delay) {
      this.logger?.debug(`Delaying state execution by ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    await this.callLifecycleHook(state, 'onStart', context);

    const actions = this.createActions<TData, TOutputs, TCurrentState>(result);

    await state.execute(context, actions);

    await this.callLifecycleHook(state, 'onSuccess', context, result.output);
  }

  private createActions<
    TData extends Record<string, unknown>,
    TOutputs extends Record<string, unknown>,
    TCurrentState extends keyof TOutputs,
  >(result: ExecutionResult<keyof TOutputs>): StateActions<TData, TOutputs, TCurrentState> {
    return {
      next: data => {
        result.action = ExecutionAction.NEXT;
        if (data?.data) {
          result.data = data.data;
        }
        if (data?.output) {
          result.output = data.output;
        }
      },
      goto: (state, data) => {
        result.action = ExecutionAction.GOTO;
        result.targetState = state;
        if (data?.data) {
          result.data = data.data;
        }
        if (data?.output) {
          result.output = data.output;
        }
      },
      suspend: data => {
        result.action = ExecutionAction.SUSPEND;
        if (data?.data) {
          result.data = data.data;
        }
        if (data?.output) {
          result.output = data.output;
        }
        result.suspensionMetadata = { waitingFor: data?.waitingFor };
      },
      complete: data => {
        result.action = ExecutionAction.COMPLETE;
        if (data?.data) {
          result.data = data.data;
        }
        if (data?.output) {
          result.output = data.output;
        }
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
