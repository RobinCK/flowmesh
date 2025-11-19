import { IWorkflowPlugin, WorkflowContext } from '../types';

export interface StateMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalDuration: number;
  averageDuration: number;
}

export class MetricsPlugin implements IWorkflowPlugin {
  name = 'MetricsPlugin';

  private metrics: Map<string, StateMetrics> = new Map();
  private stateStartTimes: Map<string, number> = new Map();

  onInit(): void {}

  beforeExecute(context: WorkflowContext): void {
    const key = `${context.executionId}-${String(context.currentState)}`;
    this.stateStartTimes.set(key, Date.now());
  }

  afterExecute(context: WorkflowContext): void {
    const key = `${context.executionId}-${String(context.currentState)}`;
    const startTime = this.stateStartTimes.get(key);

    if (startTime) {
      const duration = Date.now() - startTime;
      this.recordMetric(String(context.currentState), duration, true);
      this.stateStartTimes.delete(key);
    }
  }

  onError(context: WorkflowContext, _error: Error): void {
    const key = `${context.executionId}-${String(context.currentState)}`;
    const startTime = this.stateStartTimes.get(key);

    if (startTime) {
      const duration = Date.now() - startTime;
      this.recordMetric(String(context.currentState), duration, false);
      this.stateStartTimes.delete(key);
    }
  }

  getMetrics(state?: string): StateMetrics | Map<string, StateMetrics> {
    if (state) {
      return this.metrics.get(state) || this.createEmptyMetrics();
    }

    return new Map(this.metrics);
  }

  clearMetrics(): void {
    this.metrics.clear();
    this.stateStartTimes.clear();
  }

  private recordMetric(state: string, duration: number, success: boolean): void {
    let metrics = this.metrics.get(state);

    if (!metrics) {
      metrics = this.createEmptyMetrics();
      this.metrics.set(state, metrics);
    }

    metrics.totalExecutions++;
    metrics.totalDuration += duration;

    if (success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    metrics.averageDuration = metrics.totalDuration / metrics.totalExecutions;
  }

  private createEmptyMetrics(): StateMetrics {
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDuration: 0,
      averageDuration: 0,
    };
  }
}
