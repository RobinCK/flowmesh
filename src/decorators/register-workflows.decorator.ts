import 'reflect-metadata';

export const REGISTERED_WORKFLOWS_KEY = Symbol.for('flowmesh:registered:workflows');

export function RegisterWorkflows(workflows: Array<new (...args: any[]) => any>): ClassDecorator {
  return (target: any) => {
    Reflect.defineMetadata(REGISTERED_WORKFLOWS_KEY, workflows, target);
  };
}

export function getRegisteredWorkflows(target: any): Array<new (...args: any[]) => any> | undefined {
  return Reflect.getMetadata(REGISTERED_WORKFLOWS_KEY, target);
}
