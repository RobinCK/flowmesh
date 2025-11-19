import { InMemoryLockAdapter } from '../../../src/adapters/in-memory-lock.adapter';

describe('InMemoryLockAdapter', () => {
  let adapter: InMemoryLockAdapter;

  beforeEach(() => {
    adapter = new InMemoryLockAdapter();
  });

  describe('acquire', () => {
    it('should acquire lock for new key', async () => {
      const acquired = await adapter.acquire('key1', 'exec-1');
      expect(acquired).toBe(true);
    });

    it('should fail to acquire already locked key', async () => {
      await adapter.acquire('key1', 'exec-1');
      const acquired = await adapter.acquire('key1', 'exec-2');
      expect(acquired).toBe(false);
    });

    it('should allow different keys independently', async () => {
      const acquired1 = await adapter.acquire('key1', 'exec-1');
      const acquired2 = await adapter.acquire('key2', 'exec-2');

      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
    });
  });

  describe('release', () => {
    it('should release locked key', async () => {
      await adapter.acquire('key1', 'exec-1');
      await adapter.release('key1');

      const acquired = await adapter.acquire('key1', 'exec-2');
      expect(acquired).toBe(true);
    });

    it('should not error on releasing non-locked key', async () => {
      await expect(adapter.release('non-existent')).resolves.not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('should return true for locked key', async () => {
      await adapter.acquire('key1', 'exec-1');
      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(true);
    });

    it('should return false for unlocked key', async () => {
      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(false);
    });

    it('should return false after release', async () => {
      await adapter.acquire('key1', 'exec-1');
      await adapter.release('key1');

      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(false);
    });
  });

  describe('extend', () => {
    it('should extend lock TTL', async () => {
      await adapter.acquire('key1', 'exec-1', 1000);
      const extended = await adapter.extend('key1', 5000);
      expect(extended).toBe(true);
    });

    it('should return false for non-existent lock', async () => {
      const extended = await adapter.extend('non-existent', 5000);
      expect(extended).toBe(false);
    });

    it('should preserve executionId when extending', async () => {
      await adapter.acquire('key1', 'exec-1', 1000);
      await adapter.extend('key1', 5000);

      // Lock should still be held
      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(true);
    });
  });

  describe('TTL and expiration', () => {
    it('should automatically release expired locks on acquire', async () => {
      // Acquire with very short TTL
      await adapter.acquire('key1', 'exec-1', 10); // 10ms

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      // Should be able to acquire again
      const acquired = await adapter.acquire('key1', 'exec-2', 1000);
      expect(acquired).toBe(true);
    });

    it('should automatically release expired locks on isLocked check', async () => {
      await adapter.acquire('key1', 'exec-1', 10); // 10ms

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(false);
    });

    it('should handle default TTL', async () => {
      // Acquire without specifying TTL (should use default 60000ms)
      const acquired = await adapter.acquire('key1', 'exec-1');
      expect(acquired).toBe(true);

      // Should still be locked after short wait
      await new Promise(resolve => setTimeout(resolve, 100));
      const locked = await adapter.isLocked('key1');
      expect(locked).toBe(true);
    });

    it('should clean multiple expired locks', async () => {
      // Acquire multiple locks with short TTL
      await adapter.acquire('key1', 'exec-1', 10);
      await adapter.acquire('key2', 'exec-2', 10);
      await adapter.acquire('key3', 'exec-3', 10);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      // All should be released
      const locked1 = await adapter.isLocked('key1');
      const locked2 = await adapter.isLocked('key2');
      const locked3 = await adapter.isLocked('key3');

      expect(locked1).toBe(false);
      expect(locked2).toBe(false);
      expect(locked3).toBe(false);
    });

    it('should not clean locks that have not expired', async () => {
      await adapter.acquire('key1', 'exec-1', 10); // Will expire
      await adapter.acquire('key2', 'exec-2', 10000); // Won't expire

      // Wait for first to expire
      await new Promise(resolve => setTimeout(resolve, 20));

      const locked1 = await adapter.isLocked('key1');
      const locked2 = await adapter.isLocked('key2');

      expect(locked1).toBe(false);
      expect(locked2).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all locks', async () => {
      await adapter.acquire('key1', 'exec-1');
      await adapter.acquire('key2', 'exec-2');

      adapter.clear();

      expect(await adapter.isLocked('key1')).toBe(false);
      expect(await adapter.isLocked('key2')).toBe(false);
    });
  });
});
