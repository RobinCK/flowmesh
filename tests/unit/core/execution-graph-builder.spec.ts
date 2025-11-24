import { ExecutionGraphBuilder } from '../../../src/core/execution-graph-builder';
import { WorkflowExecution, WorkflowStatus, StateTransition } from '../../../src/types';

describe('ExecutionGraphBuilder', () => {
  describe('buildGraph', () => {
    it('should build graph for successful execution', () => {
      const execution: WorkflowExecution = {
        id: 'exec_1',
        workflowName: 'TestWorkflow',
        currentState: 'COMPLETED',
        status: WorkflowStatus.COMPLETED,
        data: { test: true },
        outputs: {
          CREATED: { orderId: '123' },
          PAYMENT: { paid: true },
          COMPLETED: { done: true },
        },
        history: [
          {
            from: 'CREATED',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:00Z'),
            completedAt: new Date('2024-01-01T10:00:01Z'),
            duration: 1000,
            status: 'success',
          },
          {
            from: 'PAYMENT',
            to: 'COMPLETED',
            startedAt: new Date('2024-01-01T10:00:01Z'),
            completedAt: new Date('2024-01-01T10:00:02Z'),
            duration: 1000,
            status: 'success',
          },
        ] as StateTransition[],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:02Z'),
          completedAt: new Date('2024-01-01T10:00:02Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.executionId).toBe('exec_1');
      expect(graph.workflowName).toBe('TestWorkflow');
      expect(graph.status).toBe(WorkflowStatus.COMPLETED);
      expect(graph.currentState).toBe('COMPLETED');

      // Should have 3 nodes (CREATED, PAYMENT, COMPLETED)
      expect(graph.nodes).toHaveLength(3);

      // Check node statuses
      const createdNode = graph.nodes.find(n => n.id === 'CREATED');
      expect(createdNode?.status).toBe('executed');
      expect(createdNode?.attempts).toBe(1);
      expect(createdNode?.output).toEqual({ orderId: '123' });

      const completedNode = graph.nodes.find(n => n.id === 'COMPLETED');
      expect(completedNode?.status).toBe('current');

      // Should have 2 edges
      expect(graph.edges).toHaveLength(2);

      expect(graph.edges[0]).toEqual({
        from: 'CREATED',
        to: 'PAYMENT',
        status: 'success',
        startedAt: new Date('2024-01-01T10:00:00Z'),
        completedAt: new Date('2024-01-01T10:00:01Z'),
        duration: 1000,
        error: undefined,
        attempt: undefined,
      });
    });

    it('should build graph for execution with retry attempts', () => {
      const execution: WorkflowExecution = {
        id: 'exec_2',
        workflowName: 'RetryWorkflow',
        currentState: 'COMPLETED',
        status: WorkflowStatus.COMPLETED,
        data: { test: true },
        outputs: {
          CREATED: { orderId: '123' },
          PAYMENT: { paid: true },
          COMPLETED: { done: true },
        },
        history: [
          {
            from: 'CREATED',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:00Z'),
            completedAt: new Date('2024-01-01T10:00:01Z'),
            duration: 1000,
            status: 'success',
          },
          // First payment attempt fails
          {
            from: 'PAYMENT',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:01Z'),
            completedAt: new Date('2024-01-01T10:00:02Z'),
            duration: 1000,
            status: 'failure',
            error: 'Network timeout',
          },
          // Second payment attempt fails
          {
            from: 'PAYMENT',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:03Z'),
            completedAt: new Date('2024-01-01T10:00:04Z'),
            duration: 1000,
            status: 'failure',
            error: 'Network timeout',
          },
          // Third payment attempt succeeds
          {
            from: 'PAYMENT',
            to: 'COMPLETED',
            startedAt: new Date('2024-01-01T10:00:05Z'),
            completedAt: new Date('2024-01-01T10:00:06Z'),
            duration: 1000,
            status: 'success',
          },
        ] as StateTransition[],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:06Z'),
          completedAt: new Date('2024-01-01T10:00:06Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.nodes).toHaveLength(3);

      // PAYMENT node should show failed status and multiple attempts
      const paymentNode = graph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.status).toBe('failed');
      // 2 self-transitions (failures) + 1 successful transition = 3 attempts
      expect(paymentNode?.attempts).toBe(3);
      expect(paymentNode?.totalDuration).toBe(3000); // Sum of failure durations (not including final success)
      expect(paymentNode?.error).toBe('Network timeout');

      // Should have 4 edges
      expect(graph.edges).toHaveLength(4);

      // Check retry attempts
      const retryEdges = graph.edges.filter(e => e.from === 'PAYMENT' && e.to === 'PAYMENT');
      expect(retryEdges).toHaveLength(2);
      expect(retryEdges[0].attempt).toBe(1);
      expect(retryEdges[1].attempt).toBe(2);
      expect(retryEdges[0].status).toBe('failure');
    });

    it('should build graph for suspended execution', () => {
      const execution: WorkflowExecution = {
        id: 'exec_3',
        workflowName: 'SuspendWorkflow',
        currentState: 'AWAITING_APPROVAL',
        status: WorkflowStatus.SUSPENDED,
        data: { test: true },
        outputs: {
          CREATED: { orderId: '123' },
          AWAITING_APPROVAL: { pending: true },
        },
        suspension: {
          waitingFor: 'manager_approval',
          suspendedAt: new Date('2024-01-01T10:00:02Z'),
        },
        history: [
          {
            from: 'CREATED',
            to: 'AWAITING_APPROVAL',
            startedAt: new Date('2024-01-01T10:00:00Z'),
            completedAt: new Date('2024-01-01T10:00:01Z'),
            duration: 1000,
            status: 'success',
          },
          {
            from: 'AWAITING_APPROVAL',
            to: 'AWAITING_APPROVAL',
            startedAt: new Date('2024-01-01T10:00:01Z'),
            completedAt: new Date('2024-01-01T10:00:02Z'),
            duration: 1000,
            status: 'suspended',
          },
        ] as StateTransition[],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:02Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.status).toBe(WorkflowStatus.SUSPENDED);
      expect(graph.currentState).toBe('AWAITING_APPROVAL');

      // AWAITING_APPROVAL should be marked as current
      const approvalNode = graph.nodes.find(n => n.id === 'AWAITING_APPROVAL');
      expect(approvalNode?.status).toBe('current');
      // 1 attempt for transition TO this state + 1 for self-transition (suspended)
      expect(approvalNode?.attempts).toBeGreaterThanOrEqual(1);

      // Check suspended edge
      const suspendedEdge = graph.edges.find(e => e.status === 'suspended');
      expect(suspendedEdge).toBeDefined();
      expect(suspendedEdge?.from).toBe('AWAITING_APPROVAL');
      expect(suspendedEdge?.to).toBe('AWAITING_APPROVAL');
    });

    it('should build graph for failed execution', () => {
      const execution: WorkflowExecution = {
        id: 'exec_4',
        workflowName: 'FailedWorkflow',
        currentState: 'PAYMENT',
        status: WorkflowStatus.FAILED,
        data: { test: true },
        outputs: {
          CREATED: { orderId: '123' },
        },
        history: [
          {
            from: 'CREATED',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:00Z'),
            completedAt: new Date('2024-01-01T10:00:01Z'),
            duration: 1000,
            status: 'success',
          },
          {
            from: 'PAYMENT',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:01Z'),
            completedAt: new Date('2024-01-01T10:00:02Z'),
            duration: 1000,
            status: 'failure',
            error: 'Payment gateway error',
          },
        ] as StateTransition[],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:02Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.status).toBe(WorkflowStatus.FAILED);

      // PAYMENT should be current and failed
      const paymentNode = graph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.status).toBe('current');
      expect(paymentNode?.error).toBe('Payment gateway error');

      // CREATED should be executed successfully
      const createdNode = graph.nodes.find(n => n.id === 'CREATED');
      expect(createdNode?.status).toBe('executed');
    });

    it('should build graph with error recovery transitions', () => {
      const execution: WorkflowExecution = {
        id: 'exec_5',
        workflowName: 'RecoveryWorkflow',
        currentState: 'COMPLETED',
        status: WorkflowStatus.COMPLETED,
        data: { test: true },
        outputs: {
          CREATED: { orderId: '123' },
          PAYMENT: { failed: true },
          ERROR_HANDLER: { recovered: true },
          COMPLETED: { done: true },
        },
        history: [
          {
            from: 'CREATED',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:00Z'),
            completedAt: new Date('2024-01-01T10:00:01Z'),
            duration: 1000,
            status: 'success',
          },
          {
            from: 'PAYMENT',
            to: 'PAYMENT',
            startedAt: new Date('2024-01-01T10:00:01Z'),
            completedAt: new Date('2024-01-01T10:00:02Z'),
            duration: 1000,
            status: 'error_recovery',
            error: 'Payment failed, recovering',
          },
          {
            from: 'PAYMENT',
            to: 'ERROR_HANDLER',
            startedAt: new Date('2024-01-01T10:00:02Z'),
            completedAt: new Date('2024-01-01T10:00:03Z'),
            duration: 1000,
            status: 'success',
          },
          {
            from: 'ERROR_HANDLER',
            to: 'COMPLETED',
            startedAt: new Date('2024-01-01T10:00:03Z'),
            completedAt: new Date('2024-01-01T10:00:04Z'),
            duration: 1000,
            status: 'success',
          },
        ] as StateTransition[],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:04Z'),
          completedAt: new Date('2024-01-01T10:00:04Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(4);

      // PAYMENT should be marked as failed due to error_recovery
      const paymentNode = graph.nodes.find(n => n.id === 'PAYMENT');
      expect(paymentNode?.status).toBe('failed');

      // Check error_recovery edge
      const recoveryEdge = graph.edges.find(e => e.status === 'error_recovery');
      expect(recoveryEdge).toBeDefined();
      expect(recoveryEdge?.from).toBe('PAYMENT');
      expect(recoveryEdge?.to).toBe('PAYMENT');
      expect(recoveryEdge?.error).toBe('Payment failed, recovering');
    });

    it('should handle empty history', () => {
      const execution: WorkflowExecution = {
        id: 'exec_6',
        workflowName: 'EmptyWorkflow',
        currentState: 'CREATED',
        status: WorkflowStatus.RUNNING,
        data: { test: true },
        outputs: {},
        history: [],
        metadata: {
          startedAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
          totalAttempts: 1,
        },
      };

      const graph = ExecutionGraphBuilder.buildGraph(execution);

      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
    });
  });
});
