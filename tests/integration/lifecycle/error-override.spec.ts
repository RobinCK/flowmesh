import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, Retry } from '../../../src/decorators/state.decorator';
import { OnStateFailure } from '../../../src/decorators/lifecycle.decorator';
import { WorkflowContext, StateActions, IState, ErrorHandler, ErrorHandlingDecision } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { ExecutableWorkflow } from '../../../src/core/executable-workflow';

describe('Integration: @OnStateFailure Error Override', () => {
  enum ProcessingState {
    VALIDATE = 'VALIDATE',
    PROCESS = 'PROCESS',
    COMPLETE = 'COMPLETE',
    ERROR_RECOVERY = 'ERROR_RECOVERY',
  }

  interface ProcessingData extends Record<string, unknown> {
    errorType?: 'validation' | 'timeout' | 'network';
    userId?: string;
    value: number;
  }

  interface ProcessingOutputs extends Record<string, unknown> {
    VALIDATE: { validated: boolean; userId?: string };
    PROCESS: { processed: boolean };
    COMPLETE: { completed: boolean };
    ERROR_RECOVERY: { recovered: boolean };
  }

  class ValidationError extends Error {
    constructor(public field: string) {
      super(`Validation failed for ${field}`);
      this.name = 'ValidationError';
    }
  }

  class BusinessError extends Error {
    constructor(
      message: string,
      public code: string
    ) {
      super(message);
      this.name = 'BusinessError';
    }
  }

  class TimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TimeoutError';
    }
  }

  class NetworkError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'NetworkError';
    }
  }

  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    StateRegistry.clear();
  });

  it('should transform technical error to business error', async () => {
    @State(ProcessingState.VALIDATE)
    class ValidateState implements IState<ProcessingData, ProcessingOutputs, 'VALIDATE'> {
      execute(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>) {
        throw new Error('Database connection failed');
      }

      @OnStateFailure()
      onFailure(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>, error: Error): Error {
        return new BusinessError('Service unavailable', 'SVC_ERROR');
      }
    }

    @State(ProcessingState.COMPLETE)
    class CompleteState implements IState<ProcessingData, ProcessingOutputs, 'COMPLETE'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'COMPLETE'>
      ) {
        actions.complete({ output: { completed: true } });
      }
    }

    @Workflow({
      name: 'ProcessingWorkflow',
      states: ProcessingState,
      initialState: ProcessingState.VALIDATE,
    })
    class ProcessingWorkflow extends ExecutableWorkflow<ProcessingData> {}

    StateRegistry.autoRegister([new ValidateState(), new CompleteState()]);
    engine.registerWorkflow(ProcessingWorkflow);

    try {
      await engine.execute(ProcessingWorkflow, { data: { value: 1 } });
      fail('Expected BusinessError to be thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BusinessError);
      expect(error.code).toBe('SVC_ERROR');
      expect(error.message).toBe('Service unavailable');
    }
  });

  it('should pass overridden error to workflow error handler', async () => {
    let receivedError: Error | null = null;
    let handlerCalled = false;

    const errorHandler: ErrorHandler = {
      handle: context => {
        handlerCalled = true;
        receivedError = context.error;
        return {
          decision: ErrorHandlingDecision.TRANSITION_TO,
          targetState: ProcessingState.ERROR_RECOVERY,
        };
      },
    };

    @State(ProcessingState.PROCESS)
    class ProcessState implements IState<ProcessingData, ProcessingOutputs, 'PROCESS'> {
      execute(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>) {
        throw new Error('Processing failed');
      }

      @OnStateFailure()
      onFailure(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>, error: Error): Error {
        return new BusinessError('Business rule violation', 'BIZ_001');
      }
    }

    @State(ProcessingState.ERROR_RECOVERY)
    class ErrorRecoveryState implements IState<ProcessingData, ProcessingOutputs, 'ERROR_RECOVERY'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'ERROR_RECOVERY'>
      ) {
        actions.complete({ output: { recovered: true } });
      }
    }

    @Workflow({
      name: 'ErrorHandlingWorkflow',
      states: ProcessingState,
      initialState: ProcessingState.PROCESS,
      errorHandler,
      transitions: [{ from: ProcessingState.PROCESS, to: ProcessingState.ERROR_RECOVERY }],
    })
    class ErrorHandlingWorkflow extends ExecutableWorkflow<ProcessingData> {}

    StateRegistry.autoRegister([new ProcessState(), new ErrorRecoveryState()]);
    engine.registerWorkflow(ErrorHandlingWorkflow);

    const result = await engine.execute(ErrorHandlingWorkflow, { data: { value: 1 } });

    // Verify error handler received BusinessError, not original error
    expect(handlerCalled).toBe(true);
    expect(receivedError).toBeInstanceOf(BusinessError);
    expect(receivedError).not.toBeNull();
    if (receivedError) {
      expect((receivedError as BusinessError).code).toBe('BIZ_001');
    }

    // Verify workflow transitioned to ERROR_RECOVERY
    expect(result.currentState).toBe(ProcessingState.ERROR_RECOVERY);
    expect(result.outputs.ERROR_RECOVERY).toEqual({ recovered: true });
  });

  it('should override error before retry logic', async () => {
    const attemptErrors: Error[] = [];
    let attemptCount = 0;

    @State(ProcessingState.PROCESS)
    @Retry({ maxAttempts: 3, initialDelay: 10, strategy: 'fixed' })
    class RetryState implements IState<ProcessingData, ProcessingOutputs, 'PROCESS'> {
      execute(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>) {
        attemptCount++;
        throw new Error(`Attempt ${attemptCount} failed`);
      }

      @OnStateFailure()
      onFailure(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>, error: Error): Error {
        const transformed = new BusinessError(`Transformed: ${error.message}`, 'RETRY_ERROR');
        attemptErrors.push(transformed);
        return transformed;
      }
    }

    @State(ProcessingState.COMPLETE)
    class CompleteState implements IState<ProcessingData, ProcessingOutputs, 'COMPLETE'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'COMPLETE'>
      ) {
        actions.complete({ output: { completed: true } });
      }
    }

    @Workflow({
      name: 'RetryWithOverrideWorkflow',
      states: ProcessingState,
      initialState: ProcessingState.PROCESS,
      transitions: [{ from: ProcessingState.PROCESS, to: ProcessingState.COMPLETE }],
    })
    class RetryWithOverrideWorkflow extends ExecutableWorkflow<ProcessingData> {}

    StateRegistry.autoRegister([new RetryState(), new CompleteState()]);
    engine.registerWorkflow(RetryWithOverrideWorkflow);

    try {
      await engine.execute(RetryWithOverrideWorkflow, { data: { value: 1 } });
      fail('Expected error to be thrown');
    } catch (error: any) {
      // Verify all 3 attempts produced BusinessError
      expect(attemptErrors).toHaveLength(3);
      attemptErrors.forEach(err => {
        expect(err).toBeInstanceOf(BusinessError);
        expect(err.message).toContain('Transformed: Attempt');
      });
    }
  });

  it('should conditionally override based on error type', async () => {
    @State(ProcessingState.PROCESS)
    class ConditionalState implements IState<ProcessingData, ProcessingOutputs, 'PROCESS'> {
      execute(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>) {
        if (ctx.data.errorType === 'timeout') {
          throw new TimeoutError('Request timeout');
        }
        throw new NetworkError('Network unreachable');
      }

      @OnStateFailure()
      onFailure(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>, error: Error): Error | void {
        if (error instanceof TimeoutError) {
          return new BusinessError('Please try again', 'TIMEOUT');
        }
        // NetworkError remains unchanged
      }
    }

    @State(ProcessingState.COMPLETE)
    class CompleteState implements IState<ProcessingData, ProcessingOutputs, 'COMPLETE'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'COMPLETE'>
      ) {
        actions.complete({ output: { completed: true } });
      }
    }

    @Workflow({
      name: 'ConditionalOverrideWorkflow',
      states: ProcessingState,
      initialState: ProcessingState.PROCESS,
    })
    class ConditionalOverrideWorkflow extends ExecutableWorkflow<ProcessingData> {}

    StateRegistry.autoRegister([new ConditionalState(), new CompleteState()]);
    engine.registerWorkflow(ConditionalOverrideWorkflow);

    // Test 1: Timeout -> BusinessError
    try {
      await engine.execute(ConditionalOverrideWorkflow, {
        data: { value: 1, errorType: 'timeout' },
      });
      fail('Expected error');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BusinessError);
      expect(error.code).toBe('TIMEOUT');
    }

    // Test 2: Network -> NetworkError (no override)
    try {
      await engine.execute(ConditionalOverrideWorkflow, {
        data: { value: 1, errorType: 'network' },
      });
      fail('Expected error');
    } catch (error: any) {
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.message).toBe('Network unreachable');
    }
  });

  it('should access previous state outputs when overriding error', async () => {
    @State(ProcessingState.VALIDATE)
    class ValidateState implements IState<ProcessingData, ProcessingOutputs, 'VALIDATE'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'VALIDATE'>
      ) {
        actions.next({ output: { validated: true, userId: '12345' } });
      }
    }

    @State(ProcessingState.PROCESS)
    class ProcessState implements IState<ProcessingData, ProcessingOutputs, 'PROCESS'> {
      execute(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>) {
        throw new Error('Processing failed');
      }

      @OnStateFailure()
      onFailure(ctx: WorkflowContext<ProcessingData, ProcessingOutputs>, error: Error): Error {
        const validateOutput = ctx.outputs[ProcessingState.VALIDATE];
        return new BusinessError(`Processing failed for user ${validateOutput.userId}`, 'PROC_ERROR');
      }
    }

    @State(ProcessingState.COMPLETE)
    class CompleteState implements IState<ProcessingData, ProcessingOutputs, 'COMPLETE'> {
      execute(
        ctx: WorkflowContext<ProcessingData, ProcessingOutputs>,
        actions: StateActions<ProcessingData, ProcessingOutputs, 'COMPLETE'>
      ) {
        actions.complete({ output: { completed: true } });
      }
    }

    @Workflow({
      name: 'MultiStateWorkflow',
      states: ProcessingState,
      initialState: ProcessingState.VALIDATE,
      transitions: [
        { from: ProcessingState.VALIDATE, to: ProcessingState.PROCESS },
        { from: ProcessingState.PROCESS, to: ProcessingState.COMPLETE },
      ],
    })
    class MultiStateWorkflow extends ExecutableWorkflow<ProcessingData> {}

    StateRegistry.autoRegister([new ValidateState(), new ProcessState(), new CompleteState()]);
    engine.registerWorkflow(MultiStateWorkflow);

    try {
      await engine.execute(MultiStateWorkflow, { data: { value: 1 } });
      fail('Expected error');
    } catch (error: any) {
      expect(error).toBeInstanceOf(BusinessError);
      expect(error.message).toBe('Processing failed for user 12345');
      expect(error.code).toBe('PROC_ERROR');
    }
  });
});
