import { WorkflowContext } from './context.types';

export interface IWorkflowPlugin {
  name: string;

  onInit?(): Promise<void> | void;

  beforeExecute?(context: WorkflowContext): Promise<void> | void;

  afterExecute?(context: WorkflowContext): Promise<void> | void;

  onError?(context: WorkflowContext, error: Error): Promise<void> | void;

  extendContext?(context: WorkflowContext): WorkflowContext | Promise<WorkflowContext>;
}
