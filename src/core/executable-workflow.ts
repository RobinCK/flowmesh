import { WorkflowEngine, WorkflowEngineConfig } from './workflow-engine';
import { ResumeOptions } from './workflow-executor';
import { WorkflowExecution } from '../types';
import { getWorkflowConfig } from '../decorators/workflow-config.decorator';

export abstract class ExecutableWorkflow<TData extends Record<string, unknown> = Record<string, unknown>> {
  private engine?: WorkflowEngine;
  protected instanceFactory?: <T>(classType: new (...args: any[]) => T) => T;

  /**
   * Set the instance factory for dependency injection.
   * This is typically called by the DI container (e.g., NestJS) or can be injected via constructor.
   */
  setInstanceFactory(factory: <T>(classType: new (...args: any[]) => T) => T): void {
    this.instanceFactory = factory;
  }

  /**
   * Get or create the workflow engine for this workflow.
   */
  private getEngine(): WorkflowEngine {
    if (this.engine) {
      return this.engine;
    }

    // Get configuration from @WorkflowConfig decorator
    const config = getWorkflowConfig(this.constructor) || {};

    // Resolve class types to instances if instanceFactory is available
    const engineConfig: WorkflowEngineConfig = {
      instanceFactory: this.instanceFactory,
    };

    if (config.persistence) {
      engineConfig.persistence =
        typeof config.persistence === 'function' && this.instanceFactory
          ? this.instanceFactory(config.persistence as any)
          : (config.persistence as any);
    }

    if (config.lockAdapter) {
      engineConfig.lockAdapter =
        typeof config.lockAdapter === 'function' && this.instanceFactory
          ? this.instanceFactory(config.lockAdapter as any)
          : (config.lockAdapter as any);
    }

    if (config.logger) {
      engineConfig.logger =
        typeof config.logger === 'function' && this.instanceFactory
          ? this.instanceFactory(config.logger as any)
          : (config.logger as any);
    }

    if (config.plugins) {
      engineConfig.plugins = config.plugins.map(plugin =>
        typeof plugin === 'function' && this.instanceFactory ? this.instanceFactory(plugin as any) : plugin
      );
    }

    this.engine = new WorkflowEngine(engineConfig);
    this.engine.registerWorkflow(this.constructor as any);

    return this.engine;
  }

  /**
   * Execute the workflow with the given data.
   */
  async execute(data: TData, executionId?: string): Promise<WorkflowExecution<TData>> {
    const engine = this.getEngine();
    return engine.execute(this.constructor as any, { data, executionId });
  }

  /**
   * Resume a suspended workflow execution.
   */
  async resume(executionId: string, options?: ResumeOptions<TData>): Promise<WorkflowExecution<TData>> {
    const engine = this.getEngine();
    return engine.resume(this.constructor as any, executionId, options);
  }

  /**
   * Get a workflow execution by ID.
   */
  async getExecution(executionId: string): Promise<WorkflowExecution<TData> | null> {
    const engine = this.getEngine();
    return engine.getExecution(executionId) as Promise<WorkflowExecution<TData> | null>;
  }
}
