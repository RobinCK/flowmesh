import { LockAdapter } from '../types';

export class InMemoryLockAdapter implements LockAdapter {
  private locks: Map<string, { executionId: string; expiresAt: number }> = new Map();

  async acquire(key: string, executionId: string, ttl: number = 60000): Promise<boolean> {
    this.cleanExpiredLocks();

    if (this.locks.has(key)) {
      return false;
    }

    this.locks.set(key, { executionId, expiresAt: Date.now() + ttl });

    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }

  async isLocked(key: string): Promise<boolean> {
    this.cleanExpiredLocks();
    return this.locks.has(key);
  }

  async extend(key: string, ttl: number): Promise<boolean> {
    const lock = this.locks.get(key);

    if (!lock) {
      return false;
    }

    this.locks.set(key, { executionId: lock.executionId, expiresAt: Date.now() + ttl });

    return true;
  }

  clear(): void {
    this.locks.clear();
  }

  private cleanExpiredLocks(): void {
    const now = Date.now();

    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt <= now) {
        this.locks.delete(key);
      }
    }
  }
}
