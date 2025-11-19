import 'reflect-metadata';
import { WorkflowConfigOptions } from '../types';

export const WORKFLOW_CONFIG_KEY = Symbol.for('flowmesh:workflow:config');

export function WorkflowConfig(options: WorkflowConfigOptions): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(WORKFLOW_CONFIG_KEY, options, target);
    Reflect.defineMetadata(WORKFLOW_CONFIG_KEY, options, target.prototype);
  };
}

export function getWorkflowConfig(target: any): WorkflowConfigOptions | undefined {
  return Reflect.getMetadata(WORKFLOW_CONFIG_KEY, target) || Reflect.getMetadata(WORKFLOW_CONFIG_KEY, target.prototype);
}
