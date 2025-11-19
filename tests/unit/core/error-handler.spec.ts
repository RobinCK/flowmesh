import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { BeforeState, AfterState, OnWorkflowStart } from '../../../src/decorators/lifecycle.decorator';
import {
  WorkflowContext,
  StateActions,
  IState,
  ErrorHandler,
  ErrorContext,
  ErrorHandlingDecision,
  ConcurrencyMode,
} from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

enum TestState {
  INITIAL = 'initial',
  PROCESSING = 'processing',
  FINAL = 'final',
}

interface TestData extends Record<string, unknown> {
  value: number;
  shouldFail?: boolean;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.INITIAL]: { started: boolean };
  [TestState.PROCESSING]: { processed: boolean };
  [TestState.FINAL]: { completed: boolean };
}

class ErrorTrackingHandler implements ErrorHandler {
  public invocations: Array<{
    error: Error;
    phase: string;
    contextState: string;
    decision: ErrorHandlingDecision;
  }> = [];

  constructor(private readonly decisionMap: Record<string, ErrorHandlingDecision>) {}

  handle(context: ErrorContext): ErrorHandlingDecision {
    const decision = this.decisionMap[context.phase] || ErrorHandlingDecision.FAIL;

    this.invocations.push({
      error: context.error,
      phase: context.phase,
      contextState: String(context.workflowContext.currentState),
      decision,
    });

    return decision;
  }

  reset() {
    this.invocations = [];
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

@State(TestState.PROCESSING)
class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
    if (ctx.data.shouldFail) {
      throw new Error('Processing failed');
    }
    actions.next({ output: { processed: true } });
  }
}

@State(TestState.FINAL)
class FinalState implements IState<TestData, TestOutputs, TestState.FINAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FINAL>) {
    actions.next({ output: { completed: true } });
  }
}

