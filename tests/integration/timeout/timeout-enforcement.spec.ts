import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, Timeout } from '../../../src/decorators/state.decorator';
import {
  WorkflowContext,
  StateActions,
  IState,
  StateTimeoutException,
  ErrorHandler,
  ErrorContext,
  ErrorHandlingDecision,
} from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum TestState {
  INITIAL = 'initial',
  SLOW = 'slow',
  FAST = 'fast',
  RECOVERY = 'recovery',
  FINAL = 'final',
}

interface TestData extends Record<string, unknown> {
  value: number;
  delay?: number;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.INITIAL]: { started: boolean };
  [TestState.SLOW]: { processed: boolean };
  [TestState.FAST]: { processed: boolean };
  [TestState.RECOVERY]: { recovered: boolean };
  [TestState.FINAL]: { completed: boolean };
}

@State(TestState.INITIAL)
class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
    actions.next({ output: { started: true } });
  }
}

@State(TestState.SLOW)
@Timeout(100)
class SlowState implements IState<TestData, TestOutputs, TestState.SLOW> {
  async execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.SLOW>) {
    const delay = ctx.data.delay ?? 500;
    await new Promise(resolve => setTimeout(resolve, delay));
    actions.next({ output: { processed: true } });
  }
}

@State(TestState.FAST)
@Timeout(200)
class FastState implements IState<TestData, TestOutputs, TestState.FAST> {
  async execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FAST>) {
    await new Promise(resolve => setTimeout(resolve, 50));
    actions.next({ output: { processed: true } });
  }
}

@State(TestState.RECOVERY)
class RecoveryState implements IState<TestData, TestOutputs, TestState.RECOVERY> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.RECOVERY>) {
    actions.complete({ output: { recovered: true } });
  }
}

@State(TestState.FINAL)
class FinalState implements IState<TestData, TestOutputs, TestState.FINAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FINAL>) {
    actions.next({ output: { completed: true } });
  }
}

describe('Timeout Enforcement', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([new InitialState(), new SlowState(), new FastState(), new RecoveryState(), new FinalState()]);
  });

  describe('Basic Timeout Behavior', () => {
    it('should throw StateTimeoutException when state exceeds timeout', async () => {
      @Workflow({
        name: 'TimeoutTestWorkflow',
        states: TestState,
        initialState: TestState.SLOW,
      })
      class TimeoutTestWorkflow {}

      await expect(
        engine.execute(TimeoutTestWorkflow, {
          data: { value: 1, delay: 500 }, // 500ms > 100ms timeout
        })
      ).rejects.toThrow(StateTimeoutException);
    });

    it('should include state name and timeout info in exception', async () => {
      @Workflow({
        name: 'TimeoutInfoWorkflow',
        states: TestState,
        initialState: TestState.SLOW,
      })
      class TimeoutInfoWorkflow {}

      try {
        await engine.execute(TimeoutInfoWorkflow, {
          data: { value: 1, delay: 500 },
        });
        fail('Should have thrown StateTimeoutException');
      } catch (error) {
        expect(error).toBeInstanceOf(StateTimeoutException);
        if (error instanceof StateTimeoutException) {
          expect(error.stateName).toBe('slow');
          expect(error.timeoutMs).toBe(100);
          expect(error.elapsedMs).toBeGreaterThanOrEqual(100);
        }
      }
    });

    it('should NOT throw timeout when state completes in time', async () => {
      @Workflow({
        name: 'FastWorkflow',
        states: TestState,
        initialState: TestState.FAST,
      })
      class FastWorkflow {}

      const result = await engine.execute(FastWorkflow, {
        data: { value: 1 }, // 50ms < 200ms timeout
      });

      expect(result.status).toBe('completed');
      expect((result.outputs[TestState.FAST] as any)?.processed).toBe(true);
    });
  });

  describe('ErrorHandler Integration', () => {
    it('should allow catching StateTimeoutException in ErrorHandler', async () => {
      let timeoutCaught = false;

      const errorHandler: ErrorHandler<TestData, TestOutputs> = {
        handle(context: ErrorContext<TestData, TestOutputs>) {
          if (context.error instanceof StateTimeoutException) {
            timeoutCaught = true;
            return {
              decision: ErrorHandlingDecision.TRANSITION_TO,
              targetState: TestState.RECOVERY,
            };
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @Workflow({
        name: 'TimeoutRecoveryWorkflow',
        states: TestState,
        initialState: TestState.SLOW,
        errorHandler: errorHandler as any,
      })
      class TimeoutRecoveryWorkflow {}

      const result = await engine.execute(TimeoutRecoveryWorkflow, {
        data: { value: 1, delay: 500 },
      });

      expect(timeoutCaught).toBe(true);
      expect(result.currentState).toBe(TestState.RECOVERY);
      expect((result.outputs[TestState.RECOVERY] as any)?.recovered).toBe(true);
    });

    it('should allow distinguishing timeout from other errors', async () => {
      const errors: Array<{ type: string; phase: string }> = [];

      const errorHandler: ErrorHandler<TestData, TestOutputs> = {
        handle(context: ErrorContext<TestData, TestOutputs>) {
          if (context.error instanceof StateTimeoutException) {
            errors.push({ type: 'timeout', phase: context.phase });
          } else {
            errors.push({ type: 'other', phase: context.phase });
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @Workflow({
        name: 'ErrorTypeWorkflow',
        states: TestState,
        initialState: TestState.SLOW,
        errorHandler: errorHandler as any,
      })
      class ErrorTypeWorkflow {}

      await expect(
        engine.execute(ErrorTypeWorkflow, {
          data: { value: 1, delay: 500 },
        })
      ).rejects.toThrow();

      expect(errors).toHaveLength(1);
      expect(errors[0].type).toBe('timeout');
      expect(errors[0].phase).toBe('state_execute');
    });
  });

  describe('State without @Timeout', () => {
    it('should execute normally without timeout enforcement', async () => {
      @Workflow({
        name: 'NoTimeoutWorkflow',
        states: TestState,
        initialState: TestState.RECOVERY, // No @Timeout decorator
      })
      class NoTimeoutWorkflow {}

      const result = await engine.execute(NoTimeoutWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
    });
  });
});
