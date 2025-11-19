import { Test, TestingModule } from '@nestjs/testing';
import { Injectable, Module } from '@nestjs/common';
import { FlowMeshModule } from '../../../src/nestjs/flowmesh.module';
import { ExecutableWorkflow } from '../../../src/core/executable-workflow';
import { Workflow } from '../../../src/decorators/workflow.decorator';
import { WorkflowConfig } from '../../../src/decorators/workflow-config.decorator';
import { State } from '../../../src/decorators/state.decorator';
import { RegisterWorkflows } from '../../../src/decorators/register-workflows.decorator';
import { StateRegistry } from '../../../src/core/state-registry';
import { WorkflowContext, StateActions, IState, WorkflowStatus } from '../../../src/types';

// Test services
@Injectable()
class DataService {
  getData(id: string): string {
    return `Data for ${id}`;
  }
}

@Injectable()
class ProcessingService {
  process(data: string): string {
    return `Processed: ${data}`;
  }
}

// Workflow enums
enum SimpleWorkflowState {
  START = 'START',
  PROCESS = 'PROCESS',
  COMPLETE = 'COMPLETE',
}

// Workflow data interfaces
interface SimpleData extends Record<string, unknown> {
  id: string;
  value: string;
}

interface SimpleOutputs extends Record<string, unknown> {
  START: { started: boolean };
  PROCESS: { processed: string };
  COMPLETE: { completed: boolean };
}

// States
@State(SimpleWorkflowState.START)
@Injectable()
class StartState implements IState<SimpleData, SimpleOutputs> {
  execute(ctx: WorkflowContext<SimpleData, SimpleOutputs>, actions: StateActions<SimpleData, SimpleOutputs, any>) {
    actions.next({ output: { started: true } });
  }
}

@State(SimpleWorkflowState.PROCESS)
@Injectable()
class ProcessState implements IState<SimpleData, SimpleOutputs> {
  constructor(private readonly processingService: ProcessingService) {}

  execute(ctx: WorkflowContext<SimpleData, SimpleOutputs>, actions: StateActions<SimpleData, SimpleOutputs, any>) {
    const result = this.processingService.process(ctx.data.value);
    actions.next({ output: { processed: result } });
  }
}

@State(SimpleWorkflowState.COMPLETE)
@Injectable()
class CompleteState implements IState<SimpleData, SimpleOutputs> {
  execute(ctx: WorkflowContext<SimpleData, SimpleOutputs>, actions: StateActions<SimpleData, SimpleOutputs, any>) {
    actions.complete({ output: { completed: true } });
  }
}

// Workflow
@Workflow({
  name: 'SimpleWorkflow',
  states: SimpleWorkflowState,
  initialState: SimpleWorkflowState.START,
  transitions: [
    { from: [SimpleWorkflowState.START], to: SimpleWorkflowState.PROCESS },
    { from: [SimpleWorkflowState.PROCESS], to: SimpleWorkflowState.COMPLETE },
  ],
})
@WorkflowConfig({})
@Injectable()
class SimpleWorkflow extends ExecutableWorkflow<SimpleData> {
  constructor(private readonly dataService: DataService) {
    super();
  }
}

// Test module
@Module({
  imports: [FlowMeshModule],
  providers: [DataService, ProcessingService, SimpleWorkflow, StartState, ProcessState, CompleteState],
  exports: [SimpleWorkflow],
})
@RegisterWorkflows([SimpleWorkflow])
class TestWorkflowModule {}

describe('Integration: ExecutableWorkflow with NestJS DI', () => {
  let module: TestingModule;
  let workflow: SimpleWorkflow;
  let dataService: DataService;
  let processingService: ProcessingService;

  beforeEach(async () => {
    StateRegistry.clear();

    module = await Test.createTestingModule({
      imports: [TestWorkflowModule],
    }).compile();

    await module.init();

    workflow = module.get<SimpleWorkflow>(SimpleWorkflow);
    dataService = module.get<DataService>(DataService);
    processingService = module.get<ProcessingService>(ProcessingService);
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should create workflow instance with DI', () => {
    expect(workflow).toBeDefined();
    expect(workflow).toBeInstanceOf(ExecutableWorkflow);
    expect((workflow as any).dataService).toBeDefined();
  });

  it('should execute workflow with injected services', async () => {
    const result = await workflow.execute({
      id: '123',
      value: 'test data',
    });

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.currentState).toBe(SimpleWorkflowState.COMPLETE);
    expect(result.outputs[SimpleWorkflowState.START]).toEqual({ started: true });
    expect(result.outputs[SimpleWorkflowState.PROCESS]).toEqual({
      processed: 'Processed: test data',
    });
    expect(result.outputs[SimpleWorkflowState.COMPLETE]).toEqual({ completed: true });
  });

  it('should inject services into state classes', () => {
    const processState = module.get<ProcessState>(ProcessState);
    expect(processState).toBeDefined();
    expect((processState as any).processingService).toBe(processingService);
  });

  it('should use workflow execute method', async () => {
    // Execute
    const execution = await workflow.execute({
      id: '456',
      value: 'another test',
    });

    expect(execution.id).toBeDefined();
    expect(execution.status).toBe(WorkflowStatus.COMPLETED);
    expect(execution.outputs[SimpleWorkflowState.PROCESS]).toEqual({
      processed: 'Processed: another test',
    });
  });
});
