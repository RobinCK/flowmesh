import { StateRegistry } from '../../../src/core/state-registry';
import { State } from '../../../src/decorators/state.decorator';
import { IState, WorkflowContext, StateActions } from '../../../src/types';

enum TestState {
  A = 'A',
  B = 'B',
}

@State(TestState.A)
class TestStateA implements IState {
  execute() {}
}

@State(TestState.B)
class TestStateB implements IState {
  execute() {}
}

describe('StateRegistry', () => {
  beforeEach(() => {
    StateRegistry.clear();
  });

  describe('register and get', () => {
    it('should register state class by enum value', () => {
      StateRegistry.register(TestState.A, TestStateA);

      const retrieved = StateRegistry.get(TestState.A);
      expect(retrieved).toBe(TestStateA);
    });

    it('should register state instance by enum value', () => {
      const instance = new TestStateA();
      StateRegistry.register(TestState.A, instance);

      const retrieved = StateRegistry.get(TestState.A);
      expect(retrieved).toBe(instance);
    });

    it('should return undefined for unregistered state', () => {
      const retrieved = StateRegistry.get(TestState.B);
      expect(retrieved).toBeUndefined();
    });

    it('should override existing registration', () => {
      StateRegistry.register(TestState.A, TestStateA);
      StateRegistry.register(TestState.A, TestStateB);

      const retrieved = StateRegistry.get(TestState.A);
      expect(retrieved).toBe(TestStateB);
    });
  });

  describe('has', () => {
    it('should return true for registered state', () => {
      StateRegistry.register(TestState.A, TestStateA);
      expect(StateRegistry.has(TestState.A)).toBe(true);
    });

    it('should return false for unregistered state', () => {
      expect(StateRegistry.has(TestState.B)).toBe(false);
    });
  });

  describe('getInstance', () => {
    it('should return instance if registered as instance', () => {
      const instance = new TestStateA();
      StateRegistry.register(TestState.A, instance);

      const retrieved = StateRegistry.getInstance(TestState.A);
      expect(retrieved).toBe(instance);
    });

    it('should return undefined if registered as class', () => {
      StateRegistry.register(TestState.A, TestStateA);

      const retrieved = StateRegistry.getInstance(TestState.A);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('isInstance', () => {
    it('should return true for instance', () => {
      const instance = new TestStateA();
      expect(StateRegistry.isInstance(instance)).toBe(true);
    });

    it('should return false for class', () => {
      expect(StateRegistry.isInstance(TestStateA)).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all registered states', () => {
      StateRegistry.register(TestState.A, TestStateA);
      StateRegistry.register(TestState.B, TestStateB);

      const all = StateRegistry.getAll();
      expect(all.size).toBe(2);
      expect(all.get(TestState.A)).toBe(TestStateA);
      expect(all.get(TestState.B)).toBe(TestStateB);
    });

    it('should return empty map when no states registered', () => {
      const all = StateRegistry.getAll();
      expect(all.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all registered states', () => {
      StateRegistry.register(TestState.A, TestStateA);
      StateRegistry.register(TestState.B, TestStateB);

      StateRegistry.clear();

      expect(StateRegistry.has(TestState.A)).toBe(false);
      expect(StateRegistry.has(TestState.B)).toBe(false);
      expect(StateRegistry.getAll().size).toBe(0);
    });
  });

  describe('autoRegister', () => {
    it('should auto-register instances with @State metadata', () => {
      const instanceA = new TestStateA();
      const instanceB = new TestStateB();

      StateRegistry.autoRegister([instanceA, instanceB]);

      expect(StateRegistry.has(TestState.A)).toBe(true);
      expect(StateRegistry.has(TestState.B)).toBe(true);
      expect(StateRegistry.get(TestState.A)).toBe(instanceA);
      expect(StateRegistry.get(TestState.B)).toBe(instanceB);
    });

    it('should skip instances without @State metadata', () => {
      class PlainClass {
        execute() {}
      }
      const plain = new PlainClass();

      StateRegistry.autoRegister([plain]);

      expect(StateRegistry.getAll().size).toBe(0);
    });

    it('should handle empty array', () => {
      StateRegistry.autoRegister([]);
      expect(StateRegistry.getAll().size).toBe(0);
    });
  });

  describe('discoverStates', () => {
    it('should discover states for specific enum', () => {
      StateRegistry.register(TestState.A, TestStateA);
      StateRegistry.register(TestState.B, TestStateB);

      const discovered = StateRegistry.discoverStates(TestState);

      expect(discovered.size).toBe(2);
      expect(discovered.get(TestState.A)).toBe(TestStateA);
      expect(discovered.get(TestState.B)).toBe(TestStateB);
    });

    it('should filter only relevant enum values', () => {
      enum OtherState {
        X = 'X',
        Y = 'Y',
      }

      StateRegistry.register(TestState.A, TestStateA);
      StateRegistry.register('X' as any, TestStateB);

      const discovered = StateRegistry.discoverStates(TestState);

      expect(discovered.size).toBe(1);
      expect(discovered.get(TestState.A)).toBe(TestStateA);
    });

    it('should return empty map for enum with no registered states', () => {
      enum EmptyEnum {
        Z = 'Z',
      }

      const discovered = StateRegistry.discoverStates(EmptyEnum);
      expect(discovered.size).toBe(0);
    });
  });

  describe('autoRegister with array of states', () => {
    it('should register one instance for multiple states', () => {
      @State([TestState.A, TestState.B])
      class SharedState {
        execute() {}
      }

      const instance = new SharedState();
      StateRegistry.autoRegister([instance]);

      expect(StateRegistry.has(TestState.A)).toBe(true);
      expect(StateRegistry.has(TestState.B)).toBe(true);
      expect(StateRegistry.get(TestState.A)).toBe(instance);
      expect(StateRegistry.get(TestState.B)).toBe(instance);
    });

    it('should handle mix of single and multiple state decorators', () => {
      @State(TestState.A)
      class SingleState {
        execute() {}
      }

      @State([TestState.B, 'C' as any])
      class MultiState {
        execute() {}
      }

      const single = new SingleState();
      const multi = new MultiState();

      StateRegistry.autoRegister([single, multi]);

      expect(StateRegistry.get(TestState.A)).toBe(single);
      expect(StateRegistry.get(TestState.B)).toBe(multi);
      expect(StateRegistry.get('C')).toBe(multi);
    });

    it('should overwrite previous registration when same state registered again', () => {
      @State([TestState.A])
      class FirstImpl {
        execute() {}
      }

      @State([TestState.A])
      class SecondImpl {
        execute() {}
      }

      const first = new FirstImpl();
      const second = new SecondImpl();

      StateRegistry.autoRegister([first]);
      expect(StateRegistry.get(TestState.A)).toBe(first);

      StateRegistry.autoRegister([second]);
      expect(StateRegistry.get(TestState.A)).toBe(second);
    });
  });
});
