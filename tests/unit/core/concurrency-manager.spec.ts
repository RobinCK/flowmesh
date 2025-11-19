import { ConcurrencyManager } from '../../../src/core/concurrency-manager';
import { LockAdapter, ConcurrencyMode } from '../../../src/types';

class MockLockAdapter implements LockAdapter {
  private locks = new Map<string, string>();

  async acquire(key: string, executionId: string): Promise<boolean> {
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, executionId);
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }

  async isLocked(key: string): Promise<boolean> {
    return this.locks.has(key);
  }

  async extend(key: string, ttl: number): Promise<boolean> {
    return this.locks.has(key);
  }

  clear() {
    this.locks.clear();
  }
}

describe('ConcurrencyManager', () => {
  let lockAdapter: MockLockAdapter;
  let manager: ConcurrencyManager;

  beforeEach(() => {
    lockAdapter = new MockLockAdapter();
    manager = new ConcurrencyManager(lockAdapter);
  });

  describe('SEQUENTIAL mode', () => {
    const config = {
      groupBy: 'userId',
      mode: ConcurrencyMode.SEQUENTIAL,
    };

    it('should acquire lock for first execution', async () => {
      const acquired = await manager.acquireGroupLock('user1', 'exec1', config);
      expect(acquired).toBe(true);
    });

    it('should reject second execution for same group', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired = await manager.acquireGroupLock('user1', 'exec2', config);
      expect(acquired).toBe(false);
    });

    it('should allow same execution to reacquire', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired = await manager.acquireGroupLock('user1', 'exec1', config);
      expect(acquired).toBe(true);
    });

    it('should allow different groups in parallel', async () => {
      const acquired1 = await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired2 = await manager.acquireGroupLock('user2', 'exec2', config);

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
    });

    it('should allow new execution after release', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.releaseGroupLock('user1', 'exec1');

      const acquired = await manager.acquireGroupLock('user1', 'exec2', config);
      expect(acquired).toBe(true);
    });

    it('should call lock adapter with correct key', async () => {
      const spy = jest.spyOn(lockAdapter, 'acquire');
      await manager.acquireGroupLock('user1', 'exec1', config);

      expect(spy).toHaveBeenCalledWith('workflow:group:user1', 'exec1');
    });
  });

  describe('PARALLEL mode', () => {
    const config = {
      groupBy: 'userId',
      mode: ConcurrencyMode.PARALLEL,
    };

    it('should allow unlimited concurrent executions', async () => {
      const acquired1 = await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired2 = await manager.acquireGroupLock('user1', 'exec2', config);
      const acquired3 = await manager.acquireGroupLock('user1', 'exec3', config);

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
      expect(acquired3).toBe(true);
    });

    it('should not call lock adapter', async () => {
      const spy = jest.spyOn(lockAdapter, 'acquire');
      await manager.acquireGroupLock('user1', 'exec1', config);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('THROTTLE mode', () => {
    const config = {
      groupBy: 'userId',
      mode: ConcurrencyMode.THROTTLE,
      maxConcurrentAfterUnlock: 2,
    };

    it('should allow up to maxConcurrent executions', async () => {
      const acquired1 = await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired2 = await manager.acquireGroupLock('user1', 'exec2', config);

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
    });

    it('should reject when limit exceeded', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.acquireGroupLock('user1', 'exec2', config);

      const acquired3 = await manager.acquireGroupLock('user1', 'exec3', config);
      expect(acquired3).toBe(false);
    });

    it('should allow new execution after release', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.acquireGroupLock('user1', 'exec2', config);
      await manager.releaseGroupLock('user1', 'exec1');

      const acquired = await manager.acquireGroupLock('user1', 'exec3', config);
      expect(acquired).toBe(true);
    });

    it('should allow same execution to reacquire', async () => {
      await manager.acquireGroupLock('user1', 'exec1', config);
      const acquired = await manager.acquireGroupLock('user1', 'exec1', config);
      expect(acquired).toBe(true);
    });

    it('should not call lock adapter', async () => {
      const spy = jest.spyOn(lockAdapter, 'acquire');
      await manager.acquireGroupLock('user1', 'exec1', config);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('partialUnlock', () => {
    it('should release hard lock in SEQUENTIAL mode', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
        maxConcurrentAfterUnlock: 2,
      };

      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.partialUnlock('user1', 'exec1', config);

      // After partial unlock, exec1 is still in activeExecutions (count=1)
      // maxConcurrentAfterUnlock=2, so one more execution can be added
      const acquired2 = await manager.acquireGroupLock('user1', 'exec2', config);
      expect(acquired2).toBe(true);

      // Now we have exec1 + exec2 = 2, which equals maxConcurrentAfterUnlock
      // Third execution should be rejected
      const acquired3 = await manager.acquireGroupLock('user1', 'exec3', config);
      expect(acquired3).toBe(false);
    });

    it('should call lock adapter release', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
      };

      const spy = jest.spyOn(lockAdapter, 'release');
      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.partialUnlock('user1', 'exec1', config);

      expect(spy).toHaveBeenCalledWith('workflow:group:user1');
    });

    it('should not error if lock not found', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
      };

      await expect(manager.partialUnlock('user1', 'exec1', config)).resolves.not.toThrow();
    });

    it('should only unlock if execution matches', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
      };

      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.partialUnlock('user1', 'exec2', config);

      // Lock should still be held by exec1
      const acquired = await manager.acquireGroupLock('user1', 'exec3', config);
      expect(acquired).toBe(false);
    });
  });

  describe('releaseGroupLock', () => {
    it('should release lock in SEQUENTIAL mode', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
      };

      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.releaseGroupLock('user1', 'exec1');

      const acquired = await manager.acquireGroupLock('user1', 'exec2', config);
      expect(acquired).toBe(true);
    });

    it('should remove from active executions in THROTTLE', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.THROTTLE,
        maxConcurrentAfterUnlock: 1,
      };

      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.releaseGroupLock('user1', 'exec1');

      const acquired = await manager.acquireGroupLock('user1', 'exec2', config);
      expect(acquired).toBe(true);
    });

    it('should not error if execution not found', async () => {
      await expect(manager.releaseGroupLock('user1', 'exec1')).resolves.not.toThrow();
    });

    it('should call lock adapter release', async () => {
      const config = {
        groupBy: 'userId',
        mode: ConcurrencyMode.SEQUENTIAL,
      };

      const spy = jest.spyOn(lockAdapter, 'release');
      await manager.acquireGroupLock('user1', 'exec1', config);
      await manager.releaseGroupLock('user1', 'exec1');

      expect(spy).toHaveBeenCalledWith('workflow:group:user1');
    });
  });

  describe('no config', () => {
    it('should always return true when no config', async () => {
      const acquired = await manager.acquireGroupLock('user1', 'exec1');
      expect(acquired).toBe(true);
    });

    it('should not call lock adapter when no config', async () => {
      const spy = jest.spyOn(lockAdapter, 'acquire');
      await manager.acquireGroupLock('user1', 'exec1');

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getGroupId', () => {
    it('should extract groupId from string field', () => {
      const config = { groupBy: 'userId', mode: ConcurrencyMode.SEQUENTIAL };
      const context = { data: { userId: 'user123' } } as any;

      const groupId = manager.getGroupId(context, config);
      expect(groupId).toBe('user123');
    });

    it('should use function to compute groupId', () => {
      const config = {
        groupBy: (ctx: any) => `${ctx.data.tenant}-${ctx.data.userId}`,
        mode: ConcurrencyMode.SEQUENTIAL,
      };
      const context = { data: { tenant: 'acme', userId: 'user1' } } as any;

      const groupId = manager.getGroupId(context, config);
      expect(groupId).toBe('acme-user1');
    });

    it('should return undefined when no config', () => {
      const context = { data: { userId: 'user1' } } as any;

      const groupId = manager.getGroupId(context);
      expect(groupId).toBeUndefined();
    });

    it('should fallback to context.groupId if field missing', () => {
      const config = { groupBy: 'userId', mode: ConcurrencyMode.SEQUENTIAL };
      const context = { data: {}, groupId: 'fallback' } as any;

      const groupId = manager.getGroupId(context, config);
      expect(groupId).toBe('fallback');
    });
  });
});
