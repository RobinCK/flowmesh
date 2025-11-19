import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum ConditionalState {
  START = 'START',
  HIGH_VALUE = 'HIGH_VALUE',
  MEDIUM_VALUE = 'MEDIUM_VALUE',
  LOW_VALUE = 'LOW_VALUE',
  END = 'END',
}

interface ConditionalData extends Record<string, unknown> {
  value: number;
}

interface ConditionalOutputs extends Record<string, unknown> {
  [ConditionalState.START]: { started: boolean };
  [ConditionalState.HIGH_VALUE]: { high: boolean };
  [ConditionalState.MEDIUM_VALUE]: { medium: boolean };
  [ConditionalState.LOW_VALUE]: { low: boolean };
  [ConditionalState.END]: { completed: boolean };
}

@Workflow({
  name: 'ConditionalTransitionsWorkflow',
  states: ConditionalState,
  initialState: ConditionalState.START,
  conditionalTransitions: [
    {
      from: ConditionalState.START,
      conditions: [
        {
          condition: (ctx: WorkflowContext) => (ctx.data as ConditionalData).value > 100,
          to: ConditionalState.HIGH_VALUE,
        },
        {
          condition: (ctx: WorkflowContext) => (ctx.data as ConditionalData).value > 50,
          to: ConditionalState.MEDIUM_VALUE,
        },
      ],
      default: ConditionalState.LOW_VALUE,
    },
    {
      from: ConditionalState.HIGH_VALUE,
      conditions: [],
      default: ConditionalState.END,
    },
    {
      from: ConditionalState.MEDIUM_VALUE,
      conditions: [],
      default: ConditionalState.END,
    },
    {
      from: ConditionalState.LOW_VALUE,
      conditions: [],
      default: ConditionalState.END,
    },
  ],
})
class ConditionalTransitionsWorkflow {}

