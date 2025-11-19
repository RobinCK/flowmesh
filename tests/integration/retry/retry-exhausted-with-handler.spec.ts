import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, Retry } from '../../../src/decorators/state.decorator';
import { OnWorkflowError } from '../../../src/decorators/lifecycle.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus, RetryExhaustedException } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { ExecutableWorkflow } from '../../../src/core/executable-workflow';

describe('Integration: @Retry with @OnWorkflowError', () => {
  enum TestState {
    POLLING = 'POLLING',
    COMPLETE = 'COMPLETE',
  }

  interface TestData extends Record<string, unknown> {
    shouldSucceed: boolean;
    attemptsSeen: number;
  }

  interface TestOutputs extends Record<string, unknown> {
    POLLING: { polled: boolean };
    COMPLETE: { completed: boolean };
  }

  class CustomRetryExhaustedException extends Error {
    constructor(
      message: string,
      public readonly originalError: Error,
      public readonly attempts: number
    ) {
      super(message);
      this.name = 'CustomRetryExhaustedException';
    }
  }

  let errorHandlerCalled = false;
  let errorHandlerError: Error | null = null;
  let customExceptionThrown: CustomRetryExhaustedException | null = null;

  @State(TestState.POLLING)
  @Retry({
    maxAttempts: 3,
    initialDelay: 10,
    maxDelay: 50,
    strategy: 'fixed',
  })
  class PollingState implements IState<TestData, TestOutputs, 'POLLING'> {
    execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'POLLING'>) {
      ctx.data.attemptsSeen++;

      if (!ctx.data.shouldSucceed) {
        throw new Error('Polling failed - not ready yet');
      }

      actions.next({ output: { polled: true } });
    }
  }

  @State(TestState.COMPLETE)
  class CompleteState implements IState<TestData, TestOutputs, 'COMPLETE'> {
    execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'COMPLETE'>) {
      actions.complete({ output: { completed: true } });
    }
  }

  @Workflow({
    name: 'RetryTestWorkflow',
    states: TestState,
    initialState: TestState.POLLING,
    transitions: [{ from: [TestState.POLLING], to: TestState.COMPLETE }],
  })
  class RetryTestWorkflow extends ExecutableWorkflow<TestData> {
    @OnWorkflowError()
    async onError(context: WorkflowContext<TestData, TestOutputs>, error: Error): Promise<void> {
      errorHandlerCalled = true;
      errorHandlerError = error;

      if (error instanceof RetryExhaustedException && context.currentState === TestState.POLLING) {
        // Transform to custom exception
        const customError = new CustomRetryExhaustedException(
          `Polling did not complete in time after ${error.attempts} attempts`,
          error.originalError,
          error.attempts
        );
        customExceptionThrown = customError;
        throw customError;
      }
    }
  }

  beforeEach(() => {
    StateRegistry.clear();
    errorHandlerCalled = false;
    errorHandlerError = null;
    customExceptionThrown = null;
  });

  it('should call @OnWorkflowError with RetryExhaustedException and allow custom exception', async () => {
    const pollingState = new PollingState();
    const completeState = new CompleteState();

    StateRegistry.autoRegister([pollingState, completeState]);

    const workflow = new RetryTestWorkflow();
    const engine = new WorkflowEngine();
    engine.registerWorkflow(RetryTestWorkflow);

    const data: TestData = {
      shouldSucceed: false, // Will always fail
      attemptsSeen: 0,
    };

    // Execute - should retry 3 times then throw custom exception
    await expect(workflow.execute(data)).rejects.toThrow(CustomRetryExhaustedException);

    // Verify @OnWorkflowError was called
    expect(errorHandlerCalled).toBe(true);
    expect(errorHandlerError).toBeInstanceOf(RetryExhaustedException);

    // Verify custom exception was created
    expect(customExceptionThrown).toBeInstanceOf(CustomRetryExhaustedException);
    expect(customExceptionThrown?.message).toContain('Polling did not complete in time after 3 attempts');
    expect(customExceptionThrown?.attempts).toBe(3);
    expect(customExceptionThrown?.originalError.message).toBe('Polling failed - not ready yet');

    // Verify state was executed 3 times (maxAttempts)
    expect(data.attemptsSeen).toBe(3);
  });

  it('should succeed after retry and NOT call @OnWorkflowError', async () => {
    const pollingState = new PollingState();
    const completeState = new CompleteState();

    StateRegistry.autoRegister([pollingState, completeState]);

    const workflow = new RetryTestWorkflow();
    const engine = new WorkflowEngine();
    engine.registerWorkflow(RetryTestWorkflow);

    const data: TestData = {
      shouldSucceed: false, // Start failing
      attemptsSeen: 0,
    };

    // Mock - succeed on 2nd attempt
    const originalExecute = pollingState.execute.bind(pollingState);
    pollingState.execute = (ctx, actions) => {
      // Original execute will increment attemptsSeen
      // Check before calling original to set success condition
      if (ctx.data.attemptsSeen + 1 === 2) {
        // Succeed on 2nd attempt
        ctx.data.shouldSucceed = true;
      }

      return originalExecute(ctx, actions);
    };

    // Execute - should succeed after 2 attempts
    const result = await workflow.execute(data);

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.currentState).toBe(TestState.COMPLETE);

    // @OnWorkflowError should NOT be called on success
    expect(errorHandlerCalled).toBe(false);
    expect(customExceptionThrown).toBeNull();

    // Verify retried 2 times then succeeded
    expect(data.attemptsSeen).toBe(2);
  });
});
