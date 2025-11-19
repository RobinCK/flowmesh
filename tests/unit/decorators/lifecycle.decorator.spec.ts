import {
  OnWorkflowStart,
  OnWorkflowComplete,
  OnWorkflowError,
  BeforeState,
  AfterState,
  OnStateStart,
  OnStateSuccess,
  OnStateFailure,
  OnStateFinish,
  getWorkflowOnStart,
  getWorkflowOnComplete,
  getWorkflowOnError,
  getWorkflowBeforeState,
  getWorkflowAfterState,
  getStateOnStart,
  getStateOnSuccess,
  getStateOnFailure,
  getStateOnFinish,
} from '../../../src/decorators/lifecycle.decorator';

describe('Lifecycle Decorators', () => {
  describe('Workflow Lifecycle', () => {
    it('@OnWorkflowStart should store method name', () => {
      class TestWorkflow {
        @OnWorkflowStart()
        onStart() {}
      }

      const methodName = getWorkflowOnStart(TestWorkflow);
      expect(methodName).toBe('onStart');
    });

    it('@OnWorkflowComplete should store method name', () => {
      class TestWorkflow {
        @OnWorkflowComplete()
        onComplete() {}
      }

      const methodName = getWorkflowOnComplete(TestWorkflow);
      expect(methodName).toBe('onComplete');
    });

    it('@OnWorkflowError should store method name', () => {
      class TestWorkflow {
        @OnWorkflowError()
        onError() {}
      }

      const methodName = getWorkflowOnError(TestWorkflow);
      expect(methodName).toBe('onError');
    });

    it('@BeforeState should store method name', () => {
      class TestWorkflow {
        @BeforeState()
        beforeState() {}
      }

      const methodName = getWorkflowBeforeState(TestWorkflow);
      expect(methodName).toBe('beforeState');
    });

    it('@AfterState should store method name', () => {
      class TestWorkflow {
        @AfterState()
        afterState() {}
      }

      const methodName = getWorkflowAfterState(TestWorkflow);
      expect(methodName).toBe('afterState');
    });

    it('should return undefined for non-decorated class', () => {
      class PlainWorkflow {}

      expect(getWorkflowOnStart(PlainWorkflow)).toBeUndefined();
      expect(getWorkflowOnComplete(PlainWorkflow)).toBeUndefined();
      expect(getWorkflowOnError(PlainWorkflow)).toBeUndefined();
    });

    it('should support multiple lifecycle hooks', () => {
      class TestWorkflow {
        @OnWorkflowStart()
        onStart() {}

        @OnWorkflowComplete()
        onComplete() {}

        @BeforeState()
        beforeState() {}

        @AfterState()
        afterState() {}
      }

      expect(getWorkflowOnStart(TestWorkflow)).toBe('onStart');
      expect(getWorkflowOnComplete(TestWorkflow)).toBe('onComplete');
      expect(getWorkflowBeforeState(TestWorkflow)).toBe('beforeState');
      expect(getWorkflowAfterState(TestWorkflow)).toBe('afterState');
    });
  });

  describe('State Lifecycle', () => {
    it('@OnStateStart should store method name', () => {
      class TestState {
        @OnStateStart()
        onStart() {}
      }

      const methodName = getStateOnStart(TestState);
      expect(methodName).toBe('onStart');
    });

    it('@OnStateSuccess should store method name', () => {
      class TestState {
        @OnStateSuccess()
        onSuccess() {}
      }

      const methodName = getStateOnSuccess(TestState);
      expect(methodName).toBe('onSuccess');
    });

    it('@OnStateFailure should store method name', () => {
      class TestState {
        @OnStateFailure()
        onFailure() {}
      }

      const methodName = getStateOnFailure(TestState);
      expect(methodName).toBe('onFailure');
    });

    it('@OnStateFinish should store method name', () => {
      class TestState {
        @OnStateFinish()
        onFinish() {}
      }

      const methodName = getStateOnFinish(TestState);
      expect(methodName).toBe('onFinish');
    });

    it('should return undefined for non-decorated class', () => {
      class PlainState {}

      expect(getStateOnStart(PlainState)).toBeUndefined();
      expect(getStateOnSuccess(PlainState)).toBeUndefined();
      expect(getStateOnFailure(PlainState)).toBeUndefined();
      expect(getStateOnFinish(PlainState)).toBeUndefined();
    });

    it('should support multiple lifecycle hooks', () => {
      class TestState {
        @OnStateStart()
        onStart() {}

        @OnStateSuccess()
        onSuccess() {}

        @OnStateFailure()
        onFailure() {}

        @OnStateFinish()
        onFinish() {}
      }

      expect(getStateOnStart(TestState)).toBe('onStart');
      expect(getStateOnSuccess(TestState)).toBe('onSuccess');
      expect(getStateOnFailure(TestState)).toBe('onFailure');
      expect(getStateOnFinish(TestState)).toBe('onFinish');
    });
  });
});
