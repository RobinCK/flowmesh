import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ErrorHandler, ErrorContext, ErrorHandlingDecision } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum TestState {
  INITIAL = 'initial',
  FINAL = 'final',
}

interface TestData extends Record<string, unknown> {
  value: number;
  shouldFail?: boolean;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.INITIAL]: { started: boolean };
  [TestState.FINAL]: { completed: boolean };
}

// ErrorHandler as a class (for DI)
class DIErrorHandler implements ErrorHandler<TestData, TestOutputs> {
  public callCount = 0;
  public lastContext: ErrorContext<TestData, TestOutputs> | null = null;

  handle(context: ErrorContext<TestData, TestOutputs>): ErrorHandlingDecision {
    this.callCount++;
    this.lastContext = context;
    return ErrorHandlingDecision.FAIL;
  }
}

@State(TestState.INITIAL)
class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
    if (ctx.data.shouldFail) {
      throw new Error('Initial state failed');
    }
    actions.next({ output: { started: true } });
  }
}

@State(TestState.FINAL)
class FinalState implements IState<TestData, TestOutputs, TestState.FINAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FINAL>) {
    actions.next({ output: { completed: true } });
  }
}

describe('ErrorHandler DI Support', () => {
  beforeEach(() => {
    StateRegistry.clear();
    StateRegistry.autoRegister([new InitialState(), new FinalState()]);
  });

  describe('DI Resolution', () => {
    it('should resolve ErrorHandler class through instanceFactory', async () => {
      const diHandlerInstance = new DIErrorHandler();
      const persistence = new InMemoryPersistenceAdapter();
      let instanceFactoryCalled = false;

      const instanceFactory = <T>(classType: new (...args: any[]) => T): T => {
        if (classType === DIErrorHandler) {
          instanceFactoryCalled = true;
          return diHandlerInstance as T;
        }
        return new classType();
      };

      @Workflow({
        name: 'DITestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: DIErrorHandler as any,
      })
      class DITestWorkflow {}

      const engine = new WorkflowEngine({
        persistence,
        instanceFactory,
      });

      await expect(
        engine.execute(DITestWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');

      expect(instanceFactoryCalled).toBe(true);
      expect(diHandlerInstance.callCount).toBe(1);
      expect(diHandlerInstance.lastContext?.phase).toBe('state_execute');
    });

    it('should create new instance when no instanceFactory provided', async () => {
      @Workflow({
        name: 'NoFactoryWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: DIErrorHandler as any,
      })
      class NoFactoryWorkflow {}

      const engine = new WorkflowEngine({
        persistence: new InMemoryPersistenceAdapter(),
      });

      await expect(
        engine.execute(NoFactoryWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');
    });

    it('should use ErrorHandler instance directly without DI', async () => {
      const handlerInstance = new DIErrorHandler();
      const persistence = new InMemoryPersistenceAdapter();

      @Workflow({
        name: 'InstanceTestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: handlerInstance as any,
      })
      class InstanceTestWorkflow {}

      const engine = new WorkflowEngine({ persistence });

      await expect(
        engine.execute(InstanceTestWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');

      expect(handlerInstance.callCount).toBe(1);
      expect(handlerInstance.lastContext?.phase).toBe('state_execute');
      expect(handlerInstance.lastContext?.error.message).toBe('Initial state failed');
    });

    it('should use plain object ErrorHandler', async () => {
      let handlerCalled = false;
      let capturedValue: number | undefined;

      const plainHandler: ErrorHandler<TestData, TestOutputs> = {
        handle(context: ErrorContext<TestData, TestOutputs>): ErrorHandlingDecision {
          handlerCalled = true;
          capturedValue = context.workflowContext.data.value;
          return ErrorHandlingDecision.FAIL;
        },
      };

      @Workflow({
        name: 'PlainObjectTestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: plainHandler as any,
      })
      class PlainObjectTestWorkflow {}

      const engine = new WorkflowEngine({
        persistence: new InMemoryPersistenceAdapter(),
      });

      await expect(
        engine.execute(PlainObjectTestWorkflow, {
          data: { value: 42, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');

      expect(handlerCalled).toBe(true);
      expect(capturedValue).toBe(42);
    });
  });
});
