import { RetryConfig } from './state.types';

export class RetryExhaustedException extends Error {
  public readonly name = 'RetryExhaustedException';

  constructor(
    public readonly originalError: Error,
    public readonly attempts: number,
    public readonly retryConfig: RetryConfig
  ) {
    super(`Retry exhausted after ${attempts} attempts: ${originalError.message}`);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RetryExhaustedException);
    }

    this.stack = `${this.stack}\nCaused by: ${originalError.stack}`;
  }
}
