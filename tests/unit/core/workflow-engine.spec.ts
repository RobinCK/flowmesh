import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

enum TestState {
  A = 'A',
  B = 'B',
}

interface TestData extends Record<string, unknown> {
  value: number;
}

interface TestOutputs extends Record<string, unknown> {
  [TestState.A]: { resultA: string };
  [TestState.B]: { resultB: string };
}

@Workflow({
  name: 'TestWorkflow',
  states: TestState,
  initialState: TestState.A,
})
class TestWorkflow {}

@State(TestState.A)
class StateA implements IState<TestData, TestOutputs, TestState.A> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.A>) {
    actions.next({ output: { resultA: 'A_' + ctx.data.value } });
  }
}

@State(TestState.B)
class StateB implements IState<TestData, TestOutputs, TestState.B> {
  execute(ctx: WorkflowContext<TestData, TestOutputs>, actions: StateActions<TestData, TestOutputs, TestState.B>) {
    actions.next({ output: { resultB: 'B_' + ctx.data.value } });
  }
}

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([new StateA(), new StateB()]);
  });

  describe('registerWorkflow', () => {
    it('should register workflow with metadata', () => {
      engine.registerWorkflow(TestWorkflow);

      const registered = engine.getRegisteredWorkflows();
      expect(registered).toContain('TestWorkflow');
    });

    it('should throw error if class not decorated with @Workflow', () => {
      class PlainClass {}

      expect(() => engine.registerWorkflow(PlainClass)).toThrow('is not decorated with @Workflow');
    });
  });

  describe('execute', () => {
    it('should execute workflow and return result', async () => {
      const result = await engine.execute(TestWorkflow, {
        data: { value: 123 },
      });

      expect(result.status).toBe('completed');
      expect(result.workflowName).toBe('TestWorkflow');
    });

    it('should auto-register workflow if not registered', async () => {
      // Don't manually register
      const result = await engine.execute(TestWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(engine.getRegisteredWorkflows()).toContain('TestWorkflow');
    });

    it('should return execution with correct data', async () => {
      const result = await engine.execute(TestWorkflow, {
        data: { value: 42 },
      });

      expect(result.data.value).toBe(42);
    });

    it('should generate unique execution ID', async () => {
      const result1 = await engine.execute(TestWorkflow, { data: { value: 1 } });
      const result2 = await engine.execute(TestWorkflow, { data: { value: 2 } });

      expect(result1.id).not.toBe(result2.id);
    });
  });

  describe('resume', () => {
    it('should throw error if workflow not registered', async () => {
      await expect(engine.resume(TestWorkflow, 'exec-123')).rejects.toThrow('is not registered');
    });

    it('should throw error if persistence not configured', async () => {
      const engineNoPersistence = new WorkflowEngine({});
      engineNoPersistence.registerWorkflow(TestWorkflow);

      await expect(engineNoPersistence.resume(TestWorkflow, 'exec-123')).rejects.toThrow('Persistence adapter is required');
    });
  });

  describe('getExecution', () => {
    it('should return execution by ID', async () => {
      const result = await engine.execute(TestWorkflow, { data: { value: 1 } });

      const loaded = await engine.getExecution(result.id);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(result.id);
    });

    it('should return null for non-existent ID', async () => {
      const loaded = await engine.getExecution('non-existent');

      expect(loaded).toBeNull();
    });

    it('should return null if no persistence configured', async () => {
      const engineNoPersistence = new WorkflowEngine({});

      const loaded = await engineNoPersistence.getExecution('any-id');

      expect(loaded).toBeNull();
    });
  });

  describe('findExecutions', () => {
    it('should find executions by workflow name', async () => {
      await engine.execute(TestWorkflow, { data: { value: 1 } });
      await engine.execute(TestWorkflow, { data: { value: 2 } });

      const found = await engine.findExecutions({ workflowName: 'TestWorkflow' });

      expect(found).toHaveLength(2);
    });

    it('should return empty array if no matches', async () => {
      const found = await engine.findExecutions({ workflowName: 'NonExistent' });

      expect(found).toEqual([]);
    });

    it('should return empty array if no persistence configured', async () => {
      const engineNoPersistence = new WorkflowEngine({});

      const found = await engineNoPersistence.findExecutions({ workflowName: 'Any' });

      expect(found).toEqual([]);
    });
  });

  describe('getRegisteredWorkflows', () => {
    it('should return list of registered workflow names', () => {
      engine.registerWorkflow(TestWorkflow);

      const registered = engine.getRegisteredWorkflows();

      expect(registered).toEqual(['TestWorkflow']);
    });

    it('should return empty array if no workflows registered', () => {
      const registered = engine.getRegisteredWorkflows();

      expect(registered).toEqual([]);
    });
  });

  describe('clearRegistry', () => {
    it('should clear all registered workflows', () => {
      engine.registerWorkflow(TestWorkflow);

      engine.clearRegistry();

      expect(engine.getRegisteredWorkflows()).toEqual([]);
    });
  });

  describe('with concurrency', () => {
    @Workflow({
      name: 'ConcurrentWorkflow',
      states: TestState,
      initialState: TestState.A,
      concurrency: {
        groupBy: 'value',
        mode: ConcurrencyMode.SEQUENTIAL,
      },
    })
    class ConcurrentWorkflow {}

    beforeEach(() => {
      StateRegistry.clear();
      StateRegistry.autoRegister([new StateA(), new StateB()]);
    });

    it('should create ConcurrencyManager when lockAdapter provided', async () => {
      const result = await engine.execute(ConcurrentWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
      expect(result.groupId).toBe(1);
    });

    it('should work without lockAdapter', async () => {
      const engineNoLock = new WorkflowEngine({ persistence });

      const result = await engineNoLock.execute(ConcurrentWorkflow, {
        data: { value: 1 },
      });

      expect(result.status).toBe('completed');
    });
  });
});
