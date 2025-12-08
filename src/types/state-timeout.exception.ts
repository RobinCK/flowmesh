export class StateTimeoutException extends Error {
  constructor(
    public readonly stateName: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number
  ) {
    super(`State ${stateName} exceeded timeout of ${timeoutMs}ms (elapsed: ${elapsedMs}ms)`);
    this.name = 'StateTimeoutException';
    Object.setPrototypeOf(this, StateTimeoutException.prototype);
  }
}
