import { WorkflowStatus } from './context.types';

/**
 * Type of transition between states
 */
export type TransitionType = 'explicit' | 'conditional' | 'automatic';

/**
 * Status of a state in execution graph
 */
export type ExecutionNodeStatus = 'executed' | 'current' | 'failed' | 'suspended' | 'skipped' | 'not_reached';

/**
 * Status of a transition in execution graph
 */
export type ExecutionEdgeStatus = 'success' | 'failure' | 'suspended' | 'error_recovery';

/**
 * Metadata about a state from decorators for graph display
 */
export interface GraphStateMetadata {
  timeout?: number;
  retry?: {
    maxAttempts: number;
    strategy?: 'exponential' | 'linear' | 'fixed';
    initialDelay?: number;
    maxDelay?: number;
    multiplier?: number;
  };
  unlockAfter?: boolean;
}

/**
 * Node in a workflow graph representing a state
 */
export interface GraphNode {
  id: string;
  label: string;
  isInitial: boolean;
  isVirtual?: boolean; // State can be skipped via conditional transition with virtualOutputs
  metadata?: GraphStateMetadata;
}

/**
 * Edge in a workflow graph representing a transition
 */
export interface GraphEdge {
  from: string;
  to: string;
  type: TransitionType;
  condition?: string;
  label?: string;
  virtualStates?: string[]; // States that will be skipped on this transition with virtualOutputs
}

/**
 * Static workflow graph showing all possible states and transitions
 */
export interface WorkflowGraph {
  workflowName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Node in an execution graph representing a state with execution status
 */
export interface ExecutionNode {
  id: string;
  label: string;
  status: ExecutionNodeStatus;
  attempts: number;
  totalDuration?: number;
  output?: unknown;
  error?: string;
}

/**
 * Edge in an execution graph representing an actual transition
 */
export interface ExecutionEdge {
  from: string;
  to: string;
  status: ExecutionEdgeStatus;
  transitionType?: TransitionType;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  error?: string;
  attempt?: number;
}

/**
 * Dynamic execution graph showing actual execution path with statuses
 */
export interface ExecutionGraph {
  executionId: string;
  workflowName: string;
  status: WorkflowStatus;
  currentState: string;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
}