describe('Error Handler', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;
  let errorHandler: ErrorTrackingHandler;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([new InitialState(), new ProcessingState(), new FinalState()]);
  });

  describe('ErrorHandlingDecision.CONTINUE', () => {
    it('should continue workflow execution after beforeState error', async () => {
      errorHandler = new ErrorTrackingHandler({
        before_state: ErrorHandlingDecision.CONTINUE,
      });

      @Workflow({
        name: 'ContinueWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class ContinueWorkflow {
        @BeforeState()
        async beforeState() {
          throw new Error('BeforeState failed');
        }
      }

      const result = await engine.execute(ContinueWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(errorHandler.invocations.length).toBeGreaterThan(0);
      expect(errorHandler.invocations[0].phase).toBe('before_state');
    });

    it('should continue workflow execution after afterState error', async () => {
      errorHandler = new ErrorTrackingHandler({
        after_state: ErrorHandlingDecision.CONTINUE,
      });

      @Workflow({
        name: 'ContinueAfterWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class ContinueAfterWorkflow {
        @AfterState()
        async afterState() {
          throw new Error('AfterState failed');
        }
      }

      const result = await engine.execute(ContinueAfterWorkflow, {
        data: { value: 42 },
      });

      expect(result.data.value).toBe(42);
      expect(result.status).toBe('completed');
    });
  });

  describe('ErrorHandlingDecision.EXIT', () => {
    it('should exit gracefully without throwing when handler returns EXIT', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.EXIT,
      });

      @Workflow({
        name: 'ExitWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class ExitWorkflow {}

      const result = await engine.execute(ExitWorkflow, {
        data: { value: 1, shouldFail: true },
      });

      expect(result).toBeDefined();
      expect(result.status).toBe('running');
      expect(errorHandler.invocations).toHaveLength(1);
      expect(errorHandler.invocations[0].decision).toBe(ErrorHandlingDecision.EXIT);
    });

    it('should preserve execution state when exiting on error', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.EXIT,
      });

      @Workflow({
        name: 'ExitStateWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class ExitStateWorkflow {}

      const result = await engine.execute(ExitStateWorkflow, {
        data: { value: 1, shouldFail: true },
      });

      const loaded = await persistence.load(result.id);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe('running');
      expect(loaded!.currentState).toBe(TestState.INITIAL);
    });
  });

  describe('ErrorHandlingDecision.FAIL', () => {
    it('should throw error and persist FAILED status when handler returns FAIL', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.FAIL,
      });

      @Workflow({
        name: 'FailWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class FailWorkflow {}

      await expect(
        engine.execute(FailWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');

      expect(errorHandler.invocations).toHaveLength(1);
      expect(errorHandler.invocations[0].decision).toBe(ErrorHandlingDecision.FAIL);
    });

    it('should persist execution with FAILED status', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.FAIL,
      });

      @Workflow({
        name: 'FailPersistWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class FailPersistWorkflow {}

      let executionId: string | undefined;
      try {
        const result = await engine.execute(FailPersistWorkflow, {
          data: { value: 1, shouldFail: true },
        });
        executionId = result.id;
      } catch (error) {
        // Expected
      }

      if (executionId) {
        const loaded = await persistence.load(executionId);
        expect(loaded).toBeDefined();
        expect(loaded!.status).toBe('failed');
      }
    });
  });

  describe('ErrorHandlingDecision.FAIL_NO_PERSIST', () => {
    it('should throw error without persisting FAILED status', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.FAIL_NO_PERSIST,
      });

      @Workflow({
        name: 'FailNoPersistWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class FailNoPersistWorkflow {}

      let executionId: string | undefined;
      try {
        const result = await engine.execute(FailNoPersistWorkflow, {
          data: { value: 1, shouldFail: true },
        });
        executionId = result.id;
      } catch (error) {
        // Expected
      }

      if (executionId) {
        const loaded = await persistence.load(executionId);
        expect(loaded).toBeDefined();
        expect(loaded!.status).not.toBe('failed');
        expect(loaded!.status).toBe('running');
      }
    });
  });

  describe('Error Phase: lock_acquisition', () => {
    it('should handle lock acquisition failure with EXIT decision', async () => {
      errorHandler = new ErrorTrackingHandler({
        lock_acquisition: ErrorHandlingDecision.EXIT,
      });

      @Workflow({
        name: 'LockExitWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
        concurrency: {
          groupBy: 'value',
          mode: ConcurrencyMode.SEQUENTIAL,
        },
      })
      class LockExitWorkflow {}

      const exec1 = engine.execute(LockExitWorkflow, {
        data: { value: 1 },
        groupId: 'test-group',
      });

      const exec2 = engine.execute(LockExitWorkflow, {
        data: { value: 1 },
        groupId: 'test-group',
      });

      const [result1, result2] = await Promise.all([exec1, exec2]);

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();

      const exitDecisions = errorHandler.invocations.filter(inv => inv.decision === ErrorHandlingDecision.EXIT);
      expect(exitDecisions.length).toBeGreaterThan(0);
    });
  });

  describe('Error Phase: before_state', () => {
    it('should handle error in beforeState hook', async () => {
      errorHandler = new ErrorTrackingHandler({
        before_state: ErrorHandlingDecision.CONTINUE,
      });

      @Workflow({
        name: 'BeforeStateErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class BeforeStateErrorWorkflow {
        @BeforeState()
        async beforeState() {
          throw new Error('BeforeState error');
        }
      }

      const result = await engine.execute(BeforeStateErrorWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      const beforeStateErrors = errorHandler.invocations.filter(inv => inv.phase === 'before_state');
      expect(beforeStateErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Phase: after_state', () => {
    it('should handle error in afterState hook', async () => {
      errorHandler = new ErrorTrackingHandler({
        after_state: ErrorHandlingDecision.CONTINUE,
      });

      @Workflow({
        name: 'AfterStateErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class AfterStateErrorWorkflow {
        @AfterState()
        async afterState() {
          throw new Error('AfterState error');
        }
      }

      const result = await engine.execute(AfterStateErrorWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      const afterStateErrors = errorHandler.invocations.filter(inv => inv.phase === 'after_state');
      expect(afterStateErrors.length).toBeGreaterThan(0);
    });
  });

  describe('Error Phase: workflow_start', () => {
    it('should handle error in onStart hook', async () => {
      errorHandler = new ErrorTrackingHandler({
        workflow_start: ErrorHandlingDecision.EXIT,
      });

      @Workflow({
        name: 'WorkflowStartErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class WorkflowStartErrorWorkflow {
        @OnWorkflowStart()
        async onStart() {
          throw new Error('OnStart error');
        }
      }

      const result = await engine.execute(WorkflowStartErrorWorkflow, {
        data: { value: 1 },
      });

      expect(result).toBeDefined();
      const startErrors = errorHandler.invocations.filter(inv => inv.phase === 'workflow_start');
      expect(startErrors.length).toBeGreaterThan(0);
    });
  });

  describe('ErrorContext validation', () => {
    it('should provide complete error context to handler', async () => {
      errorHandler = new ErrorTrackingHandler({
        state_execute: ErrorHandlingDecision.EXIT,
      });

      @Workflow({
        name: 'ContextTestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class ContextTestWorkflow {}

      await engine.execute(ContextTestWorkflow, {
        data: { value: 123, shouldFail: true },
      });

      expect(errorHandler.invocations).toHaveLength(1);
      const invocation = errorHandler.invocations[0];

      expect(invocation.error).toBeInstanceOf(Error);
      expect(invocation.error.message).toBe('Initial state failed');
      expect(invocation.phase).toBe('state_execute');
      expect(invocation.contextState).toBe(TestState.INITIAL);
    });
  });

  describe('Default behavior without error handler', () => {
    it('should use default FAIL behavior when no handler configured', async () => {
      @Workflow({
        name: 'NoHandlerWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class NoHandlerWorkflow {}

      await expect(
        engine.execute(NoHandlerWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');
    });
  });

  describe('Error handler itself throws', () => {
    it('should fall back to FAIL when error handler throws', async () => {
      const brokenHandler: ErrorHandler = {
        handle: () => {
          throw new Error('Handler is broken');
        },
      };

      @Workflow({
        name: 'BrokenHandlerWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler: brokenHandler,
      })
      class BrokenHandlerWorkflow {}

      await expect(
        engine.execute(BrokenHandlerWorkflow, {
          data: { value: 1, shouldFail: true },
        })
      ).rejects.toThrow('Initial state failed');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle errors in different lifecycle phases', async () => {
      errorHandler = new ErrorTrackingHandler({
        before_state: ErrorHandlingDecision.CONTINUE,
        after_state: ErrorHandlingDecision.CONTINUE,
      });

      @Workflow({
        name: 'MultiErrorWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        errorHandler,
      })
      class MultiErrorWorkflow {
        @BeforeState()
        async beforeState(ctx: WorkflowContext<TestData, TestOutputs>) {
          if (ctx.currentState === TestState.INITIAL) {
            throw new Error('BeforeState error');
          }
        }

        @AfterState()
        async afterState(ctx: WorkflowContext<TestData, TestOutputs>) {
          if (ctx.currentState === TestState.PROCESSING) {
            throw new Error('AfterState error');
          }
        }
      }

      const result = await engine.execute(MultiErrorWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(errorHandler.invocations.length).toBeGreaterThan(0);
    });
  });
});
