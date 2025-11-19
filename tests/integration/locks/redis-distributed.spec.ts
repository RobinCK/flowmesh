import { WorkflowEngine } from '../../../src/core/workflow-engine';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode } from '../../../src/types';
import { StateRegistry } from '../../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../../src/adapters/in-memory-persistence.adapter';
import { RedisLockAdapter } from '../../helpers/redis-lock.adapter';
import { TestContainers } from '../../helpers/test-containers';
import Redis from 'ioredis';
import { executeConcurrently } from '../../helpers/concurrent-execution';

enum DistributedState {
  START = 'START',
  PROCESS = 'PROCESS',
  END = 'END',
}

interface DistributedData extends Record<string, unknown> {
  orderId: string;
  instanceId: string;
}

interface DistributedOutputs extends Record<string, unknown> {
  [DistributedState.START]: { started: boolean };
  [DistributedState.PROCESS]: { processed: boolean; instanceId: string };
  [DistributedState.END]: { completed: boolean };
}

@Workflow({
  name: 'DistributedWorkflow',
  states: DistributedState,
  initialState: DistributedState.START,
  concurrency: {
    groupBy: 'orderId',
    mode: ConcurrencyMode.SEQUENTIAL,
  },
})
class DistributedWorkflow {}

@State(DistributedState.START)
class StartState implements IState<DistributedData, DistributedOutputs, DistributedState.START> {
  execute(
    ctx: WorkflowContext<DistributedData, DistributedOutputs>,
    actions: StateActions<DistributedData, DistributedOutputs, DistributedState.START>
  ) {
    actions.next({ output: { started: true } });
  }
}

@State(DistributedState.PROCESS)
class ProcessState implements IState<DistributedData, DistributedOutputs, DistributedState.PROCESS> {
  execute(
    ctx: WorkflowContext<DistributedData, DistributedOutputs>,
    actions: StateActions<DistributedData, DistributedOutputs, DistributedState.PROCESS>
  ) {
    // Record which instance processed this
    actions.next({ output: { processed: true, instanceId: ctx.data.instanceId } });
  }
}

@State(DistributedState.END)
class EndState implements IState<DistributedData, DistributedOutputs, DistributedState.END> {
  execute(
    ctx: WorkflowContext<DistributedData, DistributedOutputs>,
    actions: StateActions<DistributedData, DistributedOutputs, DistributedState.END>
  ) {
    actions.next({ output: { completed: true } });
  }
}

