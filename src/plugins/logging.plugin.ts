import { IWorkflowPlugin, WorkflowContext, LoggerAdapter } from '../types';

export interface LoggingPluginConfig {
  logger: LoggerAdapter;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  includeContext?: boolean;
}

export class LoggingPlugin implements IWorkflowPlugin {
  name = 'LoggingPlugin';

  constructor(private readonly config: LoggingPluginConfig) {}

  onInit(): void {
    this.config.logger.log(`[${this.name}] Plugin initialized`);
  }

  beforeExecute(context: WorkflowContext): void {
    if (this.shouldLog('debug')) {
      this.config.logger.debug(
        `Executing state: ${String(context.currentState)}`,
        this.config.includeContext ? context : undefined
      );
    }
  }

  afterExecute(context: WorkflowContext): void {
    if (this.shouldLog('debug')) {
      this.config.logger.debug(
        `Completed state: ${String(context.currentState)}`,
        this.config.includeContext ? context : undefined
      );
    }
  }

  onError(context: WorkflowContext, error: Error): void {
    if (this.shouldLog('error')) {
      this.config.logger.error(
        `Error in state: ${String(context.currentState)}`,
        error,
        this.config.includeContext ? context : undefined
      );
    }
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this.config.logLevel || 'info';
    const levelIndex = levels.indexOf(level);
    const configIndex = levels.indexOf(configLevel);

    return levelIndex >= configIndex;
  }
}
