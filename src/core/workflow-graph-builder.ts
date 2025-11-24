import { WorkflowMetadataConfig } from '../types/workflow.types';
import { WorkflowGraph, GraphNode, GraphEdge, TransitionType } from '../types/graph.types';
import { StateRegistry } from './state-registry';
import { getStateTimeout, getStateRetry, getStateConcurrency } from '../decorators/state.decorator';

/**
 * Builder for generating static workflow graphs from metadata
 */
export class WorkflowGraphBuilder {
  /**
   * Build a static graph from workflow metadata showing all possible states and transitions
   */
  static buildGraph<TState = unknown>(metadata: WorkflowMetadataConfig<TState>): WorkflowGraph {
    const states = Object.values(metadata.states) as TState[];

    // First, collect virtual states from conditional transitions
    const virtualStatesSet = this.collectVirtualStates(metadata);

    const nodes = this.buildNodes(states, metadata.initialState, virtualStatesSet);
    const edges = this.buildEdges(states, metadata);

    return {
      workflowName: metadata.name,
      nodes,
      edges,
    };
  }

  /**
   * Collect all states that can be skipped via virtualOutputs in conditional transitions
   */
  private static collectVirtualStates<TState>(metadata: WorkflowMetadataConfig<TState>): Set<string> {
    const virtualStates = new Set<string>();

    if (!metadata.conditionalTransitions) {
      return virtualStates;
    }

    for (const ct of metadata.conditionalTransitions) {
      // Check each condition for virtualOutputs
      for (const cond of ct.conditions) {
        if (cond.virtualOutputs) {
          const virtualStateKeys = Object.keys(cond.virtualOutputs);
          for (const stateKey of virtualStateKeys) {
            virtualStates.add(stateKey);
          }
        }
      }
    }

    return virtualStates;
  }

  /**
   * Build nodes from states with metadata
   */
  private static buildNodes<TState>(states: TState[], initialState: TState, virtualStates: Set<string>): GraphNode[] {
    return states.map(state => {
      const stateId = String(state);

      // Try to get state metadata from registry
      let stateMetadata: GraphNode['metadata'];
      try {
        const stateClassOrInstance = StateRegistry.get(stateId);
        if (stateClassOrInstance) {
          // Get constructor class (decorators are on the class, not instance)
          const StateClass = typeof stateClassOrInstance === 'function' ? stateClassOrInstance : stateClassOrInstance.constructor;

          const timeout = getStateTimeout(StateClass);
          const retry = getStateRetry(StateClass);
          const concurrency = getStateConcurrency(StateClass);

          // Only set metadata if at least one property is defined
          if (timeout !== undefined || retry !== undefined || concurrency?.unlockAfter !== undefined) {
            stateMetadata = {
              timeout,
              retry,
              unlockAfter: concurrency?.unlockAfter,
            };
          }
        }
      } catch {
        // State might not be registered yet, skip metadata
      }

      return {
        id: stateId,
        label: stateId,
        isInitial: state === initialState,
        isVirtual: virtualStates.has(stateId),
        metadata: stateMetadata,
      };
    });
  }

  /**
   * Build edges from all transition types with priority order
   */
  private static buildEdges<TState>(states: TState[], metadata: WorkflowMetadataConfig<TState>): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const stateIds = states.map(s => String(s));

    // Track which states have explicit/conditional transitions
    const statesWithTransitions = new Set<string>();

    // 1. Add conditional transitions (all branches)
    if (metadata.conditionalTransitions) {
      for (const ct of metadata.conditionalTransitions) {
        const fromId = String(ct.from);
        statesWithTransitions.add(fromId);

        // Add each condition as a separate edge
        for (let i = 0; i < ct.conditions.length; i++) {
          const cond = ct.conditions[i];

          // Collect virtual states for this condition
          const virtualStates = cond.virtualOutputs ? Object.keys(cond.virtualOutputs) : undefined;

          edges.push({
            from: fromId,
            to: String(cond.to),
            type: 'conditional' as TransitionType,
            condition: cond.condition.toString(),
            label: `condition ${i + 1}`,
            virtualStates,
          });
        }

        // Add default path if exists
        if (ct.default) {
          edges.push({
            from: fromId,
            to: String(ct.default),
            type: 'conditional' as TransitionType,
            label: 'default',
          });
        }
      }
    }

    // 2. Add explicit transitions
    if (metadata.transitions) {
      for (const t of metadata.transitions) {
        const fromArray = Array.isArray(t.from) ? t.from : [t.from];

        for (const from of fromArray) {
          const fromId = String(from);
          statesWithTransitions.add(fromId);

          edges.push({
            from: fromId,
            to: String(t.to),
            type: 'explicit' as TransitionType,
            condition: t.condition?.toString(),
            label: t.condition ? 'conditional' : undefined,
          });
        }
      }
    }

    // 3. Add automatic transitions (enum order) for states without explicit/conditional
    for (let i = 0; i < stateIds.length - 1; i++) {
      const fromId = stateIds[i];
      const toId = stateIds[i + 1];

      // Only add automatic transition if state doesn't have explicit/conditional
      if (!statesWithTransitions.has(fromId)) {
        edges.push({
          from: fromId,
          to: toId,
          type: 'automatic' as TransitionType,
          label: 'next',
        });
      }
    }

    return edges;
  }
}
