import 'reflect-metadata';
import {
  Transition,
  ConditionalTransition,
  getTransitions,
  getConditionalTransitions,
  TRANSITION_METADATA_KEY,
  CONDITIONAL_TRANSITION_METADATA_KEY,
  TransitionMetadata,
  ConditionalTransitionMetadata,
} from '../../../src/decorators/transition.decorator';

enum TestState {
  START = 'START',
  MIDDLE = 'MIDDLE',
  END = 'END',
}

describe('Transition Decorators', () => {
  describe('@Transition decorator', () => {
    it('should store transition metadata with single from state', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        canTransition() {
          return true;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].from).toEqual([TestState.START]);
      expect(transitions[0].to).toBe(TestState.MIDDLE);
      expect(transitions[0].propertyKey).toBe('canTransition');
      expect(transitions[0].condition).toBeDefined();
    });

    it('should store transition metadata with array of from states', () => {
      class TestWorkflow {
        @Transition({ from: [TestState.START, TestState.MIDDLE], to: TestState.END })
        canTransitionToEnd() {
          return true;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].from).toEqual([TestState.START, TestState.MIDDLE]);
      expect(transitions[0].to).toBe(TestState.END);
    });

    it('should store multiple transitions on same class', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        firstTransition() {
          return true;
        }

        @Transition({ from: TestState.MIDDLE, to: TestState.END })
        secondTransition() {
          return false;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(2);
      expect(transitions[0].propertyKey).toBe('firstTransition');
      expect(transitions[1].propertyKey).toBe('secondTransition');
    });

    it('should preserve method descriptor', () => {
      const testMethod = function () {
        return 'test';
      };

      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        testMethod() {
          return 'test';
        }
      }

      const instance = new TestWorkflow();
      expect(instance.testMethod()).toBe('test');
    });

    it('should store condition function from descriptor', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        customCondition(ctx: any) {
          return ctx.value > 10;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);
      const condition = transitions[0].condition;

      expect(condition).toBeDefined();
      expect(typeof condition).toBe('function');
      // Test the actual condition function
      expect(condition!({ value: 15 })).toBe(true);
      expect(condition!({ value: 5 })).toBe(false);
    });

    it('should use Reflect metadata API correctly', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        testTransition() {
          return true;
        }
      }

      const metadata = Reflect.getMetadata(TRANSITION_METADATA_KEY, TestWorkflow);

      expect(metadata).toBeDefined();
      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata).toHaveLength(1);
    });
  });

  describe('@ConditionalTransition decorator', () => {
    it('should store conditional transition metadata', () => {
      class TestWorkflow {
        @ConditionalTransition({ from: TestState.START })
        getNextState() {
          return TestState.MIDDLE;
        }
      }

      const transitions = getConditionalTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].from).toBe(TestState.START);
      expect(transitions[0].propertyKey).toBe('getNextState');
    });

    it('should store multiple conditional transitions', () => {
      class TestWorkflow {
        @ConditionalTransition({ from: TestState.START })
        fromStart() {
          return TestState.MIDDLE;
        }

        @ConditionalTransition({ from: TestState.MIDDLE })
        fromMiddle() {
          return TestState.END;
        }
      }

      const transitions = getConditionalTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(2);
      expect(transitions[0].from).toBe(TestState.START);
      expect(transitions[0].propertyKey).toBe('fromStart');
      expect(transitions[1].from).toBe(TestState.MIDDLE);
      expect(transitions[1].propertyKey).toBe('fromMiddle');
    });

    it('should preserve method descriptor', () => {
      class TestWorkflow {
        @ConditionalTransition({ from: TestState.START })
        getNextState(ctx: any) {
          return ctx.approved ? TestState.END : TestState.MIDDLE;
        }
      }

      const instance = new TestWorkflow();
      expect(instance.getNextState({ approved: true })).toBe(TestState.END);
      expect(instance.getNextState({ approved: false })).toBe(TestState.MIDDLE);
    });

    it('should use Reflect metadata API correctly', () => {
      class TestWorkflow {
        @ConditionalTransition({ from: TestState.START })
        testConditional() {
          return TestState.MIDDLE;
        }
      }

      const metadata = Reflect.getMetadata(CONDITIONAL_TRANSITION_METADATA_KEY, TestWorkflow);

      expect(metadata).toBeDefined();
      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata).toHaveLength(1);
    });
  });

  describe('getTransitions helper', () => {
    it('should return empty array when no transitions defined', () => {
      class EmptyWorkflow {}

      const transitions = getTransitions(EmptyWorkflow);

      expect(transitions).toEqual([]);
    });

    it('should return all transitions for a class', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        first() {}

        @Transition({ from: TestState.MIDDLE, to: TestState.END })
        second() {}
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(2);
    });
  });

  describe('getConditionalTransitions helper', () => {
    it('should return empty array when no conditional transitions defined', () => {
      class EmptyWorkflow {}

      const transitions = getConditionalTransitions(EmptyWorkflow);

      expect(transitions).toEqual([]);
    });

    it('should return all conditional transitions for a class', () => {
      class TestWorkflow {
        @ConditionalTransition({ from: TestState.START })
        first() {}

        @ConditionalTransition({ from: TestState.MIDDLE })
        second() {}
      }

      const transitions = getConditionalTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(2);
    });
  });

  describe('combined usage', () => {
    it('should support both transition types on same class', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        staticTransition() {
          return true;
        }

        @ConditionalTransition({ from: TestState.MIDDLE })
        dynamicTransition() {
          return TestState.END;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);
      const conditionalTransitions = getConditionalTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(1);
      expect(conditionalTransitions).toHaveLength(1);
    });

    it('should not interfere between different metadata keys', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        normalTransition() {}

        @ConditionalTransition({ from: TestState.START })
        conditionalTransition() {}
      }

      const normalMeta = Reflect.getMetadata(TRANSITION_METADATA_KEY, TestWorkflow);
      const conditionalMeta = Reflect.getMetadata(CONDITIONAL_TRANSITION_METADATA_KEY, TestWorkflow);

      expect(normalMeta).toHaveLength(1);
      expect(conditionalMeta).toHaveLength(1);
      expect(normalMeta[0].propertyKey).toBe('normalTransition');
      expect(conditionalMeta[0].propertyKey).toBe('conditionalTransition');
    });
  });

  describe('edge cases', () => {
    it('should handle symbol property keys', () => {
      const symbolKey = Symbol('testMethod');

      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        [symbolKey]() {
          return true;
        }
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].propertyKey).toBe(symbolKey);
    });

    it('should handle multiple classes independently', () => {
      class Workflow1 {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        transition1() {}
      }

      class Workflow2 {
        @Transition({ from: TestState.MIDDLE, to: TestState.END })
        transition2() {}
      }

      const transitions1 = getTransitions<TestState>(Workflow1);
      const transitions2 = getTransitions<TestState>(Workflow2);

      expect(transitions1).toHaveLength(1);
      expect(transitions2).toHaveLength(1);
      expect(transitions1[0].propertyKey).toBe('transition1');
      expect(transitions2[0].propertyKey).toBe('transition2');
    });

    it('should accumulate transitions in order they are defined', () => {
      class TestWorkflow {
        @Transition({ from: TestState.START, to: TestState.MIDDLE })
        first() {}

        @Transition({ from: TestState.MIDDLE, to: TestState.END })
        second() {}

        @Transition({ from: [TestState.START, TestState.MIDDLE], to: TestState.END })
        third() {}
      }

      const transitions = getTransitions<TestState>(TestWorkflow);

      expect(transitions).toHaveLength(3);
      expect(transitions[0].propertyKey).toBe('first');
      expect(transitions[1].propertyKey).toBe('second');
      expect(transitions[2].propertyKey).toBe('third');
    });
  });
});
