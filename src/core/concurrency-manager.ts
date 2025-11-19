import { LockAdapter, WorkflowContext, ConcurrencyConfig, ConcurrencyMode, LoggerAdapter } from '../types';

interface GroupLockInfo {
  hardLocked: boolean;
  currentExecution?: string;
  softLock: {
    activeExecutions: Set<string>;
    maxConcurrent: number;
  };
}

export class ConcurrencyManager {
  private groupLocks: Map<string, GroupLockInfo> = new Map();

  constructor(
    private readonly lockAdapter: LockAdapter,
    private readonly logger?: LoggerAdapter
  ) {}

  async acquireGroupLock(groupId: string, executionId: string, config?: ConcurrencyConfig): Promise<boolean> {
    if (!config) {
      return true;
    }

    const lockInfo = this.getOrCreateLockInfo(groupId, config);

    if (config.mode === ConcurrencyMode.SEQUENTIAL) {
      if (lockInfo.currentExecution === executionId) {
        this.logger?.debug(`Execution ${executionId} already holds lock for group ${groupId}`);
        return true;
      }

      if (lockInfo.hardLocked) {
        this.logger?.debug(`Group ${groupId} is hard locked by ${lockInfo.currentExecution}`);
        return false;
      }

      if (
        lockInfo.softLock.activeExecutions.size >= lockInfo.softLock.maxConcurrent &&
        !lockInfo.softLock.activeExecutions.has(executionId)
      ) {
        this.logger?.debug(
          `Group ${groupId} soft lock full: ${lockInfo.softLock.activeExecutions.size}/${lockInfo.softLock.maxConcurrent}`
        );
        return false;
      }

      const lockKey = `workflow:group:${groupId}`;
      const acquired = await this.lockAdapter.acquire(lockKey, executionId);

      if (acquired) {
        lockInfo.hardLocked = true;
        lockInfo.currentExecution = executionId;
        lockInfo.softLock.activeExecutions.add(executionId);
        this.logger?.debug(`Acquired hard lock for ${executionId} in group ${groupId}`);
      }

      return acquired;
    }

    if (config.mode === ConcurrencyMode.THROTTLE) {
      if (
        lockInfo.softLock.activeExecutions.size >= lockInfo.softLock.maxConcurrent &&
        !lockInfo.softLock.activeExecutions.has(executionId)
      ) {
        this.logger?.debug(
          `Group ${groupId} throttle limit reached: ${lockInfo.softLock.activeExecutions.size}/${lockInfo.softLock.maxConcurrent}`
        );
        return false;
      }

      lockInfo.softLock.activeExecutions.add(executionId);
      this.logger?.debug(`Acquired throttle lock for ${executionId} in group ${groupId}`);

      return true;
    }

    lockInfo.softLock.activeExecutions.add(executionId);

    return true;
  }

  async partialUnlock(groupId: string, executionId: string, config?: ConcurrencyConfig): Promise<void> {
    if (!config) {
      return;
    }

    const lockInfo = this.groupLocks.get(groupId);

    if (!lockInfo) {
      return;
    }

    if (lockInfo.hardLocked && lockInfo.currentExecution === executionId) {
      lockInfo.hardLocked = false;
      lockInfo.currentExecution = undefined;

      this.logger?.debug(`Released hard lock for ${executionId} in group ${groupId}`);

      const lockKey = `workflow:group:${groupId}`;
      await this.lockAdapter.release(lockKey);
    }
  }

  async releaseGroupLock(groupId: string, executionId: string): Promise<void> {
    const lockInfo = this.groupLocks.get(groupId);

    if (!lockInfo) {
      return;
    }

    lockInfo.softLock.activeExecutions.delete(executionId);

    const wasHardLocked = lockInfo.hardLocked && lockInfo.currentExecution === executionId;

    if (wasHardLocked) {
      lockInfo.hardLocked = false;
      lockInfo.currentExecution = undefined;
    }

    if (!lockInfo.hardLocked && lockInfo.softLock.activeExecutions.size === 0) {
      this.groupLocks.delete(groupId);
    }

    this.logger?.debug(`Released lock for ${executionId} in group ${groupId}`);

    if (wasHardLocked) {
      const lockKey = `workflow:group:${groupId}`;
      await this.lockAdapter.release(lockKey);
    }
  }

  getGroupId(context: WorkflowContext, config?: ConcurrencyConfig): string | undefined {
    if (!config) {
      return undefined;
    }

    if (typeof config.groupBy === 'string') {
      return (context.data[config.groupBy] as string) || context.groupId;
    }

    return config.groupBy(context);
  }

  private getOrCreateLockInfo(groupId: string, config: ConcurrencyConfig): GroupLockInfo {
    let lockInfo = this.groupLocks.get(groupId);

    if (!lockInfo) {
      lockInfo = {
        hardLocked: false,
        softLock: {
          activeExecutions: new Set(),
          maxConcurrent: config.maxConcurrentAfterUnlock || 1,
        },
      };
      this.groupLocks.set(groupId, lockInfo);
    }

    return lockInfo;
  }
}
