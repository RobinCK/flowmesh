import { WorkflowEngine } from '../../src/core/workflow-engine';
import { StateRegistry } from '../../src/core/state-registry';
import { Workflow } from '../../src/decorators/workflow.decorator';
import { State, Timeout, Retry, UnlockAfter } from '../../src/decorators/state.decorator';
import { IState, StateActions, WorkflowContext, ConcurrencyMode } from '../../src/types';
import { InMemoryPersistenceAdapter } from '../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../src/adapters/in-memory-lock.adapter';

describe('Graph Generation Integration', () => {
  enum OrderState {
    CREATED = 'CREATED',
    INVENTORY_CHECK = 'INVENTORY_CHECK',
    PAYMENT = 'PAYMENT',
    SHIPPING = 'SHIPPING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
  }

  interface OrderData extends Record<string, unknown> {
    orderId: string;
    amount: number;
    inStock?: boolean;
    paymentFailed?: boolean;
  }

  interface OrderOutputs extends Record<string, unknown> {
    [OrderState.CREATED]: { orderId: string };
    [OrderState.INVENTORY_CHECK]: { available: boolean };
    [OrderState.PAYMENT]: { transactionId: string };
    [OrderState.SHIPPING]: { trackingNumber: string };
    [OrderState.COMPLETED]: { completedAt: Date };
    [OrderState.FAILED]: { reason: string };
  }

  @Workflow({
    name: 'OrderWorkflow',
    states: OrderState,
    initialState: OrderState.CREATED,
    conditionalTransitions: [
      {
        from: OrderState.INVENTORY_CHECK,
        conditions: [{ condition: ctx => !ctx.data.inStock, to: OrderState.FAILED }],
        default: OrderState.PAYMENT,
      },
      {
        from: OrderState.PAYMENT,
        conditions: [{ condition: ctx => !!ctx.data.paymentFailed, to: OrderState.FAILED }],
        default: OrderState.SHIPPING,
      },
    ],
    concurrency: {
      mode: ConcurrencyMode.SEQUENTIAL,
      groupBy: 'orderId',
    },
  })
  class OrderWorkflow {}

  @State(OrderState.CREATED)
  class CreatedState implements IState<OrderData, OrderOutputs, OrderState.CREATED> {
    execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.CREATED>) {
      actions.next({ output: { orderId: ctx.data.orderId } });
    }
  }

  @State(OrderState.INVENTORY_CHECK)
  @Timeout(5000)
  class InventoryCheckState implements IState<OrderData, OrderOutputs, OrderState.INVENTORY_CHECK> {
    execute(
      ctx: WorkflowContext<OrderData, OrderOutputs>,
      actions: StateActions<OrderData, OrderOutputs, OrderState.INVENTORY_CHECK>
    ) {
      actions.next({ output: { available: ctx.data.inStock ?? true } });
    }
  }

  @State(OrderState.PAYMENT)
  @Retry({
    maxAttempts: 3,
    strategy: 'exponential',
    initialDelay: 100,
    maxDelay: 1000,
    multiplier: 2,
  })
  @UnlockAfter()
  class PaymentState implements IState<OrderData, OrderOutputs, OrderState.PAYMENT> {
    execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.PAYMENT>) {
      if (ctx.data.paymentFailed) {
        throw new Error('Payment gateway error');
      }
      actions.next({ output: { transactionId: 'tx_123' } });
    }
  }

  @State(OrderState.SHIPPING)
  class ShippingState implements IState<OrderData, OrderOutputs, OrderState.SHIPPING> {
    execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.SHIPPING>) {
      actions.next({ output: { trackingNumber: 'TRACK_456' } });
    }
  }

  @State(OrderState.COMPLETED)
  class CompletedState implements IState<OrderData, OrderOutputs, OrderState.COMPLETED> {
    execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.COMPLETED>) {
      actions.complete({ output: { completedAt: new Date() } });
    }
  }

  @State(OrderState.FAILED)
  class FailedState implements IState<OrderData, OrderOutputs, OrderState.FAILED> {
    execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.FAILED>) {
      actions.complete({ output: { reason: 'Order failed' } });
    }
  }

  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();

    engine = new WorkflowEngine({
      persistence,
      lockAdapter: new InMemoryLockAdapter(),
    });

    StateRegistry.autoRegister([
      new CreatedState(),
      new InventoryCheckState(),
      new PaymentState(),
      new ShippingState(),
      new CompletedState(),
      new FailedState(),
    ]);
  });

  describe('Static Workflow Graph', () => {
    it('should generate static graph with all possible transitions', () => {
      const graph = engine.getWorkflowGraph(OrderWorkflow);

      expect(graph.workflowName).toBe('OrderWorkflow');
      expect(graph.nodes).toHaveLength(6);
      expect(graph.edges.length).toBeGreaterThan(0);

      // Check initial state
      const initialNode = graph.nodes.find(n => n.id === 'CREATED');
      expect(initialNode?.isInitial).toBe(true);

      // Check that state metadata is included
      const paymentNode = graph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.metadata?.retry).toBeDefined();
      expect(paymentNode?.metadata?.retry?.maxAttempts).toBe(3);
      expect(paymentNode?.metadata?.unlockAfter).toBe(true);

      const inventoryNode = graph.nodes.find(n => n.id === 'INVENTORY_CHECK');
      expect(inventoryNode?.metadata?.timeout).toBe(5000);

      // Check conditional transitions
      const conditionalEdges = graph.edges.filter(e => e.type === 'conditional');
      expect(conditionalEdges.length).toBeGreaterThan(0);

      // INVENTORY_CHECK should have conditional transitions to FAILED and PAYMENT
      const inventoryEdges = conditionalEdges.filter(e => e.from === 'INVENTORY_CHECK');
      expect(inventoryEdges.length).toBeGreaterThan(0);
    });

    it('should show all possible paths including failure paths', () => {
      const graph = engine.getWorkflowGraph(OrderWorkflow);

      // Check that FAILED state is reachable from INVENTORY_CHECK
      const toFailedFromInventory = graph.edges.find(
        e => e.from === 'INVENTORY_CHECK' && e.to === 'FAILED' && e.type === 'conditional'
      );
      expect(toFailedFromInventory).toBeDefined();

      // Check that FAILED state is reachable from PAYMENT
      const toFailedFromPayment = graph.edges.find(e => e.from === 'PAYMENT' && e.to === 'FAILED' && e.type === 'conditional');
      expect(toFailedFromPayment).toBeDefined();
    });
  });

  describe('Dynamic Execution Graph', () => {
    it('should generate execution graph for successful workflow', async () => {
      const execution = await engine.execute(OrderWorkflow, {
        data: {
          orderId: 'ORD-001',
          amount: 100,
          inStock: true,
          paymentFailed: false,
        },
      });

      const executionGraph = await engine.getExecutionGraph(execution.id);

      expect(executionGraph.executionId).toBe(execution.id);
      expect(executionGraph.workflowName).toBe('OrderWorkflow');
      expect(executionGraph.status).toBe('completed');

      // All states should be executed except FAILED
      const executedNodes = executionGraph.nodes.filter(n => n.status === 'executed' || n.status === 'current');
      expect(executedNodes.length).toBeGreaterThan(0);

      // Check that outputs are included
      const createdNode = executionGraph.nodes.find(n => n.id === 'CREATED');
      expect(createdNode?.output).toEqual({ orderId: 'ORD-001' });

      // Check transitions
      expect(executionGraph.edges.length).toBeGreaterThan(0);
      expect(executionGraph.edges.every(e => e.status === 'success')).toBe(true);
    });

    it('should generate execution graph with conditional path (out of stock)', async () => {
      const execution = await engine.execute(OrderWorkflow, {
        data: {
          orderId: 'ORD-002',
          amount: 100,
          inStock: false, // This will trigger conditional transition to FAILED
        },
      });

      const executionGraph = await engine.getExecutionGraph(execution.id);

      // Should have CREATED, INVENTORY_CHECK, and FAILED states
      expect(executionGraph.nodes.length).toBeGreaterThanOrEqual(3);

      // PAYMENT and SHIPPING should not be in the execution graph
      const paymentNode = executionGraph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode).toBeUndefined();

      // FAILED state should be reached
      const failedNode = executionGraph.nodes.find(n => n.id === 'FAILED');
      expect(failedNode).toBeDefined();
      expect(failedNode?.status === 'executed' || failedNode?.status === 'current').toBe(true);

      // Check transition from INVENTORY_CHECK to FAILED
      const toFailedEdge = executionGraph.edges.find(e => e.from === 'INVENTORY_CHECK' && e.to === 'FAILED');
      expect(toFailedEdge).toBeDefined();
      expect(toFailedEdge?.status).toBe('success');
    });

    it('should generate execution graph with retry attempts', async () => {
      let paymentAttempts = 0;

      @State(OrderState.PAYMENT)
      @Retry({
        maxAttempts: 3,
        strategy: 'fixed',
        initialDelay: 10,
      })
      class RetryPaymentState implements IState<OrderData, OrderOutputs, OrderState.PAYMENT> {
        execute(
          ctx: WorkflowContext<OrderData, OrderOutputs>,
          actions: StateActions<OrderData, OrderOutputs, OrderState.PAYMENT>
        ) {
          paymentAttempts++;
          if (paymentAttempts < 3) {
            throw new Error('Temporary payment failure');
          }
          actions.next({ output: { transactionId: 'tx_456' } });
        }
      }

      StateRegistry.register('PAYMENT', new RetryPaymentState() as any);

      const execution = await engine.execute(OrderWorkflow, {
        data: {
          orderId: 'ORD-003',
          amount: 100,
          inStock: true,
        },
      });

      const executionGraph = await engine.getExecutionGraph(execution.id);

      // PAYMENT node should show multiple attempts
      const paymentNode = executionGraph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.attempts).toBeGreaterThan(1);

      // Should have self-transition edges for retries
      const retryEdges = executionGraph.edges.filter(e => e.from === 'PAYMENT' && e.to === 'PAYMENT');
      expect(retryEdges.length).toBeGreaterThan(0);
      expect(retryEdges[0].status).toBe('failure');
      expect(retryEdges[0].attempt).toBeDefined();
    });

    it('should generate execution graph for failed workflow', async () => {
      @State(OrderState.PAYMENT)
      class AlwaysFailPaymentState implements IState<OrderData, OrderOutputs, OrderState.PAYMENT> {
        execute(
          ctx: WorkflowContext<OrderData, OrderOutputs>,
          actions: StateActions<OrderData, OrderOutputs, OrderState.PAYMENT>
        ) {
          throw new Error('Payment gateway unavailable');
        }
      }

      StateRegistry.register('PAYMENT', new AlwaysFailPaymentState() as any);

      let execution;
      try {
        execution = await engine.execute(OrderWorkflow, {
          data: {
            orderId: 'ORD-004',
            amount: 100,
            inStock: true,
          },
        });
      } catch (error) {
        // Expected to fail
        execution = await persistence.load('ORD-004');
      }

      if (!execution) {
        // Try to find by workflow name
        const executions = await persistence.find({ workflowName: 'OrderWorkflow' });
        execution = executions[executions.length - 1];
      }

      expect(execution).toBeDefined();

      const executionGraph = await engine.getExecutionGraph(execution!.id);

      expect(executionGraph.status).toBe('failed');

      // PAYMENT node should show failed status
      const paymentNode = executionGraph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.status === 'failed' || paymentNode?.status === 'current').toBe(true);
      expect(paymentNode?.error).toBeDefined();

      // Should have failure transition
      const failureEdge = executionGraph.edges.find(e => e.from === 'PAYMENT' && e.status === 'failure');
      expect(failureEdge).toBeDefined();
    });
  });

  describe('Graph Comparison', () => {
    it('should show differences between static graph and execution graph', async () => {
      // Get static graph (all possible paths)
      const staticGraph = engine.getWorkflowGraph(OrderWorkflow);

      // Execute workflow with specific path
      const execution = await engine.execute(OrderWorkflow, {
        data: {
          orderId: 'ORD-005',
          amount: 100,
          inStock: true,
          paymentFailed: false,
        },
      });

      // Get execution graph (actual path taken)
      const executionGraph = await engine.getExecutionGraph(execution.id);

      // Static graph should have more states (includes all possible states)
      expect(staticGraph.nodes.length).toBeGreaterThanOrEqual(executionGraph.nodes.length);

      // Static graph should have more edges (includes all possible transitions)
      expect(staticGraph.edges.length).toBeGreaterThanOrEqual(executionGraph.edges.length);

      // Execution graph should not include FAILED state if it wasn't reached
      // (workflow completed normally without going through FAILED state)
      // Actually, if COMPLETED is final state, FAILED shouldn't be reached
      const completedNode = executionGraph.nodes.find(n => n.id === 'COMPLETED');
      expect(completedNode).toBeDefined();
      expect(completedNode?.status).toBe('current');

      // But static graph should include FAILED state
      const failedInStatic = staticGraph.nodes.find(n => n.id === 'FAILED');
      expect(failedInStatic).toBeDefined();
    });
  });

  describe('Virtual States', () => {
    enum FastTrackState {
      START = 'START',
      VALIDATION = 'VALIDATION',
      PAYMENT = 'PAYMENT',
      SHIPPING = 'SHIPPING',
      COMPLETED = 'COMPLETED',
    }

    interface FastTrackData extends Record<string, unknown> {
      userId: string;
      isPremium?: boolean;
    }

    interface FastTrackOutputs extends Record<string, unknown> {
      [FastTrackState.START]: { userId: string };
      [FastTrackState.VALIDATION]: { validated: boolean };
      [FastTrackState.PAYMENT]: { paid: boolean };
      [FastTrackState.SHIPPING]: { shipped: boolean };
      [FastTrackState.COMPLETED]: { completedAt: Date };
    }

    @Workflow({
      name: 'FastTrackWorkflow',
      states: FastTrackState,
      initialState: FastTrackState.START,
      conditionalTransitions: [
        {
          from: FastTrackState.START,
          conditions: [
            {
              condition: ctx => !!ctx.data.isPremium,
              to: FastTrackState.COMPLETED,
              virtualOutputs: {
                [FastTrackState.VALIDATION]: { validated: true, skipped: true },
                [FastTrackState.PAYMENT]: { paid: true, skipped: true },
                [FastTrackState.SHIPPING]: { shipped: true, skipped: true },
              },
            },
          ],
          default: FastTrackState.VALIDATION,
        },
      ],
    })
    class FastTrackWorkflow {}

    @State(FastTrackState.START)
    class StartState implements IState<FastTrackData, FastTrackOutputs, FastTrackState.START> {
      execute(
        ctx: WorkflowContext<FastTrackData, FastTrackOutputs>,
        actions: StateActions<FastTrackData, FastTrackOutputs, FastTrackState.START>
      ) {
        actions.next({ output: { userId: ctx.data.userId } });
      }
    }

    @State(FastTrackState.VALIDATION)
    class ValidationState implements IState<FastTrackData, FastTrackOutputs, FastTrackState.VALIDATION> {
      execute(
        ctx: WorkflowContext<FastTrackData, FastTrackOutputs>,
        actions: StateActions<FastTrackData, FastTrackOutputs, FastTrackState.VALIDATION>
      ) {
        actions.next({ output: { validated: true } });
      }
    }

    @State(FastTrackState.PAYMENT)
    class PaymentFastTrackState implements IState<FastTrackData, FastTrackOutputs, FastTrackState.PAYMENT> {
      execute(
        ctx: WorkflowContext<FastTrackData, FastTrackOutputs>,
        actions: StateActions<FastTrackData, FastTrackOutputs, FastTrackState.PAYMENT>
      ) {
        actions.next({ output: { paid: true } });
      }
    }

    @State(FastTrackState.SHIPPING)
    class ShippingFastTrackState implements IState<FastTrackData, FastTrackOutputs, FastTrackState.SHIPPING> {
      execute(
        ctx: WorkflowContext<FastTrackData, FastTrackOutputs>,
        actions: StateActions<FastTrackData, FastTrackOutputs, FastTrackState.SHIPPING>
      ) {
        actions.next({ output: { shipped: true } });
      }
    }

    @State(FastTrackState.COMPLETED)
    class CompletedFastTrackState implements IState<FastTrackData, FastTrackOutputs, FastTrackState.COMPLETED> {
      execute(
        ctx: WorkflowContext<FastTrackData, FastTrackOutputs>,
        actions: StateActions<FastTrackData, FastTrackOutputs, FastTrackState.COMPLETED>
      ) {
        actions.complete({ output: { completedAt: new Date() } });
      }
    }

    beforeEach(() => {
      StateRegistry.autoRegister([
        new StartState(),
        new ValidationState(),
        new PaymentFastTrackState(),
        new ShippingFastTrackState(),
        new CompletedFastTrackState(),
      ]);
    });

    it('should mark skippable states as virtual in workflow graph', () => {
      const graph = engine.getWorkflowGraph(FastTrackWorkflow);

      // VALIDATION, PAYMENT, SHIPPING should be marked as virtual
      const validationNode = graph.nodes.find(n => n.id === 'VALIDATION');
      const paymentNode = graph.nodes.find(n => n.id === 'PAYMENT');
      const shippingNode = graph.nodes.find(n => n.id === 'SHIPPING');

      expect(validationNode?.isVirtual).toBe(true);
      expect(paymentNode?.isVirtual).toBe(true);
      expect(shippingNode?.isVirtual).toBe(true);

      // START and COMPLETED should not be virtual
      const startNode = graph.nodes.find(n => n.id === 'START');
      const completedNode = graph.nodes.find(n => n.id === 'COMPLETED');

      expect(startNode?.isVirtual).toBe(false);
      expect(completedNode?.isVirtual).toBe(false);
    });

    it('should include virtualStates in conditional edge', () => {
      const graph = engine.getWorkflowGraph(FastTrackWorkflow);

      // Find the premium fast-track edge
      const fastTrackEdge = graph.edges.find(e => e.from === 'START' && e.to === 'COMPLETED' && e.type === 'conditional');

      expect(fastTrackEdge).toBeDefined();
      expect(fastTrackEdge?.virtualStates).toBeDefined();
      expect(fastTrackEdge?.virtualStates).toEqual(expect.arrayContaining(['VALIDATION', 'PAYMENT', 'SHIPPING']));
      expect(fastTrackEdge?.virtualStates?.length).toBe(3);
    });

    it('should show all possible states even if some can be skipped', () => {
      const graph = engine.getWorkflowGraph(FastTrackWorkflow);

      // All 5 states should be present in the graph
      expect(graph.nodes).toHaveLength(5);
      expect(graph.nodes.map(n => n.id)).toEqual(
        expect.arrayContaining(['START', 'VALIDATION', 'PAYMENT', 'SHIPPING', 'COMPLETED'])
      );
    });
  });
});
