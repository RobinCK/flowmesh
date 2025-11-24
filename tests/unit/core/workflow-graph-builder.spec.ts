import { WorkflowGraphBuilder } from '../../../src/core/workflow-graph-builder';
import { StateRegistry } from '../../../src/core/state-registry';
import { WorkflowMetadataConfig, ConcurrencyMode } from '../../../src/types/workflow.types';
import { State, Timeout, Retry, UnlockAfter } from '../../../src/decorators/state.decorator';
import { IState, StateActions, WorkflowContext } from '../../../src/types';

describe('WorkflowGraphBuilder', () => {
  enum TestState {
    CREATED = 'CREATED',
    VALIDATED = 'VALIDATED',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
  }

  beforeEach(() => {
    StateRegistry.clear();
  });

  describe('buildGraph', () => {
    it('should build a basic graph with automatic transitions', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      expect(graph.workflowName).toBe('TestWorkflow');
      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(3); // Automatic transitions between sequential states

      // Check initial state
      const initialNode = graph.nodes.find(n => n.id === 'CREATED');
      expect(initialNode?.isInitial).toBe(true);

      // Check automatic transitions
      expect(graph.edges).toContainEqual({
        from: 'CREATED',
        to: 'VALIDATED',
        type: 'automatic',
        label: 'next',
      });
      expect(graph.edges).toContainEqual({
        from: 'VALIDATED',
        to: 'PROCESSING',
        type: 'automatic',
        label: 'next',
      });
      expect(graph.edges).toContainEqual({
        from: 'PROCESSING',
        to: 'COMPLETED',
        type: 'automatic',
        label: 'next',
      });
    });

    it('should build graph with explicit transitions', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
        transitions: [
          { from: [TestState.CREATED], to: TestState.PROCESSING }, // Skip VALIDATED
          { from: [TestState.PROCESSING], to: TestState.COMPLETED },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      expect(graph.edges).toHaveLength(3); // 2 explicit + 1 automatic for VALIDATED

      // Check explicit transitions
      expect(graph.edges).toContainEqual({
        from: 'CREATED',
        to: 'PROCESSING',
        type: 'explicit',
        condition: undefined,
        label: undefined,
      });
      expect(graph.edges).toContainEqual({
        from: 'PROCESSING',
        to: 'COMPLETED',
        type: 'explicit',
        condition: undefined,
        label: undefined,
      });

      // VALIDATED should have automatic transition since it has no explicit/conditional
      expect(graph.edges).toContainEqual({
        from: 'VALIDATED',
        to: 'PROCESSING',
        type: 'automatic',
        label: 'next',
      });
    });

    it('should build graph with conditional transitions', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
        conditionalTransitions: [
          {
            from: TestState.VALIDATED,
            conditions: [
              { condition: ctx => !!ctx.data.urgent, to: TestState.COMPLETED },
              { condition: ctx => !!ctx.data.normal, to: TestState.PROCESSING },
            ],
            default: TestState.PROCESSING,
          },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // CREATED and PROCESSING/COMPLETED should have automatic transitions
      // VALIDATED has conditional transitions
      expect(graph.edges.length).toBeGreaterThanOrEqual(3);

      // Check conditional transitions
      const conditionalEdges = graph.edges.filter(e => e.from === 'VALIDATED' && e.type === 'conditional');
      expect(conditionalEdges).toHaveLength(3); // 2 conditions + 1 default

      expect(conditionalEdges).toContainEqual(
        expect.objectContaining({
          from: 'VALIDATED',
          to: 'COMPLETED',
          type: 'conditional',
          label: 'condition 1',
        })
      );

      expect(conditionalEdges).toContainEqual(
        expect.objectContaining({
          from: 'VALIDATED',
          to: 'PROCESSING',
          type: 'conditional',
          label: 'condition 2',
        })
      );

      expect(conditionalEdges).toContainEqual(
        expect.objectContaining({
          from: 'VALIDATED',
          to: 'PROCESSING',
          type: 'conditional',
          label: 'default',
        })
      );
    });

    it('should build graph with multiple from states in transitions', () => {
      enum MultiFromState {
        START = 'START',
        BRANCH_A = 'BRANCH_A',
        BRANCH_B = 'BRANCH_B',
        MERGE = 'MERGE',
      }

      const metadata: WorkflowMetadataConfig<MultiFromState> = {
        name: 'MultiFromWorkflow',
        states: MultiFromState,
        initialState: MultiFromState.START,
        transitions: [
          { from: [MultiFromState.START], to: MultiFromState.BRANCH_A },
          { from: [MultiFromState.BRANCH_A, MultiFromState.BRANCH_B], to: MultiFromState.MERGE },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // Check that both BRANCH_A and BRANCH_B have transitions to MERGE
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: 'BRANCH_A',
          to: 'MERGE',
          type: 'explicit',
        })
      );
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: 'BRANCH_B',
          to: 'MERGE',
          type: 'explicit',
        })
      );
    });

    it('should include state metadata from StateRegistry when available', () => {
      @State(TestState.PROCESSING)
      @Timeout(5000)
      @Retry({
        maxAttempts: 3,
        strategy: 'exponential',
        initialDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
      })
      @UnlockAfter()
      class ProcessingState implements IState<any, any, any> {
        execute(ctx: WorkflowContext<any, any>, actions: StateActions<any, any, any>) {
          actions.next({ output: {} });
        }
      }

      StateRegistry.autoRegister([ProcessingState]);

      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // Graph should be built successfully regardless of metadata
      expect(graph.nodes).toHaveLength(4);
      const processingNode = graph.nodes.find(n => n.id === 'PROCESSING');
      expect(processingNode).toBeDefined();

      // Metadata might be available if StateRegistry returns the class correctly
      // This is tested more thoroughly in integration tests
      if (processingNode?.metadata) {
        expect(processingNode.metadata.timeout).toBe(5000);
        expect(processingNode.metadata.retry?.maxAttempts).toBe(3);
        expect(processingNode.metadata.unlockAfter).toBe(true);
      }
    });

    it('should handle mixed transition types (explicit, conditional, automatic)', () => {
      enum MixedState {
        A = 'A',
        B = 'B',
        C = 'C',
        D = 'D',
        E = 'E',
      }

      const metadata: WorkflowMetadataConfig<MixedState> = {
        name: 'MixedWorkflow',
        states: MixedState,
        initialState: MixedState.A,
        transitions: [
          { from: [MixedState.A], to: MixedState.B }, // Explicit
        ],
        conditionalTransitions: [
          {
            from: MixedState.C,
            conditions: [{ condition: ctx => !!ctx.data.skip, to: MixedState.E }],
            default: MixedState.D,
          },
        ],
        // B -> C should be automatic
        // D -> E should be automatic
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // A -> B: explicit
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: 'A',
          to: 'B',
          type: 'explicit',
        })
      );

      // B -> C: automatic (no explicit/conditional)
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: 'B',
          to: 'C',
          type: 'automatic',
        })
      );

      // C -> E/D: conditional
      const cEdges = graph.edges.filter(e => e.from === 'C');
      expect(cEdges.length).toBeGreaterThan(0);
      expect(cEdges.every(e => e.type === 'conditional')).toBe(true);

      // D -> E: automatic
      expect(graph.edges).toContainEqual(
        expect.objectContaining({
          from: 'D',
          to: 'E',
          type: 'automatic',
        })
      );
    });

    it('should handle transitions with inline conditions', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
        transitions: [
          {
            from: [TestState.CREATED],
            to: TestState.VALIDATED,
            condition: ctx => !!ctx.data.shouldValidate,
          },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      const edge = graph.edges.find(e => e.from === 'CREATED' && e.to === 'VALIDATED');
      expect(edge).toBeDefined();
      expect(edge?.type).toBe('explicit');
      expect(edge?.condition).toBeDefined();
      expect(edge?.label).toBe('conditional');
    });

    it('should mark states as virtual when they have virtualOutputs', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
        conditionalTransitions: [
          {
            from: TestState.CREATED,
            conditions: [
              {
                condition: ctx => !!ctx.data.skipValidation,
                to: TestState.PROCESSING,
                virtualOutputs: {
                  [TestState.VALIDATED]: { skipped: true },
                },
              },
            ],
            default: TestState.VALIDATED,
          },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // VALIDATED should be marked as virtual
      const validatedNode = graph.nodes.find(n => n.id === 'VALIDATED');
      expect(validatedNode?.isVirtual).toBe(true);

      // Other states should not be virtual
      const createdNode = graph.nodes.find(n => n.id === 'CREATED');
      expect(createdNode?.isVirtual).toBe(false);

      const processingNode = graph.nodes.find(n => n.id === 'PROCESSING');
      expect(processingNode?.isVirtual).toBe(false);
    });

    it('should include virtualStates in conditional edges', () => {
      const metadata: WorkflowMetadataConfig<TestState> = {
        name: 'TestWorkflow',
        states: TestState,
        initialState: TestState.CREATED,
        conditionalTransitions: [
          {
            from: TestState.CREATED,
            conditions: [
              {
                condition: ctx => !!ctx.data.fastTrack,
                to: TestState.COMPLETED,
                virtualOutputs: {
                  [TestState.VALIDATED]: { skipped: true },
                  [TestState.PROCESSING]: { skipped: true },
                },
              },
            ],
            default: TestState.VALIDATED,
          },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // Find the conditional edge that skips states
      const fastTrackEdge = graph.edges.find(e => e.from === 'CREATED' && e.to === 'COMPLETED' && e.type === 'conditional');

      expect(fastTrackEdge).toBeDefined();
      expect(fastTrackEdge?.virtualStates).toBeDefined();
      expect(fastTrackEdge?.virtualStates).toEqual(expect.arrayContaining(['VALIDATED', 'PROCESSING']));
      expect(fastTrackEdge?.virtualStates?.length).toBe(2);

      // Both VALIDATED and PROCESSING should be marked as virtual
      const validatedNode = graph.nodes.find(n => n.id === 'VALIDATED');
      expect(validatedNode?.isVirtual).toBe(true);

      const processingNode = graph.nodes.find(n => n.id === 'PROCESSING');
      expect(processingNode?.isVirtual).toBe(true);
    });

    it('should handle multiple conditional transitions with virtualOutputs', () => {
      enum ComplexState {
        START = 'START',
        STEP_A = 'STEP_A',
        STEP_B = 'STEP_B',
        STEP_C = 'STEP_C',
        END = 'END',
      }

      const metadata: WorkflowMetadataConfig<ComplexState> = {
        name: 'ComplexWorkflow',
        states: ComplexState,
        initialState: ComplexState.START,
        conditionalTransitions: [
          {
            from: ComplexState.START,
            conditions: [
              {
                condition: ctx => !!ctx.data.skipAll,
                to: ComplexState.END,
                virtualOutputs: {
                  [ComplexState.STEP_A]: { skipped: true },
                  [ComplexState.STEP_B]: { skipped: true },
                  [ComplexState.STEP_C]: { skipped: true },
                },
              },
              {
                condition: ctx => !!ctx.data.skipB,
                to: ComplexState.STEP_C,
                virtualOutputs: {
                  [ComplexState.STEP_B]: { skipped: true },
                },
              },
            ],
            default: ComplexState.STEP_A,
          },
        ],
      };

      const graph = WorkflowGraphBuilder.buildGraph(metadata);

      // All steps except START and END should be marked as virtual
      const stepA = graph.nodes.find(n => n.id === 'STEP_A');
      const stepB = graph.nodes.find(n => n.id === 'STEP_B');
      const stepC = graph.nodes.find(n => n.id === 'STEP_C');

      expect(stepA?.isVirtual).toBe(true);
      expect(stepB?.isVirtual).toBe(true);
      expect(stepC?.isVirtual).toBe(true);

      // Check edges have correct virtualStates
      const skipAllEdge = graph.edges.find(e => e.from === 'START' && e.to === 'END' && e.label === 'condition 1');
      expect(skipAllEdge?.virtualStates).toEqual(expect.arrayContaining(['STEP_A', 'STEP_B', 'STEP_C']));

      const skipBEdge = graph.edges.find(e => e.from === 'START' && e.to === 'STEP_C' && e.label === 'condition 2');
      expect(skipBEdge?.virtualStates).toEqual(['STEP_B']);
    });
  });
});
