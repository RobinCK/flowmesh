import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { WorkflowExecution, WorkflowStatus } from '../../../src/types';

describe('InMemoryPersistenceAdapter', () => {
  let adapter: InMemoryPersistenceAdapter;

  beforeEach(() => {
    adapter = new InMemoryPersistenceAdapter();
  });

  const createExecution = (id: string, overrides = {}): WorkflowExecution => ({
    id,
    workflowName: 'TestWorkflow',
    currentState: 'A',
    status: WorkflowStatus.RUNNING,
    data: { value: 1 },
    outputs: {},
    history: [],
    metadata: {
      startedAt: new Date(),
      updatedAt: new Date(),
      totalAttempts: 0,
    },
    ...overrides,
  });

  describe('save and load', () => {
    it('should save and load execution', async () => {
      const execution = createExecution('exec-1');

      await adapter.save(execution);
      const loaded = await adapter.load('exec-1');

      expect(loaded).toEqual(execution);
    });

    it('should return null for non-existent execution', async () => {
      const loaded = await adapter.load('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('update', () => {
    it('should update existing execution', async () => {
      const execution = createExecution('exec-1');
      await adapter.save(execution);

      await adapter.update('exec-1', {
        currentState: 'B',
        status: WorkflowStatus.COMPLETED,
      });

      const loaded = await adapter.load('exec-1');
      expect(loaded?.currentState).toBe('B');
      expect(loaded?.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should throw error if execution not found', async () => {
      await expect(adapter.update('non-existent', { currentState: 'B' })).rejects.toThrow('Execution non-existent not found');
    });

    it('should merge updates with existing data', async () => {
      const execution = createExecution('exec-1', {
        data: { value: 1, name: 'test' },
      });
      await adapter.save(execution);

      await adapter.update('exec-1', {
        data: { value: 2 } as any,
      });

      const loaded = await adapter.load('exec-1');
      expect(loaded?.data).toEqual({ value: 2 });
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await adapter.save(
        createExecution('exec-1', {
          workflowName: 'OrderWorkflow',
          status: WorkflowStatus.RUNNING,
          groupId: 'user-1',
          currentState: 'CREATED',
        })
      );
      await adapter.save(
        createExecution('exec-2', {
          workflowName: 'OrderWorkflow',
          status: WorkflowStatus.COMPLETED,
          groupId: 'user-1',
          currentState: 'COMPLETED',
        })
      );
      await adapter.save(
        createExecution('exec-3', {
          workflowName: 'PaymentWorkflow',
          status: WorkflowStatus.RUNNING,
          groupId: 'user-2',
          currentState: 'PROCESSING',
        })
      );
    });

    it('should find by workflowName', async () => {
      const results = await adapter.find({ workflowName: 'OrderWorkflow' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.workflowName === 'OrderWorkflow')).toBe(true);
    });

    it('should find by status', async () => {
      const results = await adapter.find({ status: WorkflowStatus.RUNNING });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === WorkflowStatus.RUNNING)).toBe(true);
    });

    it('should find by groupId', async () => {
      const results = await adapter.find({ groupId: 'user-1' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.groupId === 'user-1')).toBe(true);
    });

    it('should find by currentState', async () => {
      const results = await adapter.find({ currentState: 'CREATED' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('exec-1');
    });

    it('should combine multiple filters', async () => {
      const results = await adapter.find({
        workflowName: 'OrderWorkflow',
        status: WorkflowStatus.COMPLETED,
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('exec-2');
    });

    it('should return empty array if no matches', async () => {
      const results = await adapter.find({ workflowName: 'NonExistent' });
      expect(results).toEqual([]);
    });

    it('should return all if no filters', async () => {
      const results = await adapter.find({});
      expect(results).toHaveLength(3);
    });
  });
});
