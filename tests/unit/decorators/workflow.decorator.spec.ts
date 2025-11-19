import { Workflow, getWorkflowMetadata } from '../../../src/decorators/workflow.decorator';
import { ConcurrencyMode } from '../../../src/types';

enum TestState {
  A = 'A',
  B = 'B',
  C = 'C',
}

describe('Workflow Decorator', () => {
  describe('@Workflow', () => {
    it('should store minimal workflow metadata', () => {
      @Workflow({
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.A,
      })
      class TestWorkflow {}

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('TestWorkflow');
      expect(metadata?.states).toBe(TestState);
      expect(metadata?.initialState).toBe(TestState.A);
    });

    it('should store explicit transitions', () => {
      @Workflow({
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.A,
        transitions: [
          { from: [TestState.A], to: TestState.B },
          { from: [TestState.B], to: TestState.C },
        ],
      })
      class TestWorkflow {}

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.transitions).toHaveLength(2);
      expect(metadata?.transitions?.[0].from).toEqual([TestState.A]);
      expect(metadata?.transitions?.[0].to).toBe(TestState.B);
    });

    it('should store conditional transitions', () => {
      @Workflow({
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.A,
        conditionalTransitions: [
          {
            from: TestState.A,
            conditions: [{ condition: (ctx: any) => ctx.data.approved, to: TestState.B }],
            default: TestState.C,
          },
        ],
      })
      class TestWorkflow {}

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.conditionalTransitions).toHaveLength(1);
      expect(metadata?.conditionalTransitions?.[0].from).toBe(TestState.A);
      expect(metadata?.conditionalTransitions?.[0].default).toBe(TestState.C);
    });

    it('should store concurrency config', () => {
      @Workflow({
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.A,
        concurrency: {
          groupBy: 'userId',
          mode: ConcurrencyMode.SEQUENTIAL,
          maxConcurrentAfterUnlock: 3,
        },
      })
      class TestWorkflow {}

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.concurrency).toEqual({
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
        maxConcurrentAfterUnlock: 3,
      });
    });

    it('should store concurrency with function groupBy', () => {
      const groupByFn = (ctx: any) => ctx.data.tenantId;

      @Workflow({
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.A,
        concurrency: {
          groupBy: groupByFn,
          mode: ConcurrencyMode.THROTTLE,
        },
      })
      class TestWorkflow {}

      const metadata = getWorkflowMetadata(TestWorkflow);
      expect(metadata?.concurrency?.groupBy).toBe(groupByFn);
    });

    it('should return undefined for non-decorated class', () => {
      class PlainClass {}

      const metadata = getWorkflowMetadata(PlainClass);
      expect(metadata).toBeUndefined();
    });

    it('should work with all options combined', () => {
      @Workflow({
        name: 'CompleteWorkflow',
        states: TestState,
        initialState: TestState.A,
        transitions: [{ from: [TestState.A], to: TestState.B }],
        conditionalTransitions: [
          {
            from: TestState.B,
            conditions: [{ condition: () => true, to: TestState.C }],
          },
        ],
        concurrency: {
          groupBy: 'userId',
          mode: ConcurrencyMode.SEQUENTIAL,
        },
      })
      class CompleteWorkflow {}

      const metadata = getWorkflowMetadata(CompleteWorkflow);
      expect(metadata?.name).toBe('CompleteWorkflow');
      expect(metadata?.transitions).toHaveLength(1);
      expect(metadata?.conditionalTransitions).toHaveLength(1);
      expect(metadata?.concurrency).toBeDefined();
    });
  });
});
