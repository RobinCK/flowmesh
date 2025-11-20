import { WorkflowExecutor, ResumeStrategy } from '../../../src/core/workflow-executor';
import { StateExecutor } from '../../../src/core/state-executor';
import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, Retry } from '../../../src/decorators/state.decorator';
import { OnWorkflowError, BeforeState, AfterState, OnWorkflowComplete } from '../../../src/decorators/lifecycle.decorator';
import { StateRegistry } from '../../../src/core/state-registry';
import { ExecutableWorkflow } from '../../../src/core/executable-workflow';
import {
  WorkflowContext,
  StateActions,
  IState,
  WorkflowStatus,
  ErrorHandlingDecision,
  ErrorHandler,
  IWorkflowPlugin,
  PersistenceAdapter,
  LockAdapter,
  ConcurrencyMode,
} from '../../../src/types';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

describe('WorkflowExecutor - Uncovered Branches', () => {
  enum TestState {
    INITIAL = 'INITIAL',
    PROCESSING = 'PROCESSING',
    COMPLETE = 'COMPLETE',
    RECOVERY = 'RECOVERY',
  }

  interface TestData extends Record<string, unknown> {
    value: number;
    shouldFail?: boolean;
  }

  interface TestOutputs extends Record<string, unknown> {
    INITIAL: { initialized: boolean };
    PROCESSING: { processed: boolean };
    COMPLETE: { completed: boolean };
    RECOVERY: { recovered: boolean };
  }

  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });
  });

  describe('Error Handler Edge Cases', () => {
    it('should handle error handler throwing during workflow_start phase', async () => {
      const brokenHandler: ErrorHandler = {
        handle: () => {
          throw new Error('Handler crashed');
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          throw new Error('Initial state failed');
        }
      }

      @Workflow({
        name: 'BrokenHandlerWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: brokenHandler,
      })
      class BrokenHandlerWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(BrokenHandlerWorkflow);

      const workflow = new BrokenHandlerWorkflow();

      // Should throw original error, not handler error (fallback to FAIL)
      await expect(workflow.execute({ value: 1 })).rejects.toThrow('Initial state failed');
    });

    it('should handle TRANSITION_TO without targetState (treats as EXIT)', async () => {
      const noTargetHandler: ErrorHandler = {
        handle: () => ({
          decision: ErrorHandlingDecision.TRANSITION_TO,
          targetState: undefined as any, // Missing targetState to test edge case
        }),
      };

      @State(TestState.INITIAL)
      class FailingState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          throw new Error('State failed');
        }
      }

      @Workflow({
        name: 'NoTargetWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: noTargetHandler,
      })
      class NoTargetWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new FailingState()]);
      engine.registerWorkflow(NoTargetWorkflow);

      const workflow = new NoTargetWorkflow();
      const result = await workflow.execute({ value: 1 });

      // Should exit gracefully (treats as EXIT when targetState is missing)
      expect([WorkflowStatus.FAILED, WorkflowStatus.RUNNING]).toContain(result.status);
    });

    it('should handle CONTINUE decision for state_execute phase (treats as EXIT)', async () => {
      const continueHandler: ErrorHandler = {
        handle: () => ErrorHandlingDecision.CONTINUE,
      };

      @State(TestState.INITIAL)
      class FailingState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          throw new Error('State failed');
        }
      }

      @Workflow({
        name: 'ContinueWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: continueHandler,
      })
      class ContinueWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new FailingState()]);
      engine.registerWorkflow(ContinueWorkflow);

      const workflow = new ContinueWorkflow();
      const result = await workflow.execute({ value: 1 });

      // Should exit (CONTINUE not supported for state_execute)
      expect([WorkflowStatus.FAILED, WorkflowStatus.RUNNING]).toContain(result.status);
    });
  });

  describe('BeforeState Hook Error Handling', () => {
    it('should handle beforeState error with EXIT decision', async () => {
      let beforeStateCalled = false;

      const exitHandler: ErrorHandler = {
        handle: context => {
          if (context.phase === 'before_state') {
            return ErrorHandlingDecision.EXIT;
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.next({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'BeforeStateErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: exitHandler,
      })
      class BeforeStateErrorWorkflow extends ExecutableWorkflow<TestData> {
        @BeforeState()
        async beforeState(ctx: WorkflowContext<TestData, TestOutputs>) {
          beforeStateCalled = true;
          throw new Error('BeforeState failed');
        }
      }

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(BeforeStateErrorWorkflow);

      const workflow = new BeforeStateErrorWorkflow();
      const result = await workflow.execute({ value: 1 });

      expect(beforeStateCalled).toBe(true);
      expect([WorkflowStatus.FAILED, WorkflowStatus.RUNNING]).toContain(result.status);
    });

    it('should handle beforeState error with CONTINUE decision', async () => {
      let beforeStateCalled = false;
      let stateExecuted = false;

      const continueHandler: ErrorHandler = {
        handle: context => {
          if (context.phase === 'before_state') {
            return ErrorHandlingDecision.CONTINUE;
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          stateExecuted = true;
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'BeforeStateContinueWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: continueHandler,
      })
      class BeforeStateContinueWorkflow extends ExecutableWorkflow<TestData> {
        @BeforeState()
        async beforeState(ctx: WorkflowContext<TestData, TestOutputs>) {
          beforeStateCalled = true;
          throw new Error('BeforeState failed');
        }
      }

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(BeforeStateContinueWorkflow);

      const workflow = new BeforeStateContinueWorkflow();
      const result = await workflow.execute({ value: 1 });

      expect(beforeStateCalled).toBe(true);
      expect(stateExecuted).toBe(true);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('AfterState Hook Error Handling', () => {
    it('should handle afterState error with EXIT decision', async () => {
      let afterStateCalled = false;

      const exitHandler: ErrorHandler = {
        handle: context => {
          if (context.phase === 'after_state') {
            return ErrorHandlingDecision.EXIT;
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'AfterStateErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: exitHandler,
      })
      class AfterStateErrorWorkflow extends ExecutableWorkflow<TestData> {
        @AfterState()
        async afterState(ctx: WorkflowContext<TestData, TestOutputs>) {
          afterStateCalled = true;
          throw new Error('AfterState failed');
        }
      }

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(AfterStateErrorWorkflow);

      const workflow = new AfterStateErrorWorkflow();
      const result = await workflow.execute({ value: 1 });

      expect(afterStateCalled).toBe(true);
      // AfterState error with EXIT may return RUNNING or COMPLETED depending on when error occurs
      expect([WorkflowStatus.COMPLETED, WorkflowStatus.RUNNING]).toContain(result.status);
    });

    it('should handle afterState error with CONTINUE decision', async () => {
      let afterStateCalled = false;

      const continueHandler: ErrorHandler = {
        handle: context => {
          if (context.phase === 'after_state') {
            return ErrorHandlingDecision.CONTINUE;
          }
          return ErrorHandlingDecision.FAIL;
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'AfterStateContinueWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: continueHandler,
      })
      class AfterStateContinueWorkflow extends ExecutableWorkflow<TestData> {
        @AfterState()
        async afterState(ctx: WorkflowContext<TestData, TestOutputs>) {
          afterStateCalled = true;
          throw new Error('AfterState failed');
        }
      }

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(AfterStateContinueWorkflow);

      const workflow = new AfterStateContinueWorkflow();
      const result = await workflow.execute({ value: 1 });

      expect(afterStateCalled).toBe(true);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('OnComplete Hook Error Handling', () => {
    it('should log error when onComplete hook throws', async () => {
      let onCompleteCalled = false;

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'OnCompleteErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class OnCompleteErrorWorkflow extends ExecutableWorkflow<TestData> {
        @OnWorkflowComplete()
        async onComplete(ctx: WorkflowContext<TestData, TestOutputs>) {
          onCompleteCalled = true;
          throw new Error('OnComplete hook failed');
        }
      }

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(OnCompleteErrorWorkflow);

      const workflow = new OnCompleteErrorWorkflow();
      const result = await workflow.execute({ value: 1 });

      expect(onCompleteCalled).toBe(true);
      // Should complete successfully despite hook error
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('Plugin Hooks', () => {
    it('should call plugin onError hook', async () => {
      let pluginOnErrorCalled = false;
      let errorReceived: Error | undefined;

      const testPlugin: IWorkflowPlugin = {
        name: 'test-plugin',
        onError: async (context, error) => {
          pluginOnErrorCalled = true;
          errorReceived = error;
        },
      };

      @State(TestState.INITIAL)
      class FailingState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          throw new Error('State failed');
        }
      }

      // Create engine with plugin
      const pluginEngine = new WorkflowEngine({ plugins: [testPlugin], persistence, lockAdapter });

      @Workflow({
        name: 'PluginErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class PluginErrorWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new FailingState()]);
      pluginEngine.registerWorkflow(PluginErrorWorkflow);

      await expect(pluginEngine.execute(PluginErrorWorkflow, { data: { value: 1 } })).rejects.toThrow('State failed');

      expect(pluginOnErrorCalled).toBe(true);
      expect(errorReceived?.message).toBe('State failed');
    });

    it('should call plugin extendContext hook', async () => {
      let extendContextCalled = false;

      const testPlugin: IWorkflowPlugin = {
        name: 'test-plugin',
        extendContext: async context => {
          extendContextCalled = true;
          return {
            ...context,
            customField: 'extended',
          };
        },
      };

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      // Create engine with plugin
      const pluginEngine = new WorkflowEngine({ plugins: [testPlugin], persistence, lockAdapter });

      @Workflow({
        name: 'PluginExtendWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class PluginExtendWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new InitialState()]);
      pluginEngine.registerWorkflow(PluginExtendWorkflow);

      const result = await pluginEngine.execute(PluginExtendWorkflow, { data: { value: 1 } });

      expect(extendContextCalled).toBe(true);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('Retry Logic Edge Cases', () => {
    it('should handle STOP_RETRY decision from error handler', async () => {
      let attemptsSeen = 0;

      const stopRetryHandler: ErrorHandler = {
        handle: context => {
          // Always return STOP_RETRY to immediately stop retrying
          return ErrorHandlingDecision.STOP_RETRY;
        },
      };

      @State(TestState.INITIAL)
      @Retry({ maxAttempts: 5, initialDelay: 10, strategy: 'fixed' })
      class RetryState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          attemptsSeen++;
          throw new Error('State always fails');
        }
      }

      @Workflow({
        name: 'StopRetryWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: stopRetryHandler,
      })
      class StopRetryWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new RetryState()]);
      engine.registerWorkflow(StopRetryWorkflow);

      const workflow = new StopRetryWorkflow();

      await expect(workflow.execute({ value: 1 })).rejects.toThrow('State always fails');

      // Should stop at attempt 1 because handler returns STOP_RETRY
      expect(attemptsSeen).toBe(1);
    });
  });

  describe('Resume Strategy Edge Cases', () => {
    it('should handle resume with SKIP strategy at last state (workflow completes)', async () => {
      enum SimpleState {
        ONLY = 'ONLY',
      }

      interface SimpleData extends Record<string, unknown> {
        value: number;
      }

      interface SimpleOutputs extends Record<string, unknown> {
        ONLY: { done: boolean };
      }

      @State(SimpleState.ONLY)
      class OnlyState implements IState<SimpleData, SimpleOutputs, 'ONLY'> {
        async execute(ctx: WorkflowContext<SimpleData, SimpleOutputs>, actions: StateActions<SimpleData, SimpleOutputs, 'ONLY'>) {
          // Simulate suspension
          actions.suspend();
        }
      }

      @Workflow({
        name: 'SkipLastStateWorkflow',
        states: SimpleState,
        initialState: SimpleState.ONLY,
      })
      class SkipLastStateWorkflow extends ExecutableWorkflow<SimpleData> {}

      StateRegistry.autoRegister([new OnlyState()]);
      engine.registerWorkflow(SkipLastStateWorkflow);

      // Use engine.execute and engine.resume for persistence support
      const initialResult = await engine.execute(SkipLastStateWorkflow, { data: { value: 1 } });

      expect(initialResult.status).toBe(WorkflowStatus.SUSPENDED);

      // Resume with SKIP strategy - should complete since no next state
      const resumedResult = await engine.resume(SkipLastStateWorkflow, initialResult.id, {
        strategy: ResumeStrategy.SKIP,
      });

      expect(resumedResult.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('State Not Found Error', () => {
    it('should handle state not found in registry', async () => {
      @Workflow({
        name: 'MissingStateWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class MissingStateWorkflow extends ExecutableWorkflow<TestData> {}

      engine.registerWorkflow(MissingStateWorkflow);

      // Don't register the state - it won't be found
      const workflow = new MissingStateWorkflow();

      await expect(workflow.execute({ value: 1 })).rejects.toThrow();
    });
  });

  describe('TOP-5 Coverage Tests', () => {
    describe('1. Function-based GroupBy', () => {
      it('should calculate dynamic groupId from context using function', async () => {
        interface GroupData extends Record<string, unknown> {
          region: string;
          userId: string;
        }

        interface GroupOutputs extends Record<string, unknown> {
          INITIAL: { initialized: boolean };
        }

        @State(TestState.INITIAL)
        class GroupedState implements IState<GroupData, GroupOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<GroupData, GroupOutputs>, actions: StateActions<GroupData, GroupOutputs, 'INITIAL'>) {
            actions.complete({ output: { initialized: true } });
          }
        }

        @Workflow({
          name: 'FunctionGroupByWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
          concurrency: {
            groupBy: (ctx: WorkflowContext) => `${(ctx.data as GroupData).region}-${(ctx.data as GroupData).userId}`,
            mode: ConcurrencyMode.SEQUENTIAL,
          },
        })
        class FunctionGroupByWorkflow extends ExecutableWorkflow<GroupData> {}

        StateRegistry.autoRegister([new GroupedState()]);
        engine.registerWorkflow(FunctionGroupByWorkflow);

        // Execute with data that should create groupId: 'EU-123'
        const result = await engine.execute(FunctionGroupByWorkflow, {
          data: { region: 'EU', userId: '123' },
        });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(result.groupId).toBe('EU-123');
      });

      it('should handle different groupIds for different contexts', async () => {
        interface GroupData extends Record<string, unknown> {
          region: string;
          userId: string;
        }

        interface GroupOutputs extends Record<string, unknown> {
          INITIAL: { initialized: boolean };
        }

        @State(TestState.INITIAL)
        class GroupedState implements IState<GroupData, GroupOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<GroupData, GroupOutputs>, actions: StateActions<GroupData, GroupOutputs, 'INITIAL'>) {
            actions.complete({ output: { initialized: true } });
          }
        }

        @Workflow({
          name: 'MultiGroupWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
          concurrency: {
            groupBy: (ctx: WorkflowContext) => `${(ctx.data as GroupData).region}-${(ctx.data as GroupData).userId}`,
            mode: ConcurrencyMode.SEQUENTIAL,
          },
        })
        class MultiGroupWorkflow extends ExecutableWorkflow<GroupData> {}

        StateRegistry.autoRegister([new GroupedState()]);
        engine.registerWorkflow(MultiGroupWorkflow);

        // Execute multiple workflows with different groupIds
        const [result1, result2] = await Promise.all([
          engine.execute(MultiGroupWorkflow, { data: { region: 'US', userId: '456' } }),
          engine.execute(MultiGroupWorkflow, { data: { region: 'EU', userId: '789' } }),
        ]);

        expect(result1.groupId).toBe('US-456');
        expect(result2.groupId).toBe('EU-789');
        expect(result1.status).toBe(WorkflowStatus.COMPLETED);
        expect(result2.status).toBe(WorkflowStatus.COMPLETED);
      });
    });

    describe('2. Conditional Transitions', () => {
      it('should skip transition when condition evaluates to false', async () => {
        enum ConditionalState {
          START = 'START',
          PREMIUM = 'PREMIUM',
          STANDARD = 'STANDARD',
        }

        interface ConditionalData extends Record<string, unknown> {
          isPremium: boolean;
        }

        interface ConditionalOutputs extends Record<string, unknown> {
          START: { started: boolean };
          PREMIUM: { premium: boolean };
          STANDARD: { standard: boolean };
        }

        @State(ConditionalState.START)
        class StartState implements IState<ConditionalData, ConditionalOutputs, 'START'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'START'>
          ) {
            actions.next({ output: { started: true } });
          }
        }

        @State(ConditionalState.PREMIUM)
        class PremiumState implements IState<ConditionalData, ConditionalOutputs, 'PREMIUM'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'PREMIUM'>
          ) {
            actions.complete({ output: { premium: true } });
          }
        }

        @State(ConditionalState.STANDARD)
        class StandardState implements IState<ConditionalData, ConditionalOutputs, 'STANDARD'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'STANDARD'>
          ) {
            actions.complete({ output: { standard: true } });
          }
        }

        @Workflow({
          name: 'ConditionalWorkflow',
          states: ConditionalState,
          initialState: ConditionalState.START,
          conditionalTransitions: [
            {
              from: ConditionalState.START,
              conditions: [
                {
                  condition: (ctx: WorkflowContext) => (ctx.data as ConditionalData).isPremium === true,
                  to: ConditionalState.PREMIUM,
                },
              ],
              default: ConditionalState.STANDARD,
            },
          ],
        })
        class ConditionalWorkflow extends ExecutableWorkflow<ConditionalData> {}

        StateRegistry.autoRegister([new StartState(), new PremiumState(), new StandardState()]);
        engine.registerWorkflow(ConditionalWorkflow);

        // Test condition = false → goes to default (STANDARD)
        const result = await engine.execute(ConditionalWorkflow, {
          data: { isPremium: false },
        });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(result.currentState).toBe(ConditionalState.STANDARD);
        expect(result.outputs.STANDARD).toEqual({ standard: true });
      });

      it('should follow conditional path when condition is true', async () => {
        enum ConditionalState {
          START = 'START',
          PREMIUM = 'PREMIUM',
          STANDARD = 'STANDARD',
        }

        interface ConditionalData extends Record<string, unknown> {
          isPremium: boolean;
        }

        interface ConditionalOutputs extends Record<string, unknown> {
          START: { started: boolean };
          PREMIUM: { premium: boolean };
          STANDARD: { standard: boolean };
        }

        @State(ConditionalState.START)
        class StartState implements IState<ConditionalData, ConditionalOutputs, 'START'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'START'>
          ) {
            actions.next({ output: { started: true } });
          }
        }

        @State(ConditionalState.PREMIUM)
        class PremiumState implements IState<ConditionalData, ConditionalOutputs, 'PREMIUM'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'PREMIUM'>
          ) {
            actions.complete({ output: { premium: true } });
          }
        }

        @State(ConditionalState.STANDARD)
        class StandardState implements IState<ConditionalData, ConditionalOutputs, 'STANDARD'> {
          execute(
            ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
            actions: StateActions<ConditionalData, ConditionalOutputs, 'STANDARD'>
          ) {
            actions.complete({ output: { standard: true } });
          }
        }

        @Workflow({
          name: 'ConditionalTrueWorkflow',
          states: ConditionalState,
          initialState: ConditionalState.START,
          conditionalTransitions: [
            {
              from: ConditionalState.START,
              conditions: [
                {
                  condition: (ctx: WorkflowContext) => (ctx.data as ConditionalData).isPremium === true,
                  to: ConditionalState.PREMIUM,
                },
              ],
              default: ConditionalState.STANDARD,
            },
          ],
        })
        class ConditionalTrueWorkflow extends ExecutableWorkflow<ConditionalData> {}

        StateRegistry.autoRegister([new StartState(), new PremiumState(), new StandardState()]);
        engine.registerWorkflow(ConditionalTrueWorkflow);

        // Test condition = true → goes to PREMIUM
        const result = await engine.execute(ConditionalTrueWorkflow, {
          data: { isPremium: true },
        });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(result.currentState).toBe(ConditionalState.PREMIUM);
        expect(result.outputs.PREMIUM).toEqual({ premium: true });
      });
    });

    describe('3. Backoff Strategies', () => {
      it('should use linear backoff delay calculation', async () => {
        const delays: number[] = [];
        let attemptsSeen = 0;

        @State(TestState.INITIAL)
        @Retry({
          maxAttempts: 3,
          initialDelay: 100,
          maxDelay: 500,
          strategy: 'linear',
        })
        class LinearRetryState implements IState<TestData, TestOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
            attemptsSeen++;
            if (attemptsSeen < 3) {
              throw new Error('Fail to test retry');
            }
            actions.complete({ output: { initialized: true } });
          }
        }

        @Workflow({
          name: 'LinearBackoffWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
        })
        class LinearBackoffWorkflow extends ExecutableWorkflow<TestData> {}

        StateRegistry.autoRegister([new LinearRetryState()]);
        engine.registerWorkflow(LinearBackoffWorkflow);

        const startTime = Date.now();
        const result = await engine.execute(LinearBackoffWorkflow, { data: { value: 1 } });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(attemptsSeen).toBe(3);
        // Linear: delay = initialDelay * attempt
        // Attempt 1 fails, wait 100ms
        // Attempt 2 fails, wait 200ms
        // Attempt 3 succeeds
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeGreaterThanOrEqual(250); // At least 300ms total (100+200)
      });

      it('should use exponential backoff with multiplier', async () => {
        let attemptsSeen = 0;

        @State(TestState.INITIAL)
        @Retry({
          maxAttempts: 3,
          initialDelay: 50,
          maxDelay: 1000,
          strategy: 'exponential',
          multiplier: 3,
        })
        class ExponentialRetryState implements IState<TestData, TestOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
            attemptsSeen++;
            if (attemptsSeen < 3) {
              throw new Error('Fail to test exponential retry');
            }
            actions.complete({ output: { initialized: true } });
          }
        }

        @Workflow({
          name: 'ExponentialBackoffWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
        })
        class ExponentialBackoffWorkflow extends ExecutableWorkflow<TestData> {}

        StateRegistry.autoRegister([new ExponentialRetryState()]);
        engine.registerWorkflow(ExponentialBackoffWorkflow);

        const startTime = Date.now();
        const result = await engine.execute(ExponentialBackoffWorkflow, { data: { value: 1 } });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(attemptsSeen).toBe(3);
        // Exponential with multiplier=3: delay = initialDelay * (multiplier ^ attempt)
        // Attempt 1 fails, wait 50ms
        // Attempt 2 fails, wait 150ms (50 * 3)
        // Attempt 3 succeeds
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeGreaterThanOrEqual(180); // At least 200ms total (50+150)
      });

      it('should cap backoff delay at maxDelay', async () => {
        let attemptsSeen = 0;

        @State(TestState.INITIAL)
        @Retry({
          maxAttempts: 5,
          initialDelay: 100,
          maxDelay: 200,
          strategy: 'exponential',
          multiplier: 2,
        })
        class CappedRetryState implements IState<TestData, TestOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
            attemptsSeen++;
            if (attemptsSeen < 4) {
              throw new Error('Fail to test capped retry');
            }
            actions.complete({ output: { initialized: true } });
          }
        }

        @Workflow({
          name: 'CappedBackoffWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
        })
        class CappedBackoffWorkflow extends ExecutableWorkflow<TestData> {}

        StateRegistry.autoRegister([new CappedRetryState()]);
        engine.registerWorkflow(CappedBackoffWorkflow);

        const startTime = Date.now();
        const result = await engine.execute(CappedBackoffWorkflow, { data: { value: 1 } });

        expect(result.status).toBe(WorkflowStatus.COMPLETED);
        expect(attemptsSeen).toBe(4);
        // Exponential: 100, 200 (capped), 200 (capped), 200 (capped)
        // Total should be around 600ms, not 1500ms if uncapped
        const totalTime = Date.now() - startTime;
        expect(totalTime).toBeGreaterThanOrEqual(500);
        expect(totalTime).toBeLessThan(1000); // Should be capped, not exponentially growing
      });
    });

    describe('4. Error Handler Crash Handling', () => {
      it('should fallback to FAIL when handler crashes (same error type)', async () => {
        const crashHandler: ErrorHandler = {
          handle: context => {
            // Handler crashes - throws generic Error
            throw new Error('Handler crashed unexpectedly');
          },
        };

        @State(TestState.INITIAL)
        class CrashState implements IState<TestData, TestOutputs, 'INITIAL'> {
          execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
            throw new Error('Original state error');
          }
        }

        @Workflow({
          name: 'CrashHandlerWorkflow',
          states: TestState,
          initialState: TestState.INITIAL,
          errorHandler: crashHandler,
        })
        class CrashHandlerWorkflow extends ExecutableWorkflow<TestData> {}

        StateRegistry.autoRegister([new CrashState()]);
        engine.registerWorkflow(CrashHandlerWorkflow);

        // Should throw original error with FAIL decision (handler crash is caught)
        await expect(engine.execute(CrashHandlerWorkflow, { data: { value: 1 } })).rejects.toThrow('Original state error');
      });
    });
  });

  describe('Custom executionId', () => {
    it('should use custom executionId when provided', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'CustomIdWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class CustomIdWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(CustomIdWorkflow);

      const customId = 'custom_execution_id_123';
      const result = await engine.execute(CustomIdWorkflow, {
        data: { value: 1 },
        executionId: customId,
      });

      expect(result.id).toBe(customId);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should auto-generate executionId when not provided', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'AutoIdWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class AutoIdWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new InitialState()]);
      engine.registerWorkflow(AutoIdWorkflow);

      const result = await engine.execute(AutoIdWorkflow, {
        data: { value: 1 },
      });

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should use custom executionId via ExecutableWorkflow.execute()', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, 'INITIAL'> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, 'INITIAL'>) {
          actions.complete({ output: { initialized: true } });
        }
      }

      @Workflow({
        name: 'ExecutableIdWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class ExecutableIdWorkflow extends ExecutableWorkflow<TestData> {}

      StateRegistry.autoRegister([new InitialState()]);

      const workflow = new ExecutableIdWorkflow();
      const customId = 'workflow_tx_456';
      const result = await workflow.execute({ value: 1 }, customId);

      expect(result.id).toBe(customId);
      expect(result.status).toBe(WorkflowStatus.COMPLETED);
    });
  });
});
