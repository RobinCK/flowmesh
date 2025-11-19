import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, RetryExhaustedException } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { ExecutableWorkflow } from '../../../src/core/executable-workflow';

describe('Integration: State without @Retry decorator', () => {
  enum TestState {
    INITIAL = 'INITIAL',
    COMPLETE = 'COMPLETE',
  }

  interface TestData extends Record<string, unknown> {
    value: number;
  }

  interface TestOutputs extends Record<string, unknown> {
    INITIAL: { initialized: boolean };
    COMPLETE: { completed: boolean };
  }

  class CustomBusinessError extends Error {
    constructor(
      message: string,
      public readonly code: string
    ) {
      super(message);
      this.name = 'CustomBusinessError';
    }
  }

  @State(TestState.INITIAL)
  // NO @Retry decorator - should throw original error
  class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
    execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
      // Throw custom business error
      throw new CustomBusinessError('Business validation failed', 'VALIDATION_ERROR');
    }
  }

  @State(TestState.COMPLETE)
  class CompleteState implements IState<TestData, TestOutputs, 'COMPLETE'> {
    execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'COMPLETE'>) {
      actions.complete({ output: { completed: true } });
    }
  }

  @Workflow({
    name: 'NoRetryTestWorkflow',
    states: TestState,
    initialState: TestState.INITIAL,
    transitions: [{ from: [TestState.INITIAL], to: TestState.COMPLETE }],
  })
  class NoRetryTestWorkflow extends ExecutableWorkflow<TestData> {}

  beforeEach(() => {
    StateRegistry.clear();
  });

  it('should throw original CustomBusinessError, not RetryExhaustedException', async () => {
    const initialState = new InitialState();
    const completeState = new CompleteState();

    StateRegistry.autoRegister([initialState, completeState]);

    const workflow = new NoRetryTestWorkflow();
    const engine = new WorkflowEngine();
    engine.registerWorkflow(NoRetryTestWorkflow);

    const data: TestData = {
      value: 42,
    };

    // Execute - should throw original CustomBusinessError
    await expect(workflow.execute(data)).rejects.toThrow(CustomBusinessError);

    // Verify it's the exact error type, not wrapped
    try {
      await workflow.execute(data);
      fail('Expected CustomBusinessError to be thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(CustomBusinessError);
      expect(error).not.toBeInstanceOf(RetryExhaustedException);
      expect(error.message).toBe('Business validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('should throw original Error for generic errors', async () => {
    @State(TestState.INITIAL)
    class FailingState implements IState<TestData, TestOutputs, 'INITIAL'> {
      execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
        throw new Error('Generic error message');
      }
    }

    const failingState = new FailingState();
    const completeState = new CompleteState();

    StateRegistry.autoRegister([failingState, completeState]);

    const workflow = new NoRetryTestWorkflow();

    const data: TestData = {
      value: 42,
    };

    // Should throw original Error, not RetryExhaustedException
    try {
      await workflow.execute(data);
      fail('Expected Error to be thrown');
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RetryExhaustedException);
      expect(error.message).toBe('Generic error message');
    }
  });
});
