import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';

enum VirtualOutputState {
  START = 'START',
  HIGH_VALUE = 'HIGH_VALUE',
  MEDIUM_VALUE = 'MEDIUM_VALUE',
  LOW_VALUE = 'LOW_VALUE',
  END = 'END',
}

interface VirtualOutputData extends Record<string, unknown> {
  value: number;
  category?: string;
}

interface VirtualOutputs extends Record<string, unknown> {
  [VirtualOutputState.START]: { started: boolean };
  [VirtualOutputState.HIGH_VALUE]: { high: boolean; category: string };
  [VirtualOutputState.MEDIUM_VALUE]: { medium: boolean; category: string };
  [VirtualOutputState.LOW_VALUE]: { low: boolean; category: string };
  [VirtualOutputState.END]: { completed: boolean };
}

@Workflow({
  name: 'VirtualOutputsWorkflow',
  states: VirtualOutputState,
  initialState: VirtualOutputState.START,
  conditionalTransitions: [
    {
      from: VirtualOutputState.START,
      conditions: [
        {
          condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 100,
          to: VirtualOutputState.END,
          virtualOutputs: {
            [VirtualOutputState.HIGH_VALUE]: { high: true, category: 'high' },
            [VirtualOutputState.MEDIUM_VALUE]: { medium: false, category: 'not-medium' },
            [VirtualOutputState.LOW_VALUE]: { low: false, category: 'not-low' },
          },
        },
        {
          condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 50,
          to: VirtualOutputState.END,
          virtualOutputs: {
            [VirtualOutputState.HIGH_VALUE]: { high: false, category: 'not-high' },
            [VirtualOutputState.MEDIUM_VALUE]: { medium: true, category: 'medium' },
            [VirtualOutputState.LOW_VALUE]: { low: false, category: 'not-low' },
          },
        },
      ],
      default: VirtualOutputState.END,
      defaultVirtualOutputs: {
        [VirtualOutputState.HIGH_VALUE]: { high: false, category: 'not-high' },
        [VirtualOutputState.MEDIUM_VALUE]: { medium: false, category: 'not-medium' },
        [VirtualOutputState.LOW_VALUE]: { low: true, category: 'low' },
      },
    },
  ],
})
class VirtualOutputsWorkflow {}

@Workflow({
  name: 'VirtualOutputsFunctionWorkflow',
  states: VirtualOutputState,
  initialState: VirtualOutputState.START,
  conditionalTransitions: [
    {
      from: VirtualOutputState.START,
      conditions: [
        {
          condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 100,
          to: VirtualOutputState.END,
          virtualOutputs: {
            [VirtualOutputState.HIGH_VALUE]: (ctx: WorkflowContext) => ({
              high: true,
              category: `high-${(ctx.data as VirtualOutputData).value}`,
            }),
            [VirtualOutputState.MEDIUM_VALUE]: (ctx: WorkflowContext) => ({
              medium: false,
              category: `not-medium-${(ctx.data as VirtualOutputData).value}`,
            }),
            [VirtualOutputState.LOW_VALUE]: (ctx: WorkflowContext) => ({
              low: false,
              category: `not-low-${(ctx.data as VirtualOutputData).value}`,
            }),
          },
        },
      ],
      default: VirtualOutputState.END,
    },
  ],
})
class VirtualOutputsFunctionWorkflow {}

@Workflow({
  name: 'VirtualOutputsAsyncWorkflow',
  states: VirtualOutputState,
  initialState: VirtualOutputState.START,
  conditionalTransitions: [
    {
      from: VirtualOutputState.START,
      conditions: [
        {
          condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 100,
          to: VirtualOutputState.END,
          virtualOutputs: {
            [VirtualOutputState.HIGH_VALUE]: async (ctx: WorkflowContext) => {
              await new Promise(resolve => setTimeout(resolve, 10));
              return {
                high: true,
                category: `async-high-${(ctx.data as VirtualOutputData).value}`,
              };
            },
          },
        },
      ],
      default: VirtualOutputState.END,
    },
  ],
})
class VirtualOutputsAsyncWorkflow {}