describe('Integration: Redis Distributed Locks', () => {
  let redis: Redis;
  let engine1: WorkflowEngine;
  let engine2: WorkflowEngine;
  let engine3: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeAll(async () => {
    const { client } = await TestContainers.startRedis();
    redis = client;
  }, 60000);

  beforeEach(async () => {
    await TestContainers.cleanupRedis();
    StateRegistry.clear();

    // Shared persistence so all engines see same executions
    persistence = new InMemoryPersistenceAdapter();

    // Create 3 separate engine instances with shared Redis locks
    const lockAdapter1 = new RedisLockAdapter(redis);
    const lockAdapter2 = new RedisLockAdapter(redis);
    const lockAdapter3 = new RedisLockAdapter(redis);

    engine1 = new WorkflowEngine({ persistence, lockAdapter: lockAdapter1 });
    engine2 = new WorkflowEngine({ persistence, lockAdapter: lockAdapter2 });
    engine3 = new WorkflowEngine({ persistence, lockAdapter: lockAdapter3 });

    // Register states (shared across engines)
    StateRegistry.autoRegister([new StartState(), new ProcessState(), new EndState()]);
  });

  afterAll(async () => {
    await TestContainers.stopAll();
  }, 30000);

  describe('multi-engine exclusive execution', () => {
    it('should allow only one engine to process same group at a time', async () => {
      const results = await executeConcurrently(3, async i => {
        const engine = [engine1, engine2, engine3][i];
        return engine.execute(DistributedWorkflow, {
          data: { orderId: 'order-1', instanceId: `instance-${i + 1}` },
        });
      });

      // Only 1 should succeed (sequential mode with distributed lock)
      const successes = results.filter(r => !r.error);
      const failures = results.filter(r => r.error);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(2);

      // Check that lock was acquired in Redis
      const lockKey = 'flowmesh:lock:order-1';
      const lockExists = await redis.exists(lockKey);
      expect(lockExists).toBe(0); // Lock should be released after completion
    });

    it('should allow different groups to execute in parallel', async () => {
      const results = await executeConcurrently(3, async i => {
        const engine = [engine1, engine2, engine3][i];
        return engine.execute(DistributedWorkflow, {
          data: { orderId: `order-${i + 1}`, instanceId: `instance-${i + 1}` },
        });
      });

      // All should succeed (different groups)
      const successes = results.filter(r => !r.error);
      expect(successes).toHaveLength(3);
    });

    it('should queue execution when lock is held by another engine', async () => {
      // Use concurrent execution helper for better race condition simulation
      const results = await executeConcurrently(2, async i => {
        const engine = i === 0 ? engine1 : engine2;
        return engine.execute(DistributedWorkflow, {
          data: { orderId: 'order-queue', instanceId: `instance-${i + 1}` },
        });
      });

      // One should succeed, one should fail (sequential mode)
      const successes = results.filter(r => !r.error);
      const failures = results.filter(r => r.error);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
    });
  });

  describe('lock ownership and release', () => {
    it('should track lock owner in Redis', async () => {
      const execution = await engine1.execute(DistributedWorkflow, {
        data: { orderId: 'order-owner', instanceId: 'instance-1' },
      });

      expect(execution.status).toBe('completed');

      // After completion, lock should be released
      const lockKey = 'flowmesh:lock:order-owner';
      const owner = await redis.get(lockKey);
      expect(owner).toBeNull();
    });

    it('should allow new execution after lock released', async () => {
      // First execution
      await engine1.execute(DistributedWorkflow, {
        data: { orderId: 'order-release', instanceId: 'instance-1' },
      });

      // Second execution on different engine
      const result2 = await engine2.execute(DistributedWorkflow, {
        data: { orderId: 'order-release', instanceId: 'instance-2' },
      });

      expect(result2.status).toBe('completed');
    });

    it('should handle lock expiration (TTL)', async () => {
      const lockAdapter = new RedisLockAdapter(redis);

      // Manually acquire lock with short TTL
      const acquired = await lockAdapter.acquire('order-ttl', 'exec-1', 1); // 1 second TTL
      expect(acquired).toBe(true);

      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should be able to acquire again
      const acquired2 = await lockAdapter.acquire('order-ttl', 'exec-2', 1);
      expect(acquired2).toBe(true);

      // Cleanup
      await lockAdapter.release('order-ttl');
    });
  });

  describe('Redis lock adapter operations', () => {
    it('should check if lock is held', async () => {
      const lockAdapter = new RedisLockAdapter(redis);

      const isLocked1 = await lockAdapter.isLocked('test-lock');
      expect(isLocked1).toBe(false);

      await lockAdapter.acquire('test-lock', 'exec-1');

      const isLocked2 = await lockAdapter.isLocked('test-lock');
      expect(isLocked2).toBe(true);

      await lockAdapter.release('test-lock');

      const isLocked3 = await lockAdapter.isLocked('test-lock');
      expect(isLocked3).toBe(false);
    });

    it('should get lock owner', async () => {
      const lockAdapter = new RedisLockAdapter(redis);

      await lockAdapter.acquire('owner-lock', 'execution-123');

      const owner = await lockAdapter.getOwner('owner-lock');
      expect(owner).toBe('execution-123');

      await lockAdapter.release('owner-lock');
    });

    it('should extend lock TTL', async () => {
      const lockAdapter = new RedisLockAdapter(redis);

      await lockAdapter.acquire('extend-lock', 'exec-1', 2); // 2 seconds

      const extended = await lockAdapter.extend('extend-lock', 10); // Extend to 10 seconds
      expect(extended).toBe(true);

      // Check TTL
      const ttl = await redis.ttl('flowmesh:lock:extend-lock');
      expect(ttl).toBeGreaterThan(5); // Should be around 10 seconds

      await lockAdapter.release('extend-lock');
    });

    it('should not extend non-existent lock', async () => {
      const lockAdapter = new RedisLockAdapter(redis);

      const extended = await lockAdapter.extend('non-existent', 10);
      expect(extended).toBe(false);
    });
  });

  describe('concurrent execution patterns', () => {
    it('should handle burst of executions across engines', async () => {
      const results = await executeConcurrently(9, async i => {
        const engine = [engine1, engine2, engine3][i % 3];
        const groupId = `order-${Math.floor(i / 3) + 1}`; // 3 groups of 3

        return engine.execute(DistributedWorkflow, {
          data: { orderId: groupId, instanceId: `instance-${i + 1}` },
        });
      });

      // Should have 3 successes (1 per group) and 6 failures
      const successes = results.filter(r => !r.error);
      const failures = results.filter(r => r.error);

      expect(successes).toHaveLength(3);
      expect(failures).toHaveLength(6);
    });

    it('should work with mixed success/failure across engines', async () => {
      // Engine 1: order-1 (should succeed)
      // Engine 2: order-1 (should fail - same group)
      // Engine 3: order-2 (should succeed - different group)

      const [result1, result2, result3] = await Promise.allSettled([
        engine1.execute(DistributedWorkflow, {
          data: { orderId: 'order-1', instanceId: 'instance-1' },
        }),
        engine2.execute(DistributedWorkflow, {
          data: { orderId: 'order-1', instanceId: 'instance-2' },
        }),
        engine3.execute(DistributedWorkflow, {
          data: { orderId: 'order-2', instanceId: 'instance-3' },
        }),
      ]);

      const succeeded = [result1, result2, result3].filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(2); // At least 2 should succeed
    });
  });
});
