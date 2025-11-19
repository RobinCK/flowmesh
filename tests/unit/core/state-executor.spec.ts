import { StateExecutor, ExecutionAction } from '../../../src/core/state-executor';
import { IState, WorkflowContext, StateActions, LoggerAdapter } from '../../../src/types';
import { OnStateStart, OnStateSuccess, OnStateFailure, OnStateFinish } from '../../../src/decorators/lifecycle.decorator';
import { ExecutionOrderTracker } from '../../helpers/execution-order-tracker';

enum TestState {
  A = 'A',
}

interface TestData extends Record<string, unknown> {
  value: number;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.A]: { result: string };
}

class MockLogger implements LoggerAdapter {
  logs: string[] = [];

  log(message: string) {
    this.logs.push(`log: ${message}`);
  }
  error(message: string, error?: Error) {
    this.logs.push(`error: ${message}`);
  }
  warn(message: string) {
    this.logs.push(`warn: ${message}`);
  }
  debug(message: string) {
    this.logs.push(`debug: ${message}`);
  }
}

describe('StateExecutor', () => {
  let executor: StateExecutor;
  let logger: MockLogger;
  let tracker: ExecutionOrderTracker;

  beforeEach(() => {
    logger = new MockLogger();
    executor = new StateExecutor(logger);
    tracker = new ExecutionOrderTracker();
  });

  describe('execute', () => {
    it('should execute state and call next', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.next({ output: { result: 'success' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 }, currentState: TestState.A } as WorkflowContext<TestData, TestOutputs>;

      const result = await executor.execute(state, context, TestState.A);

      expect(result.action).toBe(ExecutionAction.NEXT);
      expect(result.output).toEqual({ result: 'success' });
    });

    it('should call goto with target state', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.goto(TestState.A, { output: { result: 'goto' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      const result = await executor.execute(state, context, TestState.A);

      expect(result.action).toBe(ExecutionAction.GOTO);
      expect(result.targetState).toBe(TestState.A);
      expect(result.output).toEqual({ result: 'goto' });
    });

    it('should call suspend with metadata', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.suspend({ waitingFor: 'payment', output: { result: 'suspended' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      const result = await executor.execute(state, context, TestState.A);

      expect(result.action).toBe(ExecutionAction.SUSPEND);
      expect(result.suspensionMetadata?.waitingFor).toBe('payment');
      expect(result.output).toEqual({ result: 'suspended' });
    });

    it('should capture data updates', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.next({ data: { value: 42 }, output: { result: 'updated' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      const result = await executor.execute(state, context, TestState.A);

      expect(result.data).toEqual({ value: 42 });
    });
  });

  describe('lifecycle hooks order', () => {
    it('should call hooks in correct order: OnStateStart → execute → OnStateSuccess → OnStateFinish', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateStart()
        onStart() {
          tracker.track('onStart');
        }

        @OnStateSuccess()
        onSuccess() {
          tracker.track('onSuccess');
        }

        @OnStateFinish()
        onFinish() {
          tracker.track('onFinish');
        }

        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          tracker.track('execute');
          actions.next({ output: { result: 'done' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await executor.execute(state, context, TestState.A);

      tracker.assertOrder(['onStart', 'execute', 'onSuccess', 'onFinish']);
    });

    it('should call OnStateFailure and OnStateFinish on error', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateStart()
        onStart() {
          tracker.track('onStart');
        }

        @OnStateFailure()
        onFailure() {
          tracker.track('onFailure');
        }

        @OnStateFinish()
        onFinish() {
          tracker.track('onFinish');
        }

        execute() {
          tracker.track('execute');
          throw new Error('State failed');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow('State failed');

      tracker.assertOrder(['onStart', 'execute', 'onFailure', 'onFinish']);
    });

    it('should NOT call OnStateSuccess on error', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateSuccess()
        onSuccess() {
          tracker.track('onSuccess');
        }

        @OnStateFinish()
        onFinish() {
          tracker.track('onFinish');
        }

        execute() {
          throw new Error('State failed');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow();

      expect(tracker.getOrder()).not.toContain('onSuccess');
      expect(tracker.getOrder()).toContain('onFinish');
    });

    it('should pass output to OnStateSuccess', async () => {
      let capturedOutput: any;

      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateSuccess()
        onSuccess(ctx: any, output: any) {
          capturedOutput = output;
        }

        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.next({ output: { result: 'test-output' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await executor.execute(state, context, TestState.A);

      expect(capturedOutput).toEqual({ result: 'test-output' });
    });

    it('should pass error to OnStateFailure', async () => {
      let capturedError: any;

      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateFailure()
        onFailure(ctx: any, error: any) {
          capturedError = error;
        }

        execute() {
          throw new Error('Test error');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow();

      expect(capturedError).toBeInstanceOf(Error);
      expect(capturedError.message).toBe('Test error');
    });
  });

  describe('error handling', () => {
    it('should propagate error from execute', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new Error('Execute failed');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow('Execute failed');
    });

    it('should log error when execute fails', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new Error('State error');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow();

      expect(logger.logs.some(log => log.includes('error'))).toBe(true);
    });

    it('should swallow errors from lifecycle hooks', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateStart()
        onStart() {
          throw new Error('Hook error');
        }

        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.next({ output: { result: 'success' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      // Should not throw, hook error is swallowed
      const result = await executor.execute(state, context, TestState.A);

      expect(result.action).toBe(ExecutionAction.NEXT);
      expect(logger.logs.some(log => log.includes('warn'))).toBe(true);
    });

    it('should call OnStateFinish even if OnStateFailure throws', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        @OnStateFailure()
        onFailure() {
          tracker.track('onFailure');
          throw new Error('Failure hook error');
        }

        @OnStateFinish()
        onFinish() {
          tracker.track('onFinish');
        }

        execute() {
          throw new Error('State error');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      // When OnStateFailure throws, the thrown error becomes the new error (override behavior)
      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow('Failure hook error');

      expect(tracker.getOrder()).toContain('onFailure');
      expect(tracker.getOrder()).toContain('onFinish');
    });
  });

  describe('OnStateFailure error override', () => {
    class OriginalError extends Error {
      constructor() {
        super('Original error message');
        this.name = 'OriginalError';
      }
    }

    class TransformedError extends Error {
      constructor(public originalError: Error) {
        super('Transformed error message');
        this.name = 'TransformedError';
      }
    }

    it('should use overridden error when OnStateFailure returns new error', async () => {
      class ProcessingState implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new OriginalError();
        }

        @OnStateFailure()
        onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): Error {
          return new TransformedError(error);
        }
      }

      const state = new ProcessingState();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow('Transformed error message');

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(TransformedError);
        expect(error.originalError).toBeInstanceOf(OriginalError);
        expect(logger.logs.some(log => log.includes('overrode error to TransformedError'))).toBe(true);
      }
    });

    it('should preserve original error when OnStateFailure returns void', async () => {
      class VoidReturnState implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new OriginalError();
        }

        @OnStateFailure()
        onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): void {
          // Log or track error, but don't override
        }
      }

      const state = new VoidReturnState();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(OriginalError);
        expect(error.message).toBe('Original error message');
      }
    });

    it('should use thrown error as override when OnStateFailure throws', async () => {
      class ThrowingState implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new OriginalError();
        }

        @OnStateFailure()
        onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): void {
          throw new TransformedError(error);
        }
      }

      const state = new ThrowingState();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(TransformedError);
        expect(error.message).toBe('Transformed error message');
        expect(logger.logs.some(log => log.includes('threw error, using as override'))).toBe(true);
      }
    });

    it('should handle async error override in OnStateFailure', async () => {
      class AsyncOverrideState implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new OriginalError();
        }

        @OnStateFailure()
        async onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): Promise<Error> {
          // Simulate async operation (e.g., enriching error with external data)
          await new Promise(resolve => setTimeout(resolve, 10));
          return new TransformedError(error);
        }
      }

      const state = new AsyncOverrideState();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(TransformedError);
        expect(error.originalError).toBeInstanceOf(OriginalError);
      }
    });

    it('should allow wrapping original error with additional context', async () => {
      class ContextualError extends Error {
        constructor(
          message: string,
          public context: { userId: number; timestamp: number },
          public cause: Error
        ) {
          super(message);
          this.name = 'ContextualError';
        }
      }

      class ContextEnrichmentState implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>) {
          throw new Error('Invalid data');
        }

        @OnStateFailure()
        onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): Error {
          return new ContextualError('Validation failed', { userId: ctx.data.value, timestamp: Date.now() }, error);
        }
      }

      const state = new ContextEnrichmentState();
      const context = { data: { value: 42 } } as WorkflowContext<TestData, TestOutputs>;

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ContextualError);
        expect(error.context.userId).toBe(42);
        expect(error.context.timestamp).toBeDefined();
        expect(error.cause.message).toBe('Invalid data');
      }
    });

    it('should treat null/undefined return as no override', async () => {
      class UndefinedReturnState implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new OriginalError();
        }

        @OnStateFailure()
        onFailure(ctx: WorkflowContext<TestData, TestOutputs>, error: Error): undefined {
          return undefined;
        }
      }

      const state = new UndefinedReturnState();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      try {
        await executor.execute(state, context, TestState.A);
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(OriginalError);
      }
    });
  });

  describe('logging', () => {
    it('should log debug message on success', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
          actions.next({ output: { result: 'done' } });
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await executor.execute(state, context, TestState.A);

      expect(logger.logs.some(log => log.includes('debug') && log.includes('executed successfully'))).toBe(true);
    });

    it('should log error message on failure', async () => {
      class TestStateA implements IState<TestData, TestOutputs, TestState.A> {
        execute() {
          throw new Error('Failed');
        }
      }

      const state = new TestStateA();
      const context = { data: { value: 1 } } as WorkflowContext<TestData, TestOutputs>;

      await expect(executor.execute(state, context, TestState.A)).rejects.toThrow();

      expect(logger.logs.some(log => log.includes('error') && log.includes('failed'))).toBe(true);
    });
  });
});
