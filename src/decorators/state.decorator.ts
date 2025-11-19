import 'reflect-metadata';
import { StateMetadata, RetryConfig, StateConcurrencyConfig } from '../types';

export const STATE_METADATA_KEY = Symbol.for('flowmesh:state');
export const STATE_TIMEOUT_KEY = Symbol.for('flowmesh:state:timeout');
export const STATE_RETRY_KEY = Symbol.for('flowmesh:state:retry');
export const STATE_CONCURRENCY_KEY = Symbol.for('flowmesh:state:concurrency');

export function State<TState>(stateValue: TState | TState[]): ClassDecorator {
  return (target: any) => {
    const states = Array.isArray(stateValue) ? stateValue : [stateValue];
    const metadata: StateMetadata<TState> = {
      stateValue: states[0],
      stateName: String(states[0]),
      states,
    };

    Reflect.defineMetadata(STATE_METADATA_KEY, metadata, target);
    Reflect.defineMetadata(STATE_METADATA_KEY, metadata, target.prototype);
  };
}

export function Timeout(milliseconds: number): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(STATE_TIMEOUT_KEY, milliseconds, target);
    Reflect.defineMetadata(STATE_TIMEOUT_KEY, milliseconds, target.prototype);
  };
}

export function Retry(config: RetryConfig): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(STATE_RETRY_KEY, config, target);
    Reflect.defineMetadata(STATE_RETRY_KEY, config, target.prototype);
  };
}

export function UnlockAfter(): ClassDecorator {
  return (target: any) => {
    const config: StateConcurrencyConfig = { unlockAfter: true };
    Reflect.defineMetadata(STATE_CONCURRENCY_KEY, config, target);
    Reflect.defineMetadata(STATE_CONCURRENCY_KEY, config, target.prototype);
  };
}

export function getStateMetadata<TState = unknown>(target: any): StateMetadata<TState> | undefined {
  return Reflect.getMetadata(STATE_METADATA_KEY, target) || Reflect.getMetadata(STATE_METADATA_KEY, target.prototype);
}

export function getStateTimeout(target: any): number | undefined {
  return Reflect.getMetadata(STATE_TIMEOUT_KEY, target) || Reflect.getMetadata(STATE_TIMEOUT_KEY, target.prototype);
}

export function getStateRetry(target: any): RetryConfig | undefined {
  return Reflect.getMetadata(STATE_RETRY_KEY, target) || Reflect.getMetadata(STATE_RETRY_KEY, target.prototype);
}

export function getStateConcurrency(target: any): StateConcurrencyConfig | undefined {
  return Reflect.getMetadata(STATE_CONCURRENCY_KEY, target) || Reflect.getMetadata(STATE_CONCURRENCY_KEY, target.prototype);
}