@State(VirtualOutputState.START)
class StartState implements IState<VirtualOutputData, VirtualOutputs, VirtualOutputState.START> {
  execute(
    ctx: WorkflowContext<VirtualOutputData, VirtualOutputs>,
    actions: StateActions<VirtualOutputData, VirtualOutputs, VirtualOutputState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(VirtualOutputState.END)
class EndState implements IState<VirtualOutputData, VirtualOutputs, VirtualOutputState.END> {
  execute(
    ctx: WorkflowContext<VirtualOutputData, VirtualOutputs>,
    actions: StateActions<VirtualOutputData, VirtualOutputs, VirtualOutputState.END>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Virtual Outputs in Conditional Transitions', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([new StartState(), new EndState()]);
  });

  describe('Static virtual outputs', () => {
    it('should set virtual outputs for skipped states when condition matches (high value)', async () => {
      const result = await engine.execute(VirtualOutputsWorkflow, {
        data: { value: 150 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(VirtualOutputState.END);

      expect(result.outputs[VirtualOutputState.START]).toEqual({ started: true });
      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: true,
        category: 'high',
      });
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toEqual({
        medium: false,
        category: 'not-medium',
      });
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toEqual({
        low: false,
        category: 'not-low',
      });
      expect(result.outputs[VirtualOutputState.END]).toEqual({ completed: true });
    });

    it('should set virtual outputs for skipped states when second condition matches (medium value)', async () => {
      const result = await engine.execute(VirtualOutputsWorkflow, {
        data: { value: 75 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(VirtualOutputState.END);

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: false,
        category: 'not-high',
      });
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toEqual({
        medium: true,
        category: 'medium',
      });
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toEqual({
        low: false,
        category: 'not-low',
      });
    });

    it('should set default virtual outputs when no conditions match (low value)', async () => {
      const result = await engine.execute(VirtualOutputsWorkflow, {
        data: { value: 25 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(VirtualOutputState.END);

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: false,
        category: 'not-high',
      });
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toEqual({
        medium: false,
        category: 'not-medium',
      });
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toEqual({ low: true, category: 'low' });
    });
  });

  describe('Function-based virtual outputs', () => {
    it('should evaluate function-based virtual outputs with context', async () => {
      const result = await engine.execute(VirtualOutputsFunctionWorkflow, {
        data: { value: 150 },
      });

      expect(result.status).toBe('completed');

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: true,
        category: 'high-150',
      });
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toEqual({
        medium: false,
        category: 'not-medium-150',
      });
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toEqual({
        low: false,
        category: 'not-low-150',
      });
    });

    it('should support async function-based virtual outputs', async () => {
      const result = await engine.execute(VirtualOutputsAsyncWorkflow, {
        data: { value: 150 },
      });

      expect(result.status).toBe('completed');

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: true,
        category: 'async-high-150',
      });
    });
  });

  describe('Backward compatibility', () => {
    @Workflow({
      name: 'NoVirtualOutputsWorkflow',
      states: VirtualOutputState,
      initialState: VirtualOutputState.START,
      conditionalTransitions: [
        {
          from: VirtualOutputState.START,
          conditions: [
            {
              condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 100,
              to: VirtualOutputState.END,
            },
          ],
          default: VirtualOutputState.END,
        },
      ],
    })
    class NoVirtualOutputsWorkflow {}

    it('should work without virtual outputs (backward compatible)', async () => {
      const result = await engine.execute(NoVirtualOutputsWorkflow, {
        data: { value: 150 },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(VirtualOutputState.END);

      expect(result.outputs[VirtualOutputState.START]).toEqual({ started: true });
      expect(result.outputs[VirtualOutputState.END]).toEqual({ completed: true });

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toBeUndefined();
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toBeUndefined();
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toBeUndefined();
    });
  });

  describe('Partial virtual outputs', () => {
    @Workflow({
      name: 'PartialVirtualOutputsWorkflow',
      states: VirtualOutputState,
      initialState: VirtualOutputState.START,
      conditionalTransitions: [
        {
          from: VirtualOutputState.START,
          conditions: [
            {
              condition: (ctx: WorkflowContext) => (ctx.data as VirtualOutputData).value > 100,
              to: VirtualOutputState.END,
              virtualOutputs: {
                [VirtualOutputState.HIGH_VALUE]: { high: true, category: 'high' },
              },
            },
          ],
          default: VirtualOutputState.END,
        },
      ],
    })
    class PartialVirtualOutputsWorkflow {}

    it('should set only specified virtual outputs', async () => {
      const result = await engine.execute(PartialVirtualOutputsWorkflow, {
        data: { value: 150 },
      });

      expect(result.status).toBe('completed');

      expect(result.outputs[VirtualOutputState.HIGH_VALUE]).toEqual({
        high: true,
        category: 'high',
      });
      expect(result.outputs[VirtualOutputState.MEDIUM_VALUE]).toBeUndefined();
      expect(result.outputs[VirtualOutputState.LOW_VALUE]).toBeUndefined();
    });
  });

  describe('Access virtual outputs in END state', () => {
    @State(VirtualOutputState.END)
    class EndStateWithVirtualAccess implements IState<VirtualOutputData, VirtualOutputs, VirtualOutputState.END> {
      execute(
        ctx: WorkflowContext<VirtualOutputData, VirtualOutputs>,
        actions: StateActions<VirtualOutputData, VirtualOutputs, VirtualOutputState.END>
      ) {
        const highOutput = ctx.outputs[VirtualOutputState.HIGH_VALUE];
        const mediumOutput = ctx.outputs[VirtualOutputState.MEDIUM_VALUE];
        const lowOutput = ctx.outputs[VirtualOutputState.LOW_VALUE];

        let category = 'unknown';
        if (highOutput?.high) category = highOutput.category;
        else if (mediumOutput?.medium) category = mediumOutput.category;
        else if (lowOutput?.low) category = lowOutput.category;

        actions.next({
          output: { completed: true },
          data: { category },
        });
      }
    }

    it('should access virtual outputs from END state without checking which path was taken', async () => {
      StateRegistry.clear();
      StateRegistry.autoRegister([new StartState(), new EndStateWithVirtualAccess()]);

      const result = await engine.execute(VirtualOutputsWorkflow, {
        data: { value: 75 },
      });

      expect(result.status).toBe('completed');
      expect((result.data as VirtualOutputData).category).toBe('medium');
    });
  });
});
