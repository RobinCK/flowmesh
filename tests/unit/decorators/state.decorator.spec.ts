import {
  State,
  getStateMetadata,
  Timeout,
  getStateTimeout,
  Retry,
  getStateRetry,
  UnlockAfter,
  getStateConcurrency,
} from '../../../src/decorators/state.decorator';

enum TestState {
  A = 'A',
  B = 'B',
}

describe('State Decorators', () => {
  describe('@State', () => {
    it('should store state metadata', () => {
      @State(TestState.A)
      class TestStateA {}

      const metadata = getStateMetadata(TestStateA);
      expect(metadata).toBeDefined();
      expect(metadata?.stateValue).toBe(TestState.A);
      expect(metadata?.stateName).toBe('A');
    });

    it('should work with different state values', () => {
      @State(TestState.B)
      class TestStateB {}

      const metadata = getStateMetadata(TestStateB);
      expect(metadata?.stateValue).toBe(TestState.B);
    });

    it('should return undefined for non-decorated class', () => {
      class PlainClass {}

      const metadata = getStateMetadata(PlainClass);
      expect(metadata).toBeUndefined();
    });
  });

  describe('@Timeout', () => {
    it('should store timeout value', () => {
      @State(TestState.A)
      @Timeout(5000)
      class TestStateA {}

      const timeout = getStateTimeout(TestStateA);
      expect(timeout).toBe(5000);
    });

    it('should return undefined if not set', () => {
      @State(TestState.A)
      class TestStateA {}

      const timeout = getStateTimeout(TestStateA);
      expect(timeout).toBeUndefined();
    });

    it('should work with zero timeout', () => {
      @State(TestState.A)
      @Timeout(0)
      class TestStateA {}

      const timeout = getStateTimeout(TestStateA);
      expect(timeout).toBe(0);
    });
  });

  describe('@Retry', () => {
    it('should store retry config with all options', () => {
      @State(TestState.A)
      @Retry({
        maxAttempts: 3,
        strategy: 'exponential',
        initialDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
      })
      class TestStateA {}

      const retry = getStateRetry(TestStateA);
      expect(retry).toEqual({
        maxAttempts: 3,
        strategy: 'exponential',
        initialDelay: 1000,
        maxDelay: 10000,
        multiplier: 2,
      });
    });

    it('should store minimal retry config', () => {
      @State(TestState.A)
      @Retry({ maxAttempts: 5 })
      class TestStateA {}

      const retry = getStateRetry(TestStateA);
      expect(retry?.maxAttempts).toBe(5);
    });

    it('should return undefined if not set', () => {
      @State(TestState.A)
      class TestStateA {}

      const retry = getStateRetry(TestStateA);
      expect(retry).toBeUndefined();
    });

    it('should work with different strategies', () => {
      @State(TestState.A)
      @Retry({ maxAttempts: 3, strategy: 'fixed' })
      class FixedRetry {}

      @State(TestState.B)
      @Retry({ maxAttempts: 3, strategy: 'linear' })
      class LinearRetry {}

      expect(getStateRetry(FixedRetry)?.strategy).toBe('fixed');
      expect(getStateRetry(LinearRetry)?.strategy).toBe('linear');
    });
  });

  describe('@UnlockAfter', () => {
    it('should store unlockAfter flag', () => {
      @State(TestState.A)
      @UnlockAfter()
      class TestStateA {}

      const concurrency = getStateConcurrency(TestStateA);
      expect(concurrency).toEqual({ unlockAfter: true });
    });

    it('should return undefined if not set', () => {
      @State(TestState.A)
      class TestStateA {}

      const concurrency = getStateConcurrency(TestStateA);
      expect(concurrency).toBeUndefined();
    });
  });

  describe('Multiple decorators', () => {
    it('should combine multiple decorators', () => {
      @State(TestState.A)
      @Timeout(3000)
      @Retry({ maxAttempts: 5 })
      @UnlockAfter()
      class MultiDecorated {}

      expect(getStateMetadata(MultiDecorated)?.stateValue).toBe(TestState.A);
      expect(getStateTimeout(MultiDecorated)).toBe(3000);
      expect(getStateRetry(MultiDecorated)?.maxAttempts).toBe(5);
      expect(getStateConcurrency(MultiDecorated)?.unlockAfter).toBe(true);
    });
  });

  describe('@State with array', () => {
    it('should store metadata for multiple states', () => {
      @State([TestState.A, TestState.B])
      class SharedState {}

      const metadata = getStateMetadata(SharedState);
      expect(metadata).toBeDefined();
      expect(metadata?.states).toEqual([TestState.A, TestState.B]);
      expect(metadata?.stateValue).toBe(TestState.A); // First state for backward compatibility
      expect(metadata?.stateName).toBe('A');
    });

    it('should work with single state in array', () => {
      @State([TestState.A])
      class SingleStateInArray {}

      const metadata = getStateMetadata(SingleStateInArray);
      expect(metadata?.states).toEqual([TestState.A]);
      expect(metadata?.stateValue).toBe(TestState.A);
    });

    it('should maintain backward compatibility with single state', () => {
      @State(TestState.A)
      class OldStyle {}

      const metadata = getStateMetadata(OldStyle);
      expect(metadata?.states).toEqual([TestState.A]);
      expect(metadata?.stateValue).toBe(TestState.A);
    });

    it('should work with three or more states', () => {
      enum MultiState {
        ONE = 'ONE',
        TWO = 'TWO',
        THREE = 'THREE',
      }

      @State([MultiState.ONE, MultiState.TWO, MultiState.THREE])
      class TripleState {}

      const metadata = getStateMetadata(TripleState);
      expect(metadata?.states).toEqual([MultiState.ONE, MultiState.TWO, MultiState.THREE]);
      expect(metadata?.stateValue).toBe(MultiState.ONE);
    });
  });
});
