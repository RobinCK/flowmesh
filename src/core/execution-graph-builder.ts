import { WorkflowExecution } from '../types/context.types';
import { ExecutionGraph, ExecutionNode, ExecutionEdge, ExecutionNodeStatus, ExecutionEdgeStatus } from '../types/graph.types';

/**
 * Builder for generating execution graphs from workflow execution history
 */
export class ExecutionGraphBuilder {
  /**
   * Build an execution graph from a workflow execution showing actual execution path
   */
  static buildGraph<TData extends Record<string, unknown> = Record<string, unknown>>(
    execution: WorkflowExecution<TData>
  ): ExecutionGraph {
    const nodes = this.buildNodes(execution);
    const edges = this.buildEdges(execution);

    return {
      executionId: execution.id,
      workflowName: execution.workflowName,
      status: execution.status,
      currentState: execution.currentState,
      nodes,
      edges,
    };
  }

  /**
   * Build nodes from execution history with statuses
   */
  private static buildNodes<TData extends Record<string, unknown>>(execution: WorkflowExecution<TData>): ExecutionNode[] {
    // Collect unique states from history
    const stateData = new Map<
      string,
      {
        attempts: number;
        totalDuration: number;
        status: ExecutionNodeStatus;
        error?: string;
      }
    >();

    // Process history to aggregate state data
    for (const transition of execution.history) {
      const fromId = String(transition.from);
      const toId = String(transition.to);

      // Initialize from state if not exists
      if (!stateData.has(fromId)) {
        stateData.set(fromId, {
          attempts: 0,
          totalDuration: 0,
          status: 'executed',
        });
      }

      // Initialize to state if not exists (unless it's a self-transition)
      if (fromId !== toId && !stateData.has(toId)) {
        stateData.set(toId, {
          attempts: 0,
          totalDuration: 0,
          status: 'executed',
        });
      }

      const data = stateData.get(fromId)!;

      // Count attempts (only for the from state)
      data.attempts++;

      // Sum durations (only for the from state)
      if (transition.duration) {
        data.totalDuration += transition.duration;
      }

      // Determine status based on transition status
      if (transition.status === 'failure') {
        data.status = 'failed';
        data.error = transition.error;
      } else if (transition.status === 'suspended') {
        data.status = 'suspended';
      } else if (transition.status === 'error_recovery') {
        data.status = 'failed';
        data.error = transition.error;
      } else if (data.status !== 'failed' && data.status !== 'suspended') {
        data.status = 'executed';
      }
    }

    // Build nodes from aggregated data
    const nodes: ExecutionNode[] = [];

    for (const [stateId, data] of stateData.entries()) {
      let status = data.status;

      // Mark current state
      if (stateId === execution.currentState) {
        status = 'current';
      }

      nodes.push({
        id: stateId,
        label: stateId,
        status,
        attempts: data.attempts,
        totalDuration: data.totalDuration || undefined,
        output: execution.outputs[stateId],
        error: data.error,
      });
    }

    return nodes;
  }

  /**
   * Build edges from execution history
   */
  private static buildEdges<TData extends Record<string, unknown>>(execution: WorkflowExecution<TData>): ExecutionEdge[] {
    const edges: ExecutionEdge[] = [];
    const attemptCounters = new Map<string, number>();

    for (const transition of execution.history) {
      const fromId = String(transition.from);
      const toId = String(transition.to);
      const edgeKey = `${fromId}_${toId}`;

      // Track attempt number for retries (self-transitions)
      let attempt: number | undefined;
      if (fromId === toId) {
        const currentAttempt = (attemptCounters.get(edgeKey) || 0) + 1;
        attemptCounters.set(edgeKey, currentAttempt);
        attempt = currentAttempt;
      }

      edges.push({
        from: fromId,
        to: toId,
        status: transition.status as ExecutionEdgeStatus,
        startedAt: transition.startedAt,
        completedAt: transition.completedAt,
        duration: transition.duration,
        error: transition.error,
        attempt,
      });
    }

    return edges;
  }
}
