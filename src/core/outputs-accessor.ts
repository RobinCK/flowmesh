import { OutputsAccessor, ExtractOutput } from '../types';

export class OutputsAccessorImpl<TOutputs extends Record<string, unknown>> implements OutputsAccessor<TOutputs> {
  constructor(private outputs: Partial<TOutputs>) {}

  get<TState extends keyof TOutputs>(state: TState): ExtractOutput<TOutputs, TState> | undefined {
    return this.outputs[state] as ExtractOutput<TOutputs, TState> | undefined;
  }

  require<TState extends keyof TOutputs>(state: TState): ExtractOutput<TOutputs, TState> {
    const output = this.get(state);

    if (output === undefined || output === null) {
      throw new Error(`Missing required output for state: ${String(state)}`);
    }

    return output;
  }

  has<TState extends keyof TOutputs>(state: TState): boolean {
    return state in this.outputs && this.outputs[state] !== undefined;
  }

  getAll(): Partial<TOutputs> {
    return { ...this.outputs };
  }

  set<TState extends keyof TOutputs>(state: TState, output: ExtractOutput<TOutputs, TState>): void {
    this.outputs[state] = output;
  }
}

export function createOutputsAccessor<TOutputs extends Record<string, unknown>>(
  initialOutputs: Partial<TOutputs> = {}
): OutputsAccessor<TOutputs> {
  return new OutputsAccessorImpl(initialOutputs);
}
