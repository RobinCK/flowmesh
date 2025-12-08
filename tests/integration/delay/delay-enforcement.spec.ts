import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State, Delay, Timeout } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum TestState {
  INITIAL = 'initial',
  DELAYED = 'delayed',
  IMMEDIATE = 'immediate',
  DELAYED_WITH_TIMEOUT = 'delayed_with_timeout',
  FINAL = 'final',
}

interface TestData extends Record<string, unknown> {
  value: number;
  startTime?: number;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.INITIAL]: { started: boolean };
  [TestState.DELAYED]: { processed: boolean; delayedMs: number };
  [TestState.IMMEDIATE]: { processed: boolean; delayedMs: number };
  [TestState.DELAYED_WITH_TIMEOUT]: { processed: boolean };
  [TestState.FINAL]: { completed: boolean };
}

@State(TestState.INITIAL)
class InitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
    actions.next({
      output: { started: true },
      data: { ...ctx.data, startTime: Date.now() },
    });
  }
}

@State(TestState.DELAYED)
@Delay(200) // 200ms delay
class DelayedState implements IState<TestData, TestOutputs, TestState.DELAYED> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.DELAYED>) {
    const elapsed = Date.now() - (ctx.data.startTime || 0);
    actions.next({ output: { processed: true, delayedMs: elapsed } });
  }
}

@State(TestState.IMMEDIATE)
class ImmediateState implements IState<TestData, TestOutputs, TestState.IMMEDIATE> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.IMMEDIATE>) {
    const elapsed = Date.now() - (ctx.data.startTime || 0);
    actions.next({ output: { processed: true, delayedMs: elapsed } });
  }
}

@State(TestState.DELAYED_WITH_TIMEOUT)
@Delay(100) // 100ms delay
@Timeout(300) // 300ms timeout
class DelayedWithTimeoutState implements IState<TestData, TestOutputs, TestState.DELAYED_WITH_TIMEOUT> {
  async execute(
    ctx: WorkflowContext<TestData, TestOutputs>,
    actions: StateActions<TestData, TestOutputs, TestState.DELAYED_WITH_TIMEOUT>
  ) {
    // Actual execution takes 150ms
    await new Promise(resolve => setTimeout(resolve, 150));
    actions.next({ output: { processed: true } });
  }
}

@State(TestState.FINAL)
class FinalState implements IState<TestData, TestOutputs, TestState.FINAL> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.FINAL>) {
    actions.complete({ output: { completed: true } });
  }
}

describe('Delay Enforcement', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([
      new InitialState(),
      new DelayedState(),
      new ImmediateState(),
      new DelayedWithTimeoutState(),
      new FinalState(),
    ]);
  });

  describe('Basic Delay Behavior', () => {
    it('should delay state execution by specified milliseconds', async () => {
      @Workflow({
        name: 'DelayTestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        transitions: [
          { from: TestState.INITIAL, to: TestState.DELAYED },
          { from: TestState.DELAYED, to: TestState.FINAL },
        ],
      })
      class DelayTestWorkflow {}

      const result = await engine.execute(DelayTestWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      const delayedOutput = result.outputs[TestState.DELAYED] as any;
      expect(delayedOutput?.processed).toBe(true);
      // Should be at least 200ms (delay time)
      expect(delayedOutput?.delayedMs).toBeGreaterThanOrEqual(200);
    });

    it('should NOT delay state without @Delay decorator', async () => {
      @Workflow({
        name: 'ImmediateTestWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        transitions: [
          { from: TestState.INITIAL, to: TestState.IMMEDIATE },
          { from: TestState.IMMEDIATE, to: TestState.FINAL },
        ],
      })
      class ImmediateTestWorkflow {}

      const result = await engine.execute(ImmediateTestWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      const immediateOutput = result.outputs[TestState.IMMEDIATE] as any;
      expect(immediateOutput?.processed).toBe(true);
      // Should be very fast (< 50ms)
      expect(immediateOutput?.delayedMs).toBeLessThan(50);
    });

    it('should work with both @Delay and @Timeout decorators', async () => {
      @Workflow({
        name: 'DelayWithTimeoutWorkflow',
        states: TestState,
        initialState: TestState.DELAYED_WITH_TIMEOUT,
      })
      class DelayWithTimeoutWorkflow {}

      const startTime = Date.now();
      const result = await engine.execute(DelayWithTimeoutWorkflow, {
        data: { value: 1 },
      });
      const totalTime = Date.now() - startTime;

      expect(result.status).toBe('completed');
      expect((result.outputs[TestState.DELAYED_WITH_TIMEOUT] as any)?.processed).toBe(true);
      // Total time should be: delay (100ms) + execution (150ms) = ~250ms
      expect(totalTime).toBeGreaterThanOrEqual(250);
      // Should complete before timeout (300ms total)
      expect(totalTime).toBeLessThan(400);
    });
  });

  describe('Delay with Multiple States', () => {
    it('should delay each state independently', async () => {
      @State(TestState.INITIAL)
      @Delay(50)
      class DelayedInitialState implements IState<TestData, TestOutputs, TestState.INITIAL> {
        execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.INITIAL>) {
          actions.next({ output: { started: true } });
        }
      }

      StateRegistry.register(TestState.INITIAL, new DelayedInitialState() as any);

      @Workflow({
        name: 'MultiDelayWorkflow',
        states: TestState,
        initialState: TestState.INITIAL,
        transitions: [
          { from: TestState.INITIAL, to: TestState.DELAYED }, // Delayed has 200ms
          { from: TestState.DELAYED, to: TestState.FINAL },
        ],
      })
      class MultiDelayWorkflow {}

      const startTime = Date.now();
      const result = await engine.execute(MultiDelayWorkflow, {
        data: { value: 1 },
      });
      const totalTime = Date.now() - startTime;

      expect(result.status).toBe('completed');
      // Should have delays for both states: 50ms + 200ms = 250ms minimum
      expect(totalTime).toBeGreaterThanOrEqual(250);
    });
  });

  describe('Delay Precision', () => {
    it('should delay for the exact specified duration', async () => {
      const delays = [50, 100, 200];

      for (const delayMs of delays) {
        @State('test-delayed')
        @Delay(delayMs)
        class TestDelayedState implements IState<TestData, TestOutputs, any> {
          execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, any>) {
            const elapsed = Date.now() - (ctx.data.startTime || 0);
            actions.complete({ output: { delayedMs: elapsed } });
          }
        }

        StateRegistry.clear();
        StateRegistry.register('test-delayed' as any, new TestDelayedState() as any);

        @Workflow({
          name: `DelayPrecisionWorkflow${delayMs}`,
          states: { TEST: 'test-delayed' },
          initialState: 'test-delayed' as any,
        })
        class DelayPrecisionWorkflow {}

        const result = await engine.execute(DelayPrecisionWorkflow, {
          data: { value: 1, startTime: Date.now() },
        });

        const output = result.outputs['test-delayed'] as any;
        expect(output?.delayedMs).toBeGreaterThanOrEqual(delayMs);
        // Allow 50ms margin for test execution overhead
        expect(output?.delayedMs).toBeLessThan(delayMs + 50);
      }
    });
  });
});
