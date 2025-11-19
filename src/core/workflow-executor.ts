import {
  WorkflowContext,
  WorkflowExecution,
  WorkflowStatus,
  StateTransition,
  LoggerAdapter,
  PersistenceAdapter,
  IWorkflowPlugin,
  WorkflowMetadataConfig,
  ErrorHandlingDecision,
  ErrorPhase,
  RetryExhaustedException,
} from '../types';
import { StateExecutor, ExecutionAction, ExecutionResult } from './state-executor';
import { StateRegistry } from './state-registry';
import { ConcurrencyManager } from './concurrency-manager';
import {
  getWorkflowOnStart,
  getWorkflowOnComplete,
  getWorkflowOnError,
  getWorkflowBeforeState,
  getWorkflowAfterState,
  getStateConcurrency,
  getStateRetry,
} from '../decorators';

export interface ExecutionOptions<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  groupId?: string;
}

export enum ResumeStrategy {
  RETRY = 'retry',
  SKIP = 'skip',
  GOTO = 'goto',
}

export interface ResumeOptions<TData extends Record<string, unknown> = Record<string, unknown>> {
  data?: Partial<TData>;
  strategy?: ResumeStrategy;
  targetState?: string;
}

/**
 * Calculate backoff delay based on retry strategy
 */
function calculateBackoffDelay(
  attempt: number,
  strategy: 'fixed' | 'linear' | 'exponential',
  initialDelay: number,
  maxDelay: number,
  multiplier?: number
): number {
  let delay: number;

  switch (strategy) {
    case 'fixed':
      delay = initialDelay;
      break;
    case 'linear':
      delay = initialDelay * attempt;
      break;
    case 'exponential':
      delay = initialDelay * Math.pow(multiplier || 2, attempt - 1);
      break;
    default:
      delay = initialDelay;
  }

  return Math.min(delay, maxDelay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class WorkflowExecutor<
  TData extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
> {
  private stateExecutor: StateExecutor;

  constructor(
    private readonly workflowInstance: any,
    private readonly metadata: WorkflowMetadataConfig,
    private readonly persistence?: PersistenceAdapter,
    private readonly concurrencyManager?: ConcurrencyManager,
    private readonly logger?: LoggerAdapter,
    private readonly plugins: IWorkflowPlugin[] = []
  ) {
    this.stateExecutor = new StateExecutor(logger);
  }

  async execute(options: ExecutionOptions<TData>): Promise<WorkflowExecution<TData>> {
    await this.initializePlugins();

    const executionId = this.generateExecutionId();
    const groupId = options.groupId || this.getGroupId(options.data);

    const context: WorkflowContext<TData, TOutputs> = {
      executionId,
      groupId,
      currentState: this.metadata.initialState as keyof TOutputs,
      data: options.data,
      outputs: {} as TOutputs,
      history: [],
      metadata: {
        startedAt: new Date(),
        updatedAt: new Date(),
        totalAttempts: 0,
      },
    };

    const execution: WorkflowExecution<TData> = {
      id: executionId,
      workflowName: this.metadata.name,
      groupId,
      currentState: String(this.metadata.initialState),
      status: WorkflowStatus.RUNNING,
      data: context.data,
      outputs: context.outputs,
      history: context.history,
      metadata: context.metadata,
    };

    if (groupId && this.concurrencyManager && this.metadata.concurrency) {
      const acquired = await this.concurrencyManager.acquireGroupLock(groupId, executionId, this.metadata.concurrency);

      if (!acquired) {
        const lockError = new Error(`Cannot acquire lock for group ${groupId}`);
        const handlerResult = await this.handleErrorWithHandler(lockError, 'lock_acquisition', context, execution);

        if (handlerResult.decision === ErrorHandlingDecision.EXIT || handlerResult.decision === ErrorHandlingDecision.CONTINUE) {
          return execution;
        }

        throw lockError;
      }
    }

    if (this.persistence) {
      await this.persistence.save(execution);
    }

    try {
      await this.callWorkflowLifecycleHook('onStart', context);

      const result = await this.executeWorkflow(context, execution);

      if (result.status === WorkflowStatus.COMPLETED) {
        await this.callWorkflowLifecycleHook('onComplete', context);
      }

      if (groupId && this.concurrencyManager && result.status !== WorkflowStatus.SUSPENDED) {
        await this.concurrencyManager.releaseGroupLock(groupId, executionId);
      }

      return result as WorkflowExecution<TData>;
    } catch (error) {
      if (execution.status === WorkflowStatus.FAILED) {
        if (groupId && this.concurrencyManager) {
          await this.concurrencyManager.releaseGroupLock(groupId, executionId);
        }

        throw error;
      }

      let handlerResult;

      try {
        handlerResult = await this.handleErrorWithHandler(error as Error, 'workflow_start', context, execution);
      } catch (handlerError) {
        this.logger?.error('Error handler threw exception, falling back to FAIL', handlerError as Error);
        handlerResult = { decision: ErrorHandlingDecision.FAIL };
      }

      if (groupId && this.concurrencyManager) {
        await this.concurrencyManager.releaseGroupLock(groupId, executionId);
      }

      await this.processErrorDecision(handlerResult.decision, error as Error, context, execution);

      return execution;
    }
  }

  async resume(executionId: string, options?: ResumeOptions<TData>): Promise<WorkflowExecution<TData>> {
    if (!this.persistence) {
      throw new Error('Persistence adapter is required for resume functionality');
    }

    const execution = await this.persistence.load(executionId);

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== WorkflowStatus.SUSPENDED) {
      throw new Error(`Execution ${executionId} is not suspended`);
    }

    const strategy = options?.strategy || ResumeStrategy.RETRY;
    const resumeData = options?.data;

    const context: WorkflowContext<TData, TOutputs> = {
      executionId: execution.id,
      groupId: execution.groupId,
      currentState: execution.currentState as keyof TOutputs,
      data: { ...execution.data, ...resumeData } as TData,
      outputs: execution.outputs as TOutputs,
      history: execution.history as StateTransition<keyof TOutputs>[],
      metadata: execution.metadata,
    };

    if (execution.groupId && this.concurrencyManager && this.metadata.concurrency) {
      const acquired = await this.concurrencyManager.acquireGroupLock(execution.groupId, execution.id, this.metadata.concurrency);

      if (!acquired) {
        throw new Error(`Cannot acquire lock for group ${execution.groupId} during resume`);
      }
    }

    execution.status = WorkflowStatus.RUNNING;
    execution.suspension = undefined;
    execution.data = context.data;
    execution.metadata.updatedAt = new Date();

    if (strategy === ResumeStrategy.SKIP) {
      const nextState = await this.getNextState(context.currentState, context);

      if (!nextState) {
        execution.status = WorkflowStatus.COMPLETED;
        execution.metadata.completedAt = new Date();
        execution.metadata.updatedAt = new Date();

        await this.persistence.update(execution.id, execution);

        if (execution.groupId && this.concurrencyManager) {
          await this.concurrencyManager.releaseGroupLock(execution.groupId, execution.id);
        }

        return execution as WorkflowExecution<TData>;
      }

      const transition: StateTransition<keyof TOutputs> = {
        from: context.currentState,
        to: nextState,
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 0,
        status: 'success',
      };

      context.history.push(transition);
      context.currentState = nextState;
      execution.currentState = String(nextState);
      execution.history = context.history;
    } else if (strategy === ResumeStrategy.GOTO) {
      if (!options?.targetState) {
        throw new Error('targetState is required for GOTO strategy');
      }

      const targetState = options.targetState as keyof TOutputs;
      const StateClass = StateRegistry.get(targetState);

      if (!StateClass) {
        throw new Error(`Target state not found: ${String(targetState)}`);
      }

      const transition: StateTransition<keyof TOutputs> = {
        from: context.currentState,
        to: targetState,
        startedAt: new Date(),
        completedAt: new Date(),
        duration: 0,
        status: 'success',
      };

      context.history.push(transition);
      context.currentState = targetState;
      execution.currentState = String(targetState);
      execution.history = context.history;
    }

    await this.persistence.update(execution.id, execution);

    try {
      const result = await this.executeWorkflow(context, execution);

      if (execution.groupId && this.concurrencyManager && result.status !== WorkflowStatus.SUSPENDED) {
        await this.concurrencyManager.releaseGroupLock(execution.groupId, execution.id);
      }

      return result as WorkflowExecution<TData>;
    } catch (error) {
      if (execution.groupId && this.concurrencyManager) {
        await this.concurrencyManager.releaseGroupLock(execution.groupId, execution.id);
      }

      throw error;
    }
  }

  private async executeWorkflow(
    context: WorkflowContext<TData, TOutputs>,
    execution: WorkflowExecution
  ): Promise<WorkflowExecution> {
    while (true) {
      const StateClass = StateRegistry.get(context.currentState);

      if (!StateClass) {
        const error = new Error(`State not found: ${String(context.currentState)}`);
        execution.status = WorkflowStatus.FAILED;
        execution.metadata.updatedAt = new Date();

        if (this.persistence) {
          await this.persistence.update(execution.id, execution);
        }

        throw error;
      }

      try {
        await this.callWorkflowLifecycleHook('beforeState', context);
      } catch (error) {
        const handlerResult = await this.handleErrorWithHandler(error as Error, 'before_state', context, execution);

        if (handlerResult.decision === ErrorHandlingDecision.EXIT) {
          return execution;
        } else if (handlerResult.decision === ErrorHandlingDecision.CONTINUE) {
          // Skip beforeState hook, continue with state execution
        } else {
          await this.processErrorDecision(handlerResult.decision, error as Error, context, execution);
        }
      }

      await this.callPluginHook('beforeExecute', context);

      context = await this.extendContextWithPlugins(context);

      const stateInstance = StateRegistry.isInstance(StateClass) ? StateClass : new (StateClass as new (...args: any[]) => any)();

      const transitionStartTime = Date.now();
      let result: ExecutionResult<keyof TOutputs>;

      try {
        // Execute state with automatic retry logic
        result = await this.executeStateWithRetry(StateClass, stateInstance, context, execution, transitionStartTime);
      } catch (error) {
        const attachedResult = (error as any).__handlerResult;

        let handlerResult: {
          decision: ErrorHandlingDecision;
          targetState?: keyof TOutputs;
          output?: any;
        };

        if (attachedResult) {
          handlerResult = attachedResult;
        } else if (error instanceof RetryExhaustedException) {
          try {
            handlerResult = await this.handleErrorWithHandler(error as Error, 'state_execute', context, execution);
          } catch (handlerError) {
            if (handlerError !== error && (handlerError as Error).constructor !== Error) {
              throw handlerError;
            } else {
              this.logger?.error('Error handler threw exception, falling back to FAIL', handlerError as Error);
              handlerResult = { decision: ErrorHandlingDecision.FAIL };
            }
          }
        } else {
          handlerResult = { decision: ErrorHandlingDecision.FAIL };
        }

        await this.callPluginHook('onError', context, error as Error);

        if (handlerResult.decision === ErrorHandlingDecision.TRANSITION_TO) {
          const targetState = handlerResult.targetState;

          if (!targetState) {
            this.logger?.warn('TRANSITION_TO decision without targetState, treating as EXIT');

            return execution;
          }

          context.history[context.history.length - 1].status = 'error_recovery';

          const errorTransition: StateTransition<keyof TOutputs> = {
            from: context.currentState,
            to: targetState,
            startedAt: new Date(),
            completedAt: new Date(),
            duration: 0,
            status: 'success',
          };

          context.history.push(errorTransition);

          if (handlerResult.output !== undefined) {
            (context.outputs as any)[context.currentState] = handlerResult.output;
          }

          context.currentState = targetState;
          execution.currentState = String(targetState);
          execution.history = context.history;
          execution.outputs = context.outputs;
          execution.metadata.updatedAt = new Date();

          if (this.persistence) {
            await this.persistence.update(execution.id, execution);
          }

          continue;
        } else if (handlerResult.decision === ErrorHandlingDecision.EXIT) {
          return execution;
        } else if (handlerResult.decision === ErrorHandlingDecision.CONTINUE) {
          this.logger?.warn('CONTINUE decision not supported for state_execute phase, treating as EXIT');

          return execution;
        } else if (handlerResult.decision === ErrorHandlingDecision.FAIL) {
          execution.status = WorkflowStatus.FAILED;
          execution.metadata.updatedAt = new Date();

          if (this.persistence) {
            await this.persistence.update(execution.id, execution);
          }

          await this.callWorkflowLifecycleHook('onError', context, error as Error);

          throw error;
        } else {
          await this.callWorkflowLifecycleHook('onError', context, error as Error);

          throw error;
        }
      }

      if (result.data) {
        context.data = { ...context.data, ...result.data };
        execution.data = context.data;
      }

      if (result.output !== undefined) {
        (context.outputs as any)[context.currentState] = result.output;
        execution.outputs = context.outputs;
      }

      try {
        await this.callWorkflowLifecycleHook('afterState', context);
      } catch (error) {
        const handlerResult = await this.handleErrorWithHandler(error as Error, 'after_state', context, execution);

        if (handlerResult.decision === ErrorHandlingDecision.EXIT) {
          return execution;
        } else if (handlerResult.decision === ErrorHandlingDecision.CONTINUE) {
          // Skip afterState hook, continue with transition
        } else {
          await this.processErrorDecision(handlerResult.decision, error as Error, context, execution);
        }
      }

      await this.callPluginHook('afterExecute', context);

      if (result.action === ExecutionAction.SUSPEND) {
        const transition: StateTransition<keyof TOutputs> = {
          from: context.currentState,
          to: context.currentState,
          startedAt: new Date(transitionStartTime),
          completedAt: new Date(),
          duration: Date.now() - transitionStartTime,
          status: 'suspended',
        };

        context.history.push(transition);
        execution.history = context.history;
        execution.status = WorkflowStatus.SUSPENDED;
        execution.suspension = {
          waitingFor: result.suspensionMetadata?.waitingFor,
          suspendedAt: new Date(),
        };
        execution.metadata.updatedAt = new Date();

        if (this.persistence) {
          await this.persistence.update(execution.id, execution);
        }

        return execution;
      }

      if (result.action === ExecutionAction.COMPLETE) {
        const transition: StateTransition<keyof TOutputs> = {
          from: context.currentState,
          to: context.currentState,
          startedAt: new Date(transitionStartTime),
          completedAt: new Date(),
          duration: Date.now() - transitionStartTime,
          status: 'success',
        };

        context.history.push(transition);
        execution.history = context.history;
        execution.status = WorkflowStatus.COMPLETED;
        execution.metadata.completedAt = new Date();
        execution.metadata.updatedAt = new Date();

        if (this.persistence) {
          await this.persistence.update(execution.id, execution);
        }

        return execution;
      }

      let nextState: keyof TOutputs | null = null;

      if (result.action === ExecutionAction.GOTO && result.targetState) {
        nextState = result.targetState;

        if (!this.canTransition(context.currentState, nextState)) {
          throw new Error(`Invalid transition from ${String(context.currentState)} to ${String(nextState)}`);
        }
      } else if (result.action === ExecutionAction.NEXT) {
        nextState = await this.getNextState(context.currentState, context);
      }

      if (nextState === null) {
        execution.status = WorkflowStatus.COMPLETED;
        execution.metadata.completedAt = new Date();
        execution.metadata.updatedAt = new Date();

        if (this.persistence) {
          await this.persistence.update(execution.id, execution);
        }

        return execution;
      }

      const transition: StateTransition<keyof TOutputs> = {
        from: context.currentState,
        to: nextState,
        startedAt: new Date(transitionStartTime),
        completedAt: new Date(),
        duration: Date.now() - transitionStartTime,
        status: 'success',
      };

      context.history.push(transition);
      execution.history = context.history;

      const stateConcurrency = getStateConcurrency(stateInstance.constructor);

      if (execution.groupId && this.concurrencyManager && this.metadata.concurrency && stateConcurrency?.unlockAfter) {
        await this.concurrencyManager.partialUnlock(execution.groupId, execution.id, this.metadata.concurrency);
      }

      context.currentState = nextState;
      execution.currentState = String(nextState);
      execution.metadata.updatedAt = new Date();

      if (this.persistence) {
        await this.persistence.update(execution.id, execution);
      }
    }
  }

  private async getNextState(
    currentState: keyof TOutputs,
    context: WorkflowContext<TData, TOutputs>
  ): Promise<keyof TOutputs | null> {
    if (this.metadata.conditionalTransitions) {
      for (const group of this.metadata.conditionalTransitions) {
        if (group.from === currentState) {
          for (const condition of group.conditions) {
            const conditionMet = await condition.condition(context as any);
            if (conditionMet) {
              await this.applyVirtualOutputs(condition.virtualOutputs, context);
              return condition.to as keyof TOutputs;
            }
          }

          await this.applyVirtualOutputs(group.defaultVirtualOutputs, context);
          return (group.default as keyof TOutputs) || null;
        }
      }
    }

    if (this.metadata.transitions) {
      for (const transition of this.metadata.transitions) {
        if ((transition.from as any[]).includes(currentState)) {
          if (transition.condition) {
            const conditionMet = await transition.condition(context as any);
            if (conditionMet) {
              return transition.to as keyof TOutputs;
            }
          } else {
            return transition.to as keyof TOutputs;
          }
        }
      }
    }

    const stateValues = Object.values(this.metadata.states);
    const currentIndex = stateValues.indexOf(currentState);

    if (currentIndex !== -1 && currentIndex < stateValues.length - 1) {
      return stateValues[currentIndex + 1] as keyof TOutputs;
    }

    return null;
  }

  private canTransition(from: keyof TOutputs, to: keyof TOutputs): boolean {
    if (this.metadata.transitions) {
      for (const transition of this.metadata.transitions) {
        if ((transition.from as any[]).includes(from) && transition.to === to) {
          return true;
        }
      }
    }

    if (this.metadata.conditionalTransitions) {
      for (const group of this.metadata.conditionalTransitions) {
        if (group.from === from) {
          for (const condition of group.conditions) {
            if (condition.to === to) {
              return true;
            }
          }

          if (group.default === to) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private getGroupId(data: TData): string | undefined {
    if (!this.metadata.concurrency) {
      return undefined;
    }

    const { groupBy } = this.metadata.concurrency;

    if (typeof groupBy === 'string') {
      return (data[groupBy] as string) || undefined;
    }

    const context = { data } as WorkflowContext<TData, any>;
    return groupBy(context as any);
  }

  private async callWorkflowLifecycleHook(
    hookName: 'onStart' | 'onComplete' | 'onError' | 'beforeState' | 'afterState',
    context: WorkflowContext<TData, TOutputs>,
    ...args: any[]
  ): Promise<void> {
    try {
      let methodName: string | symbol | undefined;

      switch (hookName) {
        case 'onStart':
          methodName = getWorkflowOnStart(this.workflowInstance.constructor);
          break;
        case 'onComplete':
          methodName = getWorkflowOnComplete(this.workflowInstance.constructor);
          break;
        case 'onError':
          methodName = getWorkflowOnError(this.workflowInstance.constructor);
          break;
        case 'beforeState':
          methodName = getWorkflowBeforeState(this.workflowInstance.constructor);
          break;
        case 'afterState':
          methodName = getWorkflowAfterState(this.workflowInstance.constructor);
          break;
      }

      if (methodName && typeof this.workflowInstance[methodName] === 'function') {
        await this.workflowInstance[methodName](context, ...args);
      }
    } catch (error) {
      if (hookName === 'beforeState' || hookName === 'afterState' || hookName === 'onStart' || hookName === 'onError') {
        throw error;
      }

      this.logger?.warn(`Workflow lifecycle hook ${hookName} failed`, error as Error);
    }
  }

  private async initializePlugins(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onInit) {
        await plugin.onInit();
      }
    }
  }

  private async callPluginHook(
    hookName: 'beforeExecute' | 'afterExecute' | 'onError',
    context: WorkflowContext<TData, TOutputs>,
    error?: Error
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName];

      if (hook) {
        if (hookName === 'onError' && error) {
          await (hook as any).call(plugin, context, error);
        } else {
          await (hook as any).call(plugin, context);
        }
      }
    }
  }

  private async handleErrorWithHandler(
    error: Error,
    phase: ErrorPhase,
    context: WorkflowContext<TData, TOutputs>,
    execution: WorkflowExecution,
    attempt?: number,
    maxAttempts?: number
  ): Promise<{ decision: ErrorHandlingDecision; targetState?: keyof TOutputs; output?: any }> {
    if (!this.metadata.errorHandler) {
      return { decision: ErrorHandlingDecision.FAIL };
    }

    try {
      const result = await this.metadata.errorHandler.handle({
        error,
        phase,
        workflowContext: context as WorkflowContext<Record<string, unknown>, Record<string, unknown>>,
        attempt,
        maxAttempts,
      });

      if (typeof result === 'object' && 'decision' in result) {
        return {
          decision: result.decision,
          targetState: result.targetState as keyof TOutputs,
          output: result.output,
        };
      }

      return { decision: result as ErrorHandlingDecision };
    } catch (handlerError) {
      throw handlerError;
    }
  }

  private async processErrorDecision(
    decision: ErrorHandlingDecision,
    error: Error,
    context: WorkflowContext<TData, TOutputs>,
    execution: WorkflowExecution
  ): Promise<void> {
    switch (decision) {
      case ErrorHandlingDecision.CONTINUE:
        return;

      case ErrorHandlingDecision.EXIT:
        return;

      case ErrorHandlingDecision.FAIL_NO_PERSIST:
        await this.callWorkflowLifecycleHook('onError', context, error);

        throw error;

      case ErrorHandlingDecision.FAIL:
        await this.callWorkflowLifecycleHook('onError', context, error);

        execution.status = WorkflowStatus.FAILED;
        execution.metadata.updatedAt = new Date();

        if (this.persistence) {
          await this.persistence.update(execution.id, execution);
        }

        throw error;

      default:
        throw error;
    }
  }

  /**
   * Execute state with automatic retry on failure based on @Retry decorator configuration
   */
  private async executeStateWithRetry(
    StateClass: any,
    stateInstance: any,
    context: WorkflowContext<TData, TOutputs>,
    execution: WorkflowExecution,
    transitionStartTime: number
  ): Promise<ExecutionResult<keyof TOutputs>> {
    // Get retry config from the class (not instance)
    const stateClass = StateRegistry.isInstance(StateClass) ? stateInstance.constructor : StateClass;
    const retryConfig = getStateRetry(stateClass);
    const maxAttempts = retryConfig?.maxAttempts || 1;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Execute the state
        const result = await this.stateExecutor.execute(stateInstance, context, context.currentState);

        // Success - return result
        if (attempt > 1) {
          this.logger?.debug(`State ${String(context.currentState)} succeeded on attempt ${attempt}/${maxAttempts}`);
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        this.logger?.warn(
          `State ${String(context.currentState)} failed on attempt ${attempt}/${maxAttempts}: ${lastError.message}`
        );

        // Add failure transition to history
        const transition: StateTransition<keyof TOutputs> = {
          from: context.currentState,
          to: context.currentState,
          startedAt: new Date(transitionStartTime),
          completedAt: new Date(),
          duration: Date.now() - transitionStartTime,
          status: 'failure',
          error: lastError.message,
        };

        context.history.push(transition);
        execution.history = context.history;

        let shouldStopRetry = false;
        let handlerDecidedAction = false;

        if (this.metadata.errorHandler) {
          try {
            const handlerResult = await this.handleErrorWithHandler(
              lastError,
              'state_execute',
              context,
              execution,
              attempt,
              maxAttempts
            );

            await this.callPluginHook('onError', context, lastError);

            if (handlerResult.decision === ErrorHandlingDecision.STOP_RETRY) {
              this.logger?.debug(`Error handler requested to stop retry for state ${String(context.currentState)}`);
              shouldStopRetry = true;
            }

            if (
              handlerResult.decision === ErrorHandlingDecision.TRANSITION_TO ||
              handlerResult.decision === ErrorHandlingDecision.EXIT ||
              handlerResult.decision === ErrorHandlingDecision.CONTINUE ||
              handlerResult.decision === ErrorHandlingDecision.FAIL ||
              handlerResult.decision === ErrorHandlingDecision.FAIL_NO_PERSIST
            ) {
              (lastError as any).__handlerResult = handlerResult;
              handlerDecidedAction = true;
            }
          } catch {
            this.logger?.warn(`Error handler threw exception during attempt ${attempt}, continuing retries`);
            await this.callPluginHook('onError', context, lastError);
          }
        } else {
          await this.callPluginHook('onError', context, lastError);
        }

        if (handlerDecidedAction || shouldStopRetry) {
          throw lastError;
        }

        if (attempt === maxAttempts) {
          if (retryConfig) {
            throw new RetryExhaustedException(lastError, maxAttempts, retryConfig);
          } else {
            throw lastError;
          }
        }

        if (retryConfig) {
          const delay = calculateBackoffDelay(
            attempt,
            retryConfig.strategy || 'exponential',
            retryConfig.initialDelay || 1000,
            retryConfig.maxDelay || 10000,
            retryConfig.multiplier
          );

          this.logger?.debug(`Waiting ${delay}ms before retry attempt ${attempt + 1}`);

          await sleep(delay);
        }
      }
    }

    throw lastError || new Error('Unexpected retry loop termination');
  }

  private async extendContextWithPlugins(context: WorkflowContext<TData, TOutputs>): Promise<WorkflowContext<TData, TOutputs>> {
    let extendedContext = context;

    for (const plugin of this.plugins) {
      if (plugin.extendContext) {
        extendedContext = (await plugin.extendContext(extendedContext as any)) as WorkflowContext<TData, TOutputs>;
      }
    }

    return extendedContext;
  }

  private async applyVirtualOutputs(virtualOutputs: any | undefined, context: WorkflowContext<TData, TOutputs>): Promise<void> {
    if (!virtualOutputs) {
      return;
    }

    for (const [state, output] of Object.entries(virtualOutputs)) {
      const value = typeof output === 'function' ? await output(context as any) : output;
      (context.outputs as any)[state] = value;
    }
  }

  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}
