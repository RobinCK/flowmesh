import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import {
  WorkflowContext,
  StateActions,
  IState,
  ErrorHandler,
  ErrorContext,
  ErrorHandlingDecision,
  TransitionToDecision,
} from '../../../src/types';

enum TestState {
  START = 'START',
  PROCESSING = 'PROCESSING',
  ERROR_RECOVERY = 'ERROR_RECOVERY',
  COMPLETED = 'COMPLETED',
}

interface TestData extends Record<string, unknown> {
  value: number;
  shouldFail?: boolean;
  shouldTransition?: boolean;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.START]: { started: boolean };
  [TestState.PROCESSING]: { processed: boolean };
  [TestState.ERROR_RECOVERY]: { recovered: boolean; reason?: string };
  [TestState.COMPLETED]: { completed: boolean };
}

class TransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitionError';
  }
}

class TransitionToErrorHandler implements ErrorHandler<TestData, TestOutputs> {
  handle(context: ErrorContext<TestData, TestOutputs>): TransitionToDecision | ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    if (error instanceof TransitionError && phase === 'state_execute') {
      return {
        decision: ErrorHandlingDecision.TRANSITION_TO,
        targetState: TestState.ERROR_RECOVERY,
        output: {
          recovered: false,
          reason: error.message,
        },
      };
    }

    return ErrorHandlingDecision.FAIL;
  }
}

class TransitionToWithOutputHandler implements ErrorHandler<TestData, TestOutputs> {
  handle(context: ErrorContext<TestData, TestOutputs>): TransitionToDecision | ErrorHandlingDecision {
    const { error, phase } = context;

    if (error instanceof TransitionError && phase === 'state_execute') {
      return {
        decision: ErrorHandlingDecision.TRANSITION_TO,
        targetState: TestState.ERROR_RECOVERY,
        output: {
          recovered: true,
          reason: 'Custom error output',
        },
      };
    }

    return ErrorHandlingDecision.FAIL;
  }
}

@Workflow({
  name: 'TransitionToWorkflow',
  states: TestState,
  initialState: TestState.START,
  errorHandler: new TransitionToErrorHandler() as any,
})
class TransitionToWorkflow {}

@Workflow({
  name: 'TransitionToWithOutputWorkflow',
  states: TestState,
  initialState: TestState.START,
  errorHandler: new TransitionToWithOutputHandler() as any,
})
class TransitionToWithOutputWorkflow {}

@Workflow({
  name: 'TransitionToExplicitWorkflow',
  states: TestState,
  initialState: TestState.START,
  transitions: [
    { from: [TestState.START], to: TestState.PROCESSING },
    { from: [TestState.PROCESSING], to: TestState.COMPLETED },
    { from: [TestState.ERROR_RECOVERY], to: TestState.COMPLETED },
  ],
  errorHandler: new TransitionToErrorHandler() as any,
})
class TransitionToExplicitWorkflow {}

@State(TestState.START)
class StartState implements IState<TestData, TestOutputs, TestState.START> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.START>) {
    actions.next({ output: { started: true } });
  }
}

@State(TestState.PROCESSING)
class ProcessingState implements IState<TestData, TestOutputs, TestState.PROCESSING> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.PROCESSING>) {
    if (ctx.data.shouldFail) {
      throw new TransitionError('Processing failed, transitioning to recovery');
    }

    actions.next({ output: { processed: true } });
  }
}

@State(TestState.ERROR_RECOVERY)
class ErrorRecoveryState implements IState<TestData, TestOutputs, TestState.ERROR_RECOVERY> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.ERROR_RECOVERY>) {
    actions.next({ output: { recovered: true } });
  }
}

@State(TestState.COMPLETED)
class CompletedState implements IState<TestData, TestOutputs, TestState.COMPLETED> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.COMPLETED>) {
    actions.next({ output: { completed: true } });
  }
}

