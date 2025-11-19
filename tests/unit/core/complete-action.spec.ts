import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { OnWorkflowComplete } from '../../../src/decorators/lifecycle.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
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
  shouldComplete?: boolean;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.INITIAL]: { started: boolean };
  [TestState.PROCESSING]: { processed: boolean };
  [TestState.FINAL]: { completed: boolean };
}

describe('Complete Action', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });
  });

  describe('Basic complete() functionality', () => {
    it('should complete workflow when complete() is called', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'CompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class CompleteWorkflow {}

      const result = await engine.execute(CompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.INITIAL);
      expect(result.outputs[TestState.INITIAL]).toEqual({ started: true });
      expect(result.metadata.completedAt).toBeDefined();
    });

    it('should save final data when complete() is called', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({
            data: { value: 42 },
            output: { started: true },
          });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'CompleteWithDataWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class CompleteWithDataWorkflow {}

      const result = await engine.execute(CompleteWithDataWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.data.value).toBe(42);
      expect(result.outputs[TestState.INITIAL]).toEqual({ started: true });
    });

    it('should persist completed execution', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'PersistCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class PersistCompleteWorkflow {}

      const result = await engine.execute(PersistCompleteWorkflow, {
        data: { value: 1 },
      });

      const loaded = await persistence.load(result.id);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe('completed');
      expect(loaded!.currentState).toBe(TestState.INITIAL);
      expect(loaded!.metadata.completedAt).toBeDefined();
    });
  });

  describe('complete() with onComplete lifecycle hook', () => {
    it('should call onComplete hook when complete() is used', async () => {
      const hookCalls: string[] = [];

      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'HookCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class HookCompleteWorkflow {
        @OnWorkflowComplete()
        async onComplete(ctx: WorkflowContext<TestData, TestOutputs>) {
          hookCalls.push('onComplete');
        }
      }

      const result = await engine.execute(HookCompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(hookCalls).toEqual(['onComplete']);
    });
  });

  describe('Action priority - last action wins', () => {
    it('should use complete() when called after next()', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.next({ output: { started: true } });
          actions.complete({ output: { started: true } });
        }
      }

      @State(TestState.PROCESSING)
      class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
          actions.next({ output: { processed: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState(), new ProcessingState()]);

      @Workflow({
        name: 'CompleteOverridesNextWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class CompleteOverridesNextWorkflow {}

      const result = await engine.execute(CompleteOverridesNextWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.INITIAL);
    });

    it('should use next() when called after complete()', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
          actions.next({ output: { started: true } });
        }
      }

      @State(TestState.PROCESSING)
      class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
          actions.complete({ output: { processed: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState(), new ProcessingState()]);

      @Workflow({
        name: 'NextOverridesCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class NextOverridesCompleteWorkflow {}

      const result = await engine.execute(NextOverridesCompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.PROCESSING);
    });

    it('should use complete() when called after goto()', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.goto(TestState.FINAL, { output: { started: true } });
          actions.complete({ output: { started: true } });
        }
      }

      @State(TestState.FINAL)
      class FinalState implements IState<TestData, TestOutputs, TestState.FINAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FINAL>) {
          actions.next({ output: { completed: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState(), new FinalState()]);

      @Workflow({
        name: 'CompleteOverridesGotoWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class CompleteOverridesGotoWorkflow {}

      const result = await engine.execute(CompleteOverridesGotoWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.INITIAL);
    });

    it('should use suspend() when called after complete()', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
          actions.suspend({ output: { started: true }, waitingFor: 'test' });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'SuspendOverridesCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class SuspendOverridesCompleteWorkflow {}

      const result = await engine.execute(SuspendOverridesCompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('suspended');
      expect(result.currentState).toBe(TestState.INITIAL);
    });
  });

  describe('complete() with history', () => {
    it('should create transition history entry for completed state', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.complete({ output: { started: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState()]);

      @Workflow({
        name: 'HistoryCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class HistoryCompleteWorkflow {}

      const result = await engine.execute(HistoryCompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.history).toHaveLength(1);
      expect(result.history[0].from).toBe(TestState.INITIAL);
      expect(result.history[0].to).toBe(TestState.INITIAL);
      expect(result.history[0].status).toBe('success');
      expect(result.history[0].completedAt).toBeDefined();
    });

    it('should create complete transition after normal state transitions', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.next({ output: { started: true } });
        }
      }

      @State(TestState.PROCESSING)
      class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
          actions.complete({ output: { processed: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState(), new ProcessingState()]);

      @Workflow({
        name: 'MultiStateCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class MultiStateCompleteWorkflow {}

      const result = await engine.execute(MultiStateCompleteWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.PROCESSING);
      expect(result.history).toHaveLength(2);

      expect(result.history[0].from).toBe(TestState.INITIAL);
      expect(result.history[0].to).toBe(TestState.PROCESSING);
      expect(result.history[0].status).toBe('success');

      expect(result.history[1].from).toBe(TestState.PROCESSING);
      expect(result.history[1].to).toBe(TestState.PROCESSING);
      expect(result.history[1].status).toBe('success');
    });
  });

  describe('Conditional complete()', () => {
    it('should complete workflow conditionally based on data', async () => {
      @State(TestState.INITIAL)
      class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          if (ctx.data.shouldComplete) {
            actions.complete({ output: { started: true } });
          } else {
            actions.next({ output: { started: true } });
          }
        }
      }

      @State(TestState.PROCESSING)
      class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
          actions.complete({ output: { processed: true } });
        }
      }

      StateRegistry.autoRegister([new InitialState(), new ProcessingState()]);

      @Workflow({
        name: 'ConditionalCompleteWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
      })
      class ConditionalCompleteWorkflow {}

      const result1 = await engine.execute(ConditionalCompleteWorkflow, {
        data: { value: 1, shouldComplete: true },
      });
      expect(result1.status).toBe('completed');
      expect(result1.currentState).toBe(TestState.INITIAL);

      const result2 = await engine.execute(ConditionalCompleteWorkflow, {
        data: { value: 2, shouldComplete: false },
      });
      expect(result2.status).toBe('completed');
      expect(result2.currentState).toBe(TestState.PROCESSING);
    });
  });
});
