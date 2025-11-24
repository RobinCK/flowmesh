import { WorkflowExecution, ExecutionFilter, PersistenceAdapter, LockAdapter, LoggerAdapter, IWorkflowPlugin } from '../types';
import { WorkflowExecutor, ExecutionOptions, ResumeOptions } from './workflow-executor';
import { ConcurrencyManager } from './concurrency-manager';
import { StateRegistry } from './state-registry';
import { getWorkflowMetadata } from '../decorators';
import { WorkflowGraph, ExecutionGraph } from '../types/graph.types';
import { WorkflowGraphBuilder } from './workflow-graph-builder';
import { ExecutionGraphBuilder } from './execution-graph-builder';

export interface WorkflowEngineConfig {
  persistence?: PersistenceAdapter;
  lockAdapter?: LockAdapter;
  logger?: LoggerAdapter;
  plugins?: IWorkflowPlugin[];
  instanceFactory?: <T>(classType: new (...args: any[]) => T) => T;
}

export class WorkflowEngine {
  private concurrencyManager?: ConcurrencyManager;
  private executors: Map<string, WorkflowExecutor> = new Map();

  constructor(private readonly config: WorkflowEngineConfig = {}) {
    if (config.lockAdapter) {
      this.concurrencyManager = new ConcurrencyManager(config.lockAdapter, config.logger);
    }
  }

  registerWorkflow(workflowClass: new (...args: any[]) => any): void {
    const metadata = getWorkflowMetadata(workflowClass);

    if (!metadata) {
      throw new Error(`Class ${workflowClass.name} is not decorated with @Workflow`);
    }

    const workflowInstance = this.config.instanceFactory ? this.config.instanceFactory(workflowClass) : new workflowClass();

    const executor = new WorkflowExecutor(
      workflowInstance,
      metadata,
      this.config.persistence,
      this.concurrencyManager,
      this.config.logger,
      this.config.plugins || []
    );

    this.executors.set(metadata.name, executor);
  }

  async execute<TData extends Record<string, unknown> = Record<string, unknown>>(
    workflowClass: new (...args: any[]) => any,
    options: ExecutionOptions<TData>
  ): Promise<WorkflowExecution<TData>> {
    const metadata = getWorkflowMetadata(workflowClass);

    if (!metadata) {
      throw new Error(`Class ${workflowClass.name} is not decorated with @Workflow`);
    }

    let executor = this.executors.get(metadata.name);

    if (!executor) {
      this.registerWorkflow(workflowClass);
      executor = this.executors.get(metadata.name);
    }

    if (!executor) {
      throw new Error(`Failed to create executor for workflow ${metadata.name}`);
    }

    return executor.execute(options) as Promise<WorkflowExecution<TData>>;
  }

  async resume<TData extends Record<string, unknown> = Record<string, unknown>>(
    workflowClass: new (...args: any[]) => any,
    executionId: string,
    options?: ResumeOptions<TData>
  ): Promise<WorkflowExecution<TData>> {
    const metadata = getWorkflowMetadata(workflowClass);

    if (!metadata) {
      throw new Error(`Class ${workflowClass.name} is not decorated with @Workflow`);
    }

    const executor = this.executors.get(metadata.name);

    if (!executor) {
      throw new Error(`Workflow ${metadata.name} is not registered`);
    }

    return executor.resume(executionId, options) as Promise<WorkflowExecution<TData>>;
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    if (!this.config.persistence) {
      return null;
    }

    return this.config.persistence.load(executionId);
  }

  async findExecutions(filter: ExecutionFilter): Promise<WorkflowExecution[]> {
    if (!this.config.persistence) {
      return [];
    }

    return this.config.persistence.find(filter);
  }

  getRegisteredWorkflows(): string[] {
    return Array.from(this.executors.keys());
  }

  clearRegistry(): void {
    this.executors.clear();
    StateRegistry.clear();
  }

  /**
   * Get a static graph showing all possible states and transitions for a workflow
   * @param workflowClass - The workflow class decorated with @Workflow
   * @returns WorkflowGraph with nodes (states) and edges (transitions)
   */
  getWorkflowGraph(workflowClass: new (...args: any[]) => any): WorkflowGraph {
    const metadata = getWorkflowMetadata(workflowClass);

    if (!metadata) {
      throw new Error(`Class ${workflowClass.name} is not decorated with @Workflow`);
    }

    return WorkflowGraphBuilder.buildGraph(metadata);
  }

  /**
   * Get an execution graph showing the actual execution path with statuses
   * @param executionId - The ID of the workflow execution
   * @returns ExecutionGraph with nodes (states with statuses) and edges (actual transitions)
   */
  async getExecutionGraph(executionId: string): Promise<ExecutionGraph> {
    if (!this.config.persistence) {
      throw new Error('Persistence adapter is required to get execution graph');
    }

    const execution = await this.config.persistence.load(executionId);

    if (!execution) {
      throw new Error(`Execution with id ${executionId} not found`);
    }

    return ExecutionGraphBuilder.buildGraph(execution);
  }
}
