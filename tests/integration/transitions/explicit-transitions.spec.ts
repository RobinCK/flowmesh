import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum ExplicitState {
  A = 'A',
  B = 'B',
  C = 'C',
}

interface ExplicitData extends Record<string, unknown> {
  value: number;
}

interface ExplicitOutputs extends Record<string, unknown> {
  [ExplicitState.A]: { resultA: string };
  [ExplicitState.B]: { resultB: string };
  [ExplicitState.C]: { resultC: string };
}

@Workflow({
  name: 'ExplicitTransitionsWorkflow',
  states: ExplicitState,
  initialState: ExplicitState.A,
  transitions: [
    { from: [ExplicitState.A], to: ExplicitState.B },
    { from: [ExplicitState.B], to: ExplicitState.C },
  ],
})
class ExplicitTransitionsWorkflow {}

@State(ExplicitState.A)
class StateA implements IState<ExplicitData, ExplicitOutputs, ExplicitState.A> {
  execute(
    ctx: WorkflowContext<ExplicitData, ExplicitOutputs>,
    actions: StateActions<ExplicitData, ExplicitOutputs, ExplicitState.A>
  ) {
    actions.next({ output: { resultA: 'A_' + ctx.data.value } });
  }
}

@State(ExplicitState.B)
class StateB implements IState<ExplicitData, ExplicitOutputs, ExplicitState.B> {
  execute(
    ctx: WorkflowContext<ExplicitData, ExplicitOutputs>,
    actions: StateActions<ExplicitData, ExplicitOutputs, ExplicitState.B>
  ) {
    actions.next({ output: { resultB: 'B_' + ctx.data.value } });
  }
}

@State(ExplicitState.C)
class StateC implements IState<ExplicitData, ExplicitOutputs, ExplicitState.C> {
  execute(
    ctx: WorkflowContext<ExplicitData, ExplicitOutputs>,
    actions: StateActions<ExplicitData, ExplicitOutputs, ExplicitState.C>
  ) {
    actions.next({ output: { resultC: 'C_' + ctx.data.value } });
  }
}

describe('Integration: Explicit Transitions', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([new StateA(), new StateB(), new StateC()]);
  });

  it('should follow explicit transition path: A → B → C', async () => {
    const result = await engine.execute(ExplicitTransitionsWorkflow, {
      data: { value: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.history).toHaveLength(2);
    expect(result.history[0].from).toBe(ExplicitState.A);
    expect(result.history[0].to).toBe(ExplicitState.B);
    expect(result.history[1].from).toBe(ExplicitState.B);
    expect(result.history[1].to).toBe(ExplicitState.C);
  });

  it('should execute all states in transition order', async () => {
    const result = await engine.execute(ExplicitTransitionsWorkflow, {
      data: { value: 42 },
    });

    expect(result.outputs).toEqual({
      [ExplicitState.A]: { resultA: 'A_42' },
      [ExplicitState.B]: { resultB: 'B_42' },
      [ExplicitState.C]: { resultC: 'C_42' },
    });
  });

  it('should throw error for invalid goto transition', async () => {
    @State(ExplicitState.A)
    class StateAWithInvalidGoto implements IState<ExplicitData, ExplicitOutputs, ExplicitState.A> {
      execute(
        ctx: WorkflowContext<ExplicitData, ExplicitOutputs>,
        actions: StateActions<ExplicitData, ExplicitOutputs, ExplicitState.A>
      ) {
        // Try to jump directly to C, but only A → B is allowed
        actions.goto(ExplicitState.C, { output: { resultA: 'skip' } });
      }
    }

    StateRegistry.clear();
    StateRegistry.autoRegister([new StateAWithInvalidGoto(), new StateB(), new StateC()]);

    await expect(engine.execute(ExplicitTransitionsWorkflow, { data: { value: 1 } })).rejects.toThrow(
      'Invalid transition from A to C'
    );
  });

  it('should allow valid goto within explicit transitions', async () => {
    @Workflow({
      name: 'GotoWorkflow',
      states: ExplicitState,
      initialState: ExplicitState.A,
      transitions: [
        { from: [ExplicitState.A], to: ExplicitState.B },
        { from: [ExplicitState.A], to: ExplicitState.C }, // Allow A → C
        { from: [ExplicitState.B], to: ExplicitState.C },
      ],
    })
    class GotoWorkflow {}

    @State(ExplicitState.A)
    class StateAWithGoto implements IState<ExplicitData, ExplicitOutputs, ExplicitState.A> {
      execute(
        ctx: WorkflowContext<ExplicitData, ExplicitOutputs>,
        actions: StateActions<ExplicitData, ExplicitOutputs, ExplicitState.A>
      ) {
        if (ctx.data.value > 10) {
          actions.goto(ExplicitState.C, { output: { resultA: 'skip' } });
        } else {
          actions.next({ output: { resultA: 'normal' } });
        }
      }
    }

    StateRegistry.clear();
    StateRegistry.autoRegister([new StateAWithGoto(), new StateB(), new StateC()]);

    const result = await engine.execute(GotoWorkflow, { data: { value: 20 } });

    expect(result.status).toBe('completed');
    expect(result.history).toHaveLength(1); // A → C (C is the final state, no transition from C)
    expect(result.history[0].from).toBe(ExplicitState.A);
    expect(result.history[0].to).toBe(ExplicitState.C);
    expect(result.outputs).toHaveProperty(ExplicitState.A);
    expect(result.outputs).toHaveProperty(ExplicitState.C);
    expect(result.outputs).not.toHaveProperty(ExplicitState.B); // B was skipped
  });

  it('should track all transitions in history', async () => {
    const result = await engine.execute(ExplicitTransitionsWorkflow, {
      data: { value: 1 },
    });

    expect(result.history.every(t => t.status === 'success')).toBe(true);
    expect(result.history.every(t => typeof t.duration === 'number')).toBe(true);
    expect(result.history.every(t => t.startedAt instanceof Date)).toBe(true);
    expect(result.history.every(t => t.completedAt instanceof Date)).toBe(true);
  });

  it('should complete workflow when no more transitions', async () => {
    const result = await engine.execute(ExplicitTransitionsWorkflow, {
      data: { value: 1 },
    });

    expect(result.status).toBe('completed');
    expect(result.currentState).toBe(ExplicitState.C);
    expect(result.metadata.completedAt).toBeInstanceOf(Date);
  });
});
