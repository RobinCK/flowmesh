import 'reflect-metadata';

export const WORKFLOW_ON_START_KEY = Symbol.for('flowmesh:workflow:onStart');
export const WORKFLOW_ON_COMPLETE_KEY = Symbol.for('flowmesh:workflow:onComplete');
export const WORKFLOW_ON_ERROR_KEY = Symbol.for('flowmesh:workflow:onError');
export const WORKFLOW_BEFORE_STATE_KEY = Symbol.for('flowmesh:workflow:beforeState');
export const WORKFLOW_AFTER_STATE_KEY = Symbol.for('flowmesh:workflow:afterState');

export const STATE_ON_START_KEY = Symbol.for('flowmesh:state:onStart');
export const STATE_ON_SUCCESS_KEY = Symbol.for('flowmesh:state:onSuccess');
export const STATE_ON_FAILURE_KEY = Symbol.for('flowmesh:state:onFailure');
export const STATE_ON_FINISH_KEY = Symbol.for('flowmesh:state:onFinish');

export function OnWorkflowStart(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(WORKFLOW_ON_START_KEY, propertyKey, target.constructor);
  };
}

export function OnWorkflowComplete(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(WORKFLOW_ON_COMPLETE_KEY, propertyKey, target.constructor);
  };
}

export function OnWorkflowError(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(WORKFLOW_ON_ERROR_KEY, propertyKey, target.constructor);
  };
}

export function BeforeState(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(WORKFLOW_BEFORE_STATE_KEY, propertyKey, target.constructor);
  };
}

export function AfterState(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(WORKFLOW_AFTER_STATE_KEY, propertyKey, target.constructor);
  };
}

export function OnStateStart(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(STATE_ON_START_KEY, propertyKey, target.constructor);
  };
}

export function OnStateSuccess(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(STATE_ON_SUCCESS_KEY, propertyKey, target.constructor);
  };
}

export function OnStateFailure(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(STATE_ON_FAILURE_KEY, propertyKey, target.constructor);
  };
}

export function OnStateFinish(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata(STATE_ON_FINISH_KEY, propertyKey, target.constructor);
  };
}

export function getWorkflowOnStart(target: any): string | symbol | undefined {
  return Reflect.getMetadata(WORKFLOW_ON_START_KEY, target);
}

export function getWorkflowOnComplete(target: any): string | symbol | undefined {
  return Reflect.getMetadata(WORKFLOW_ON_COMPLETE_KEY, target);
}

export function getWorkflowOnError(target: any): string | symbol | undefined {
  return Reflect.getMetadata(WORKFLOW_ON_ERROR_KEY, target);
}

export function getWorkflowBeforeState(target: any): string | symbol | undefined {
  return Reflect.getMetadata(WORKFLOW_BEFORE_STATE_KEY, target);
}

export function getWorkflowAfterState(target: any): string | symbol | undefined {
  return Reflect.getMetadata(WORKFLOW_AFTER_STATE_KEY, target);
}

export function getStateOnStart(target: any): string | symbol | undefined {
  return Reflect.getMetadata(STATE_ON_START_KEY, target);
}

export function getStateOnSuccess(target: any): string | symbol | undefined {
  return Reflect.getMetadata(STATE_ON_SUCCESS_KEY, target);
}

export function getStateOnFailure(target: any): string | symbol | undefined {
  return Reflect.getMetadata(STATE_ON_FAILURE_KEY, target);
}

export function getStateOnFinish(target: any): string | symbol | undefined {
  return Reflect.getMetadata(STATE_ON_FINISH_KEY, target);
}