@State(ConditionalState.START)
class StartState implements IState<ConditionalData, ConditionalOutputs, ConditionalState.START> {
  execute(
    ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
    actions: StateActions<ConditionalData, ConditionalOutputs, ConditionalState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(ConditionalState.HIGH_VALUE)
class HighValueState implements IState<ConditionalData, ConditionalOutputs, ConditionalState.HIGH_VALUE> {
  execute(
    ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
    actions: StateActions<ConditionalData, ConditionalOutputs, ConditionalState.HIGH_VALUE>
  ) {
    actions.next({ output: { high: true } });
  }
}

@State(ConditionalState.MEDIUM_VALUE)
class MediumValueState implements IState<ConditionalData, ConditionalOutputs, ConditionalState.MEDIUM_VALUE> {
  execute(
    ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
    actions: StateActions<ConditionalData, ConditionalOutputs, ConditionalState.MEDIUM_VALUE>
  ) {
    actions.next({ output: { medium: true } });
  }
}

@State(ConditionalState.LOW_VALUE)
class LowValueState implements IState<ConditionalData, ConditionalOutputs, ConditionalState.LOW_VALUE> {
  execute(
    ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
    actions: StateActions<ConditionalData, ConditionalOutputs, ConditionalState.LOW_VALUE>
  ) {
    actions.next({ output: { low: true } });
  }
}

@State(ConditionalState.END)
class EndState implements IState<ConditionalData, ConditionalOutputs, ConditionalState.END> {
  execute(
    ctx: WorkflowContext<ConditionalData, ConditionalOutputs>,
    actions: StateActions<ConditionalData, ConditionalOutputs, ConditionalState.END>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Conditional Transitions', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([
      new StartState(),
      new HighValueState(),
      new MediumValueState(),
      new LowValueState(),
      new EndState(),
    ]);
  });

  it('should route to HIGH_VALUE when value > 100', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 150 },
    });

    expect(result.status).toBe('completed');
    expect(result.history[0].to).toBe(ConditionalState.HIGH_VALUE);
    expect(result.outputs).toHaveProperty(ConditionalState.HIGH_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.MEDIUM_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.LOW_VALUE);
  });

  it('should route to MEDIUM_VALUE when 50 < value <= 100', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 75 },
    });

    expect(result.status).toBe('completed');
    expect(result.history[0].to).toBe(ConditionalState.MEDIUM_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.HIGH_VALUE);
    expect(result.outputs).toHaveProperty(ConditionalState.MEDIUM_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.LOW_VALUE);
  });

  it('should route to LOW_VALUE (default) when value <= 50', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 25 },
    });

    expect(result.status).toBe('completed');
    expect(result.history[0].to).toBe(ConditionalState.LOW_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.HIGH_VALUE);
    expect(result.outputs).not.toHaveProperty(ConditionalState.MEDIUM_VALUE);
    expect(result.outputs).toHaveProperty(ConditionalState.LOW_VALUE);
  });

  it('should evaluate conditions in order (first match wins)', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 150 },
    });

    // value > 100 satisfies both first and second condition, but first wins
    expect(result.history[0].to).toBe(ConditionalState.HIGH_VALUE);
  });

  it('should use default when no conditions match', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 10 },
    });

    expect(result.history[0].to).toBe(ConditionalState.LOW_VALUE);
  });

  it('should support async condition functions', async () => {
    enum SimpleState {
      START = 'START',
      HIGH = 'HIGH',
    }

    interface SimpleData extends Record<string, unknown> {
      value: number;
    }

    interface SimpleOutputs extends Record<string, unknown> {
      [SimpleState.START]: { started: boolean };
      [SimpleState.HIGH]: { high: boolean };
    }

    @State(SimpleState.START)
    class SimpleStartState implements IState<SimpleData, SimpleOutputs, SimpleState.START> {
      execute(
        ctx: WorkflowContext<SimpleData, SimpleOutputs>,
        actions: StateActions<SimpleData, SimpleOutputs, SimpleState.START>
      ) {
        actions.next({ output: { started: true } });
      }
    }

    @State(SimpleState.HIGH)
    class SimpleHighState implements IState<SimpleData, SimpleOutputs, SimpleState.HIGH> {
      execute(
        ctx: WorkflowContext<SimpleData, SimpleOutputs>,
        actions: StateActions<SimpleData, SimpleOutputs, SimpleState.HIGH>
      ) {
        actions.next({ output: { high: true } });
      }
    }

    @Workflow({
      name: 'AsyncConditionWorkflow',
      states: SimpleState,
      initialState: SimpleState.START,
      conditionalTransitions: [
        {
          from: SimpleState.START,
          conditions: [
            {
              condition: async (ctx: WorkflowContext) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                return (ctx.data as SimpleData).value > 100;
              },
              to: SimpleState.HIGH,
            },
          ],
        },
      ],
    })
    class AsyncConditionWorkflow {}

    StateRegistry.clear();
    StateRegistry.autoRegister([new SimpleStartState(), new SimpleHighState()]);

    const result = await engine.execute(AsyncConditionWorkflow, {
      data: { value: 150 },
    });

    expect(result.history[0].to).toBe(SimpleState.HIGH);
  });

  it('should route all paths to END state', async () => {
    const highResult = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 150 },
    });
    const mediumResult = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 75 },
    });
    const lowResult = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 25 },
    });

    expect(highResult.currentState).toBe(ConditionalState.END);
    expect(mediumResult.currentState).toBe(ConditionalState.END);
    expect(lowResult.currentState).toBe(ConditionalState.END);

    expect(highResult.outputs).toHaveProperty(ConditionalState.END);
    expect(mediumResult.outputs).toHaveProperty(ConditionalState.END);
    expect(lowResult.outputs).toHaveProperty(ConditionalState.END);
  });

  it('should track condition-based transition paths', async () => {
    const result = await engine.execute(ConditionalTransitionsWorkflow, {
      data: { value: 150 },
    });

    expect(result.history).toHaveLength(2); // START → HIGH_VALUE → END
    expect(result.history[0].from).toBe(ConditionalState.START);
    expect(result.history[0].to).toBe(ConditionalState.HIGH_VALUE);
    expect(result.history[1].from).toBe(ConditionalState.HIGH_VALUE);
    expect(result.history[1].to).toBe(ConditionalState.END);
  });
});
