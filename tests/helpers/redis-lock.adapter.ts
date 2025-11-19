import Redis from 'ioredis';
import { LockAdapter } from '../../src/types';

export class RedisLockAdapter implements LockAdapter {
  private readonly lockPrefix = 'flowmesh:lock:';
  private readonly defaultTTL = 60; // 60 seconds

  constructor(private readonly redis: Redis) {}

  async acquire(key: string, executionId: string, ttl?: number): Promise<boolean> {
    const lockKey = this.lockPrefix + key;
    const lockTTL = ttl || this.defaultTTL;

    const result = await this.redis.set(lockKey, executionId, 'EX', lockTTL, 'NX');
    return result === 'OK';
  }

  async release(key: string): Promise<void> {
    const lockKey = this.lockPrefix + key;
    await this.redis.del(lockKey);
  }

  async isLocked(key: string): Promise<boolean> {
    const lockKey = this.lockPrefix + key;
    const value = await this.redis.get(lockKey);
    return value !== null;
  }

  async getOwner(key: string): Promise<string | null> {
    const lockKey = this.lockPrefix + key;
    return await this.redis.get(lockKey);
  }

  async extend(key: string, ttl: number): Promise<boolean> {
    const lockKey = this.lockPrefix + key;
    const result = await this.redis.expire(lockKey, ttl);
    return result === 1;
  }
}
