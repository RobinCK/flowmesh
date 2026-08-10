import {
  LockAdapter,
  WorkflowContext,
  ConcurrencyConfig,
  ConcurrencyMode,
  LoggerAdapter,
  PersistenceAdapter,
  WorkflowStatus,
} from '../types';

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
  private readonly managerId = Math.random().toString(36).slice(2, 10);

  constructor(
    private readonly lockAdapter: LockAdapter,
    private readonly logger?: LoggerAdapter
  ) {}

  async acquireGroupLock(
    groupId: string,
    executionId: string,
    config?: ConcurrencyConfig,
    workflowName?: string
  ): Promise<boolean> {
    if (!config) {
      return true;
    }

    const scopeKey = this.scopeKey(groupId, workflowName);
    const lockInfo = this.getOrCreateLockInfo(scopeKey, config);

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

      const acquired = await this.lockAdapter.acquire(this.lockKey(groupId, workflowName), executionId);

      if (acquired) {
        lockInfo.hardLocked = true;
        lockInfo.currentExecution = executionId;
        lockInfo.softLock.activeExecutions.add(executionId);
        this.logger?.debug(`Acquired hard lock for ${executionId} in group ${groupId}`);
      } else {
        this.discardIfUnused(scopeKey, lockInfo);
      }

      return acquired;
    }

    if (config.mode === ConcurrencyMode.THROTTLE) {
      if (
        lockInfo.softLock.activeExecutions.size >= lockInfo.softLock.maxConcurrent &&
        !lockInfo.softLock.activeExecutions.has(executionId)
      ) {
        this.logger?.debug(
          `Group ${groupId} throttle limit reached: ${lockInfo.softLock.activeExecutions.size}/${lockInfo.softLock.maxConcurrent}, managerId=${this.managerId}, activeExecutions=${Array.from(lockInfo.softLock.activeExecutions).slice(0, 20).join(',')}`
        );

        return false;
      }

      lockInfo.softLock.activeExecutions.add(executionId);
      this.logger?.debug(
        `Acquired throttle lock for ${executionId} in group ${groupId}, managerId=${this.managerId}, active=${lockInfo.softLock.activeExecutions.size}/${lockInfo.softLock.maxConcurrent}`
      );

      return true;
    }

    lockInfo.softLock.activeExecutions.add(executionId);

    return true;
  }

  async partialUnlock(groupId: string, executionId: string, config?: ConcurrencyConfig, workflowName?: string): Promise<void> {
    if (!config) {
      return;
    }

    const lockInfo = this.groupLocks.get(this.scopeKey(groupId, workflowName));

    if (!lockInfo) {
      return;
    }

    if (lockInfo.hardLocked && lockInfo.currentExecution === executionId) {
      lockInfo.hardLocked = false;
      lockInfo.currentExecution = undefined;

      this.logger?.debug(`Released hard lock for ${executionId} in group ${groupId}`);

      await this.lockAdapter.release(this.lockKey(groupId, workflowName));
    }
  }

  async releaseGroupLock(groupId: string, executionId: string, workflowName?: string): Promise<void> {
    const scopeKey = this.scopeKey(groupId, workflowName);
    const lockInfo = this.groupLocks.get(scopeKey);

    if (!lockInfo) {
      return;
    }

    lockInfo.softLock.activeExecutions.delete(executionId);

    const wasHardLocked = lockInfo.hardLocked && lockInfo.currentExecution === executionId;

    if (wasHardLocked) {
      lockInfo.hardLocked = false;
      lockInfo.currentExecution = undefined;
    }

    this.discardIfUnused(scopeKey, lockInfo);

    this.logger?.debug(
      `Released lock for ${executionId} in group ${groupId}, managerId=${this.managerId}, active=${lockInfo.softLock.activeExecutions.size}/${lockInfo.softLock.maxConcurrent}`
    );

    if (wasHardLocked) {
      await this.lockAdapter.release(this.lockKey(groupId, workflowName));
    }
  }

  async forceReleaseGroupLock(
    groupId: string,
    workflowName?: string
  ): Promise<{ clearedExecutions: string[]; hadHardLock: boolean }> {
    const scopeKey = this.scopeKey(groupId, workflowName);
    const lockInfo = this.groupLocks.get(scopeKey);

    if (!lockInfo) {
      this.logger?.warn(`Force release requested for group ${groupId}, but no lock info exists, managerId=${this.managerId}`);
      return { clearedExecutions: [], hadHardLock: false };
    }

    const clearedExecutions = Array.from(lockInfo.softLock.activeExecutions);
    const hadHardLock = lockInfo.hardLocked;

    this.groupLocks.delete(scopeKey);

    if (hadHardLock) {
      await this.lockAdapter.release(this.lockKey(groupId, workflowName));
    }

    this.logger?.warn(
      `Force released group lock for ${groupId}, managerId=${this.managerId}, cleared=${clearedExecutions.length}, executions=${clearedExecutions.slice(0, 20).join(',')}`
    );

    return { clearedExecutions, hadHardLock };
  }

  async reconcileGroupLock(
    groupId: string,
    persistence: PersistenceAdapter,
    workflowName?: string
  ): Promise<{ removedExecutions: string[]; remainingExecutions: string[] }> {
    const scopeKey = this.scopeKey(groupId, workflowName);
    const lockInfo = this.groupLocks.get(scopeKey);

    if (!lockInfo) {
      return { removedExecutions: [], remainingExecutions: [] };
    }

    const activeExecutions = Array.from(lockInfo.softLock.activeExecutions);

    if (activeExecutions.length === 0) {
      return { removedExecutions: [], remainingExecutions: [] };
    }

    const persistedExecutions = await persistence.find({
      groupId,
      ...(workflowName ? { workflowName } : {}),
      status: [WorkflowStatus.RUNNING, WorkflowStatus.SUSPENDED],
    });

    const persistedIds = new Set(persistedExecutions.map(execution => execution.id));
    const removedExecutions: string[] = [];

    for (const activeExecutionId of activeExecutions) {
      if (!persistedIds.has(activeExecutionId)) {
        lockInfo.softLock.activeExecutions.delete(activeExecutionId);
        removedExecutions.push(activeExecutionId);

        if (lockInfo.currentExecution === activeExecutionId) {
          lockInfo.currentExecution = undefined;
          lockInfo.hardLocked = false;
        }
      }
    }

    this.discardIfUnused(scopeKey, lockInfo);

    if (removedExecutions.length > 0) {
      this.logger?.warn(
        `Reconciled stale executions for group ${groupId}, managerId=${this.managerId}, removed=${removedExecutions.length}, removedExecutions=${removedExecutions.slice(0, 20).join(',')}`
      );
    }

    return {
      removedExecutions,
      remainingExecutions: Array.from(lockInfo.softLock.activeExecutions),
    };
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

  private getOrCreateLockInfo(scopeKey: string, config: ConcurrencyConfig): GroupLockInfo {
    let lockInfo = this.groupLocks.get(scopeKey);

    if (!lockInfo) {
      lockInfo = {
        hardLocked: false,
        softLock: {
          activeExecutions: new Set(),
          maxConcurrent: config.maxConcurrentAfterUnlock || 1,
        },
      };
      this.groupLocks.set(scopeKey, lockInfo);
    }

    return lockInfo;
  }

  private discardIfUnused(scopeKey: string, lockInfo: GroupLockInfo): void {
    if (!lockInfo.hardLocked && lockInfo.softLock.activeExecutions.size === 0) {
      this.groupLocks.delete(scopeKey);
    }
  }

  private scopeKey(groupId: string, workflowName?: string): string {
    return workflowName ? `${workflowName}\u0000${groupId}` : groupId;
  }

  private lockKey(groupId: string, workflowName?: string): string {
    return workflowName ? `workflow:${workflowName}:group:${groupId}` : `workflow:group:${groupId}`;
  }

  getManagerId(): string {
    return this.managerId;
  }
}
