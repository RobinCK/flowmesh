import { IState } from '../types';
import { getStateMetadata } from '../decorators';

type StateClassOrInstance = (new (...args: any[]) => IState) | IState;

export class StateRegistry {
  private static states: Map<unknown, StateClassOrInstance> = new Map();
  private static instances: Map<unknown, IState> = new Map();

  static register(stateValue: unknown, stateClassOrInstance: StateClassOrInstance): void {
    this.states.set(stateValue, stateClassOrInstance);

    if (this.isInstance(stateClassOrInstance)) {
      this.instances.set(stateValue, stateClassOrInstance);
    }
  }

  static get(stateValue: unknown): StateClassOrInstance | undefined {
    return this.states.get(stateValue);
  }

  static getInstance(stateValue: unknown): IState | undefined {
    return this.instances.get(stateValue);
  }

  static has(stateValue: unknown): boolean {
    return this.states.has(stateValue);
  }

  static clear(): void {
    this.states.clear();
    this.instances.clear();
  }

  static getAll(): Map<unknown, StateClassOrInstance> {
    return new Map(this.states);
  }

  static isInstance(value: StateClassOrInstance): value is IState {
    return value != null && typeof (value as IState).execute === 'function';
  }

  static autoRegister(stateInstances: any[]): void {
    for (const instance of stateInstances) {
      const constructor = instance.constructor || instance;
      const metadata = getStateMetadata(constructor);

      if (metadata) {
        for (const state of metadata.states) {
          this.register(state, instance);
        }
      }
    }
  }

  static discoverStates(stateEnum: Record<string, unknown>): Map<unknown, StateClassOrInstance> {
    const enumValues = Object.values(stateEnum);
    const scopedStates = new Map<unknown, StateClassOrInstance>();

    for (const [stateValue, stateClassOrInstance] of this.states.entries()) {
      if (enumValues.includes(stateValue)) {
        scopedStates.set(stateValue, stateClassOrInstance);
      }
    }

    return scopedStates;
  }
}
