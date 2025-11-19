import 'reflect-metadata';

export const TRANSITION_METADATA_KEY = Symbol.for('flowmesh:transition');
export const CONDITIONAL_TRANSITION_METADATA_KEY = Symbol.for('flowmesh:conditional-transition');

export interface TransitionMetadata<TState = unknown> {
  from: TState[];
  to: TState;
  propertyKey: string | symbol;
  condition?: (...args: any[]) => any;
}

export interface ConditionalTransitionMetadata<TState = unknown> {
  from: TState;
  propertyKey: string | symbol;
}

export function Transition<TState>(options: { from: TState | TState[]; to: TState }): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const fromArray = Array.isArray(options.from) ? options.from : [options.from];

    const metadata: TransitionMetadata<TState> = {
      from: fromArray,
      to: options.to,
      propertyKey,
      condition: descriptor.value,
    };

    const existingTransitions: TransitionMetadata<TState>[] =
      Reflect.getMetadata(TRANSITION_METADATA_KEY, target.constructor) || [];

    existingTransitions.push(metadata);
    Reflect.defineMetadata(TRANSITION_METADATA_KEY, existingTransitions, target.constructor);

    return descriptor;
  };
}

export function ConditionalTransition<TState>(options: { from: TState }): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const metadata: ConditionalTransitionMetadata<TState> = {
      from: options.from,
      propertyKey,
    };

    const existingTransitions: ConditionalTransitionMetadata<TState>[] =
      Reflect.getMetadata(CONDITIONAL_TRANSITION_METADATA_KEY, target.constructor) || [];

    existingTransitions.push(metadata);
    Reflect.defineMetadata(CONDITIONAL_TRANSITION_METADATA_KEY, existingTransitions, target.constructor);

    return descriptor;
  };
}

export function getTransitions<TState = unknown>(target: any): TransitionMetadata<TState>[] {
  return Reflect.getMetadata(TRANSITION_METADATA_KEY, target) || [];
}

export function getConditionalTransitions<TState = unknown>(target: any): ConditionalTransitionMetadata<TState>[] {
  return Reflect.getMetadata(CONDITIONAL_TRANSITION_METADATA_KEY, target) || [];
}
