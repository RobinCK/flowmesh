import {
  Workflow,
  State,
  WorkflowContext,
  StateActions,
  OnWorkflowStart,
  OnWorkflowComplete,
  OnWorkflowError,
  BeforeState,
  AfterState,
  OnStateStart,
  OnStateSuccess,
  OnStateFailure,
  OnStateFinish,
  IState,
} from '../../src';

export enum SimpleState {
  A = 'A',
  B = 'B',
  C = 'C',
}

export interface SimpleData {
  value: number;
}

export interface SimpleOutputs {
  [SimpleState.A]: { resultA: string };
  [SimpleState.B]: { resultB: string };
  [SimpleState.C]: { resultC: string };
}

@Workflow({
  name: 'SimpleWorkflow',
  states: SimpleState,
  initialState: SimpleState.A,
})
export class SimpleWorkflow {}

@State(SimpleState.A)
export class StateA implements IState<SimpleData, SimpleOutputs, SimpleState.A> {
  execute(
    ctx: WorkflowContext<SimpleData, SimpleOutputs>,
    actions: StateActions<SimpleData, SimpleOutputs, SimpleState.A>
  ): void {
    actions.next({ output: { resultA: 'A_' + ctx.data.value } });
  }
}

@State(SimpleState.B)
export class StateB implements IState<SimpleData, SimpleOutputs, SimpleState.B> {
  execute(
    ctx: WorkflowContext<SimpleData, SimpleOutputs>,
    actions: StateActions<SimpleData, SimpleOutputs, SimpleState.B>
  ): void {
    actions.next({ output: { resultB: 'B_' + ctx.data.value } });
  }
}

@State(SimpleState.C)
export class StateC implements IState<SimpleData, SimpleOutputs, SimpleState.C> {
  execute(
    ctx: WorkflowContext<SimpleData, SimpleOutputs>,
    actions: StateActions<SimpleData, SimpleOutputs, SimpleState.C>
  ): void {
    actions.next({ output: { resultC: 'C_' + ctx.data.value } });
  }
}
