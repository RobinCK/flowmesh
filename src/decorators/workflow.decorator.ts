import 'reflect-metadata';
import { WorkflowMetadataConfig, ConcurrencyConfig, TransitionConfig, ConditionalTransition, ErrorHandler } from '../types';

export const WORKFLOW_METADATA_KEY = Symbol.for('flowmesh:workflow');

export interface WorkflowDecoratorOptions<TState = unknown> {
  name: string;
  states: Record<string, TState>;
  initialState: TState;
  concurrency?: ConcurrencyConfig;
  transitions?: TransitionConfig<TState>[];
  conditionalTransitions?: ConditionalTransition<TState>[];
  errorHandler?: ErrorHandler | (new (...args: any[]) => ErrorHandler);
}

export function Workflow<TState>(options: WorkflowDecoratorOptions<TState>): ClassDecorator {
  return (target: any) => {
    const metadata: WorkflowMetadataConfig<TState> = {
      name: options.name,
      states: options.states,
      initialState: options.initialState,
      concurrency: options.concurrency,
      transitions: options.transitions,
      conditionalTransitions: options.conditionalTransitions,
      errorHandler: options.errorHandler,
    };

    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target);
    Reflect.defineMetadata(WORKFLOW_METADATA_KEY, metadata, target.prototype);
  };
}

export function getWorkflowMetadata<TState = unknown>(target: any): WorkflowMetadataConfig<TState> | undefined {
  return Reflect.getMetadata(WORKFLOW_METADATA_KEY, target) || Reflect.getMetadata(WORKFLOW_METADATA_KEY, target.prototype);
}