describe('Error Handler: TRANSITION_TO Decision', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    engine = new WorkflowEngine({ persistence });

    StateRegistry.autoRegister([new StartState(), new ProcessingState(), new ErrorRecoveryState(), new CompletedState()]);
  });

  describe('Basic TRANSITION_TO functionality', () => {
    it('should transition to ERROR_RECOVERY state when error occurs', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.COMPLETED);

      expect(result.outputs[TestState.START]).toEqual({ started: true });
      expect(result.outputs[TestState.PROCESSING]).toEqual({
        recovered: false,
        reason: 'Processing failed, transitioning to recovery',
      });
      expect(result.outputs[TestState.ERROR_RECOVERY]).toEqual({ recovered: true });
      expect(result.outputs[TestState.COMPLETED]).toEqual({ completed: true });
    });

    it('should not transition when no error occurs', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: false },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.COMPLETED);

      expect(result.outputs[TestState.START]).toEqual({ started: true });
      expect(result.outputs[TestState.PROCESSING]).toEqual({ processed: true });
      // Automatic transitions go through ERROR_RECOVERY state
      expect(result.outputs[TestState.ERROR_RECOVERY]).toEqual({ recovered: true });
    });
  });

  describe('TRANSITION_TO with custom output', () => {
    it('should set custom output when transitioning', async () => {
      const result = await engine.execute(TransitionToWithOutputWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      expect(result.status).toBe('completed');

      expect(result.outputs[TestState.PROCESSING]).toEqual({
        recovered: true,
        reason: 'Custom error output',
      });
    });
  });

  describe('History tracking', () => {
    it('should record error_recovery status in history', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      expect(result.history.length).toBeGreaterThan(0);

      const processingTransition = result.history.find(h => h.from === TestState.PROCESSING && h.to === TestState.PROCESSING);

      expect(processingTransition).toBeDefined();
      expect(processingTransition?.status).toBe('error_recovery');
    });

    it('should record transition from failed state to recovery state', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      const recoveryTransition = result.history.find(h => h.from === TestState.PROCESSING && h.to === TestState.ERROR_RECOVERY);

      expect(recoveryTransition).toBeDefined();
      expect(recoveryTransition?.status).toBe('success');
    });

    it('should track complete workflow path including recovery', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      const path = result.history.map(h => `${String(h.from)}->${String(h.to)}`);

      expect(path).toContain(`${TestState.START}->${TestState.PROCESSING}`);
      expect(path).toContain(`${TestState.PROCESSING}->${TestState.ERROR_RECOVERY}`);
      expect(path).toContain(`${TestState.ERROR_RECOVERY}->${TestState.COMPLETED}`);
    });
  });

  describe('Transition validation', () => {
    it('should validate transitions with explicit transitions config', async () => {
      const result = await engine.execute(TransitionToExplicitWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      expect(result.status).toBe('completed');
      expect(result.currentState).toBe(TestState.COMPLETED);
    });
  });

  describe('Backward compatibility', () => {
    class OldStyleErrorHandler implements ErrorHandler<TestData, TestOutputs> {
      handle(context: ErrorContext<TestData, TestOutputs>): ErrorHandlingDecision {
        return ErrorHandlingDecision.FAIL;
      }
    }

    @Workflow({
      name: 'OldStyleWorkflow',
      states: TestState,
      initialState: TestState.START,
      errorHandler: new OldStyleErrorHandler() as any,
    })
    class OldStyleWorkflow {}

    it('should work with old-style error handlers returning ErrorHandlingDecision enum', async () => {
      await expect(
        engine.execute(OldStyleWorkflow, {
          data: { value: 100, shouldFail: true },
        })
      ).rejects.toThrow('Processing failed');
    });
  });

  describe('Persistence', () => {
    it('should persist workflow state after error recovery transition', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      const persisted = await persistence.load(result.id);

      expect(persisted).toBeDefined();
      expect(persisted?.currentState).toBe(TestState.COMPLETED);
      expect(persisted?.outputs[TestState.ERROR_RECOVERY]).toEqual({ recovered: true });
    });

    it('should update execution metadata after transition', async () => {
      const result = await engine.execute(TransitionToWorkflow, {
        data: { value: 100, shouldFail: true },
      });

      expect(result.metadata.updatedAt).toBeDefined();
      expect(result.metadata.updatedAt.getTime()).toBeGreaterThanOrEqual(result.metadata.startedAt.getTime());
    });
  });
});
