import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum AutoState {
  FIRST = 'FIRST',
  SECOND = 'SECOND',
  THIRD = 'THIRD',
  FOURTH = 'FOURTH',
}

interface AutoData extends Record<string, unknown> {
  counter: number;
}

interface AutoOutputs extends Record<string, unknown> {
  [AutoState.FIRST]: { step: number };
  [AutoState.SECOND]: { step: number };
  [AutoState.THIRD]: { step: number };
  [AutoState.FOURTH]: { step: number };
}

@Workflow({
  name: 'AutomaticTransitionsWorkflow',
  states: AutoState,
  initialState: AutoState.FIRST,
  // No explicit transitions or conditionalTransitions - will use enum order
})
class AutomaticTransitionsWorkflow {}

@State(AutoState.FIRST)
class FirstState implements IState<AutoData, AutoOutputs, AutoState.FIRST> {
  execute(ctx: WorkflowContext<AutoData, AutoOutputs>, actions: StateActions<AutoData, AutoOutputs, AutoState.FIRST>) {
    actions.next({ data: { counter: ctx.data.counter + 1 }, output: { step: 1 } });
  }
}

@State(AutoState.SECOND)
class SecondState implements IState<AutoData, AutoOutputs, AutoState.SECOND> {
  execute(ctx: WorkflowContext<AutoData, AutoOutputs>, actions: StateActions<AutoData, AutoOutputs, AutoState.SECOND>) {
    actions.next({ data: { counter: ctx.data.counter + 1 }, output: { step: 2 } });
  }
}

@State(AutoState.THIRD)
class ThirdState implements IState<AutoData, AutoOutputs, AutoState.THIRD> {
  execute(ctx: WorkflowContext<AutoData, AutoOutputs>, actions: StateActions<AutoData, AutoOutputs, AutoState.THIRD>) {
    actions.next({ data: { counter: ctx.data.counter + 1 }, output: { step: 3 } });
  }
}

@State(AutoState.FOURTH)
class FourthState implements IState<AutoData, AutoOutputs, AutoState.FOURTH> {
  execute(ctx: WorkflowContext<AutoData, AutoOutputs>, actions: StateActions<AutoData, AutoOutputs, AutoState.FOURTH>) {
    actions.next({ data: { counter: ctx.data.counter + 1 }, output: { step: 4 } });
  }
}

describe('Integration: Automatic Transitions', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([new FirstState(), new SecondState(), new ThirdState(), new FourthState()]);
  });

  it('should follow enum order: FIRST → SECOND → THIRD → FOURTH', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    expect(result.status).toBe('completed');
    expect(result.history).toHaveLength(3);
    expect(result.history[0].from).toBe(AutoState.FIRST);
    expect(result.history[0].to).toBe(AutoState.SECOND);
    expect(result.history[1].from).toBe(AutoState.SECOND);
    expect(result.history[1].to).toBe(AutoState.THIRD);
    expect(result.history[2].from).toBe(AutoState.THIRD);
    expect(result.history[2].to).toBe(AutoState.FOURTH);
  });

  it('should execute all states sequentially', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    expect(result.outputs).toEqual({
      [AutoState.FIRST]: { step: 1 },
      [AutoState.SECOND]: { step: 2 },
      [AutoState.THIRD]: { step: 3 },
      [AutoState.FOURTH]: { step: 4 },
    });
  });

  it('should update data through each state', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    expect(result.data.counter).toBe(4); // Incremented in each state
  });

  it('should complete when reaching last enum value', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    expect(result.status).toBe('completed');
    expect(result.currentState).toBe(AutoState.FOURTH);
    expect(result.metadata.completedAt).toBeInstanceOf(Date);
  });

  it('should not allow goto without explicit transitions', async () => {
    @State(AutoState.FIRST)
    class FirstStateWithGoto implements IState<AutoData, AutoOutputs, AutoState.FIRST> {
      execute(ctx: WorkflowContext<AutoData, AutoOutputs>, actions: StateActions<AutoData, AutoOutputs, AutoState.FIRST>) {
        // Try to skip directly to FOURTH (not allowed in automatic mode without explicit transitions)
        actions.goto(AutoState.FOURTH, { output: { step: 1 } });
      }
    }

    StateRegistry.clear();
    StateRegistry.autoRegister([new FirstStateWithGoto(), new SecondState(), new ThirdState(), new FourthState()]);

    await expect(engine.execute(AutomaticTransitionsWorkflow, { data: { counter: 0 } })).rejects.toThrow(
      'Invalid transition from FIRST to FOURTH'
    );
  });

  it('should work with different enum value order', async () => {
    enum CustomOrder {
      Z = 'Z',
      A = 'A',
      M = 'M',
    }

    interface CustomData extends Record<string, unknown> {
      value: string;
    }

    interface CustomOutputs extends Record<string, unknown> {
      [CustomOrder.Z]: { char: string };
      [CustomOrder.A]: { char: string };
      [CustomOrder.M]: { char: string };
    }

    @Workflow({
      name: 'CustomOrderWorkflow',
      states: CustomOrder,
      initialState: CustomOrder.Z,
    })
    class CustomOrderWorkflow {}

    @State(CustomOrder.Z)
    class StateZ implements IState<CustomData, CustomOutputs, CustomOrder.Z> {
      execute(ctx: WorkflowContext<CustomData, CustomOutputs>, actions: StateActions<CustomData, CustomOutputs, CustomOrder.Z>) {
        actions.next({ output: { char: 'Z' } });
      }
    }

    @State(CustomOrder.A)
    class StateA implements IState<CustomData, CustomOutputs, CustomOrder.A> {
      execute(ctx: WorkflowContext<CustomData, CustomOutputs>, actions: StateActions<CustomData, CustomOutputs, CustomOrder.A>) {
        actions.next({ output: { char: 'A' } });
      }
    }

    @State(CustomOrder.M)
    class StateM implements IState<CustomData, CustomOutputs, CustomOrder.M> {
      execute(ctx: WorkflowContext<CustomData, CustomOutputs>, actions: StateActions<CustomData, CustomOutputs, CustomOrder.M>) {
        actions.next({ output: { char: 'M' } });
      }
    }

    StateRegistry.clear();
    StateRegistry.autoRegister([new StateZ(), new StateA(), new StateM()]);

    const result = await engine.execute(CustomOrderWorkflow, {
      data: { value: 'test' },
    });

    expect(result.status).toBe('completed');
    expect(result.history).toHaveLength(2);
    // Should follow definition order: Z → A → M
    expect(result.history[0].from).toBe(CustomOrder.Z);
    expect(result.history[0].to).toBe(CustomOrder.A);
    expect(result.history[1].from).toBe(CustomOrder.A);
    expect(result.history[1].to).toBe(CustomOrder.M);
  });

  it('should track execution time for each automatic transition', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    result.history.forEach(transition => {
      expect(transition.duration).toBeGreaterThanOrEqual(0);
      expect(transition.startedAt).toBeInstanceOf(Date);
      expect(transition.completedAt).toBeInstanceOf(Date);
      expect(transition.status).toBe('success');
    });
  });

  it('should persist state after each automatic transition', async () => {
    const result = await engine.execute(AutomaticTransitionsWorkflow, {
      data: { counter: 0 },
    });

    // Load from persistence to verify it was saved
    const loaded = await persistence.load(result.id);

    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe('completed');
    expect(loaded?.history).toHaveLength(3);
    expect(loaded?.outputs).toEqual(result.outputs);
  });
});
