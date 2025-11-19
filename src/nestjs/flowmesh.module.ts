import { Global, Module, DynamicModule, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef, DiscoveryService, DiscoveryModule } from '@nestjs/core';
import { ExecutableWorkflow } from '../core/executable-workflow';
import { StateRegistry } from '../core/state-registry';
import { getStateMetadata } from '../decorators/state.decorator';
import { getRegisteredWorkflows } from '../decorators/register-workflows.decorator';

export interface FlowMeshModuleOptions {
  isGlobal?: boolean;
}

export const FLOWMESH_MODULE_REF = Symbol('FLOWMESH_MODULE_REF');

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    {
      provide: FLOWMESH_MODULE_REF,
      useFactory: (moduleRef: ModuleRef) => {
        return <T>(classType: new (...args: any[]) => T): T => {
          try {
            return moduleRef.get(classType, { strict: false });
          } catch {
            return new classType();
          }
        };
      },
      inject: [ModuleRef],
    },
  ],
  exports: [FLOWMESH_MODULE_REF],
})
export class FlowMeshModule implements OnApplicationBootstrap {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly discoveryService: DiscoveryService
  ) {}

  async onApplicationBootstrap() {
    const instanceFactory = this.moduleRef.get(FLOWMESH_MODULE_REF, { strict: false });

    const stateProviders = this.discoveryService
      .getProviders()
      .filter(wrapper => {
        if (!wrapper.metatype || !wrapper.instance) {
          return false;
        }

        try {
          const metadata = getStateMetadata(wrapper.metatype);

          return metadata !== undefined;
        } catch {
          return false;
        }
      })
      .map(wrapper => wrapper.instance)
      .filter(instance => instance != null);

    if (stateProviders.length > 0) {
      StateRegistry.autoRegister(stateProviders);
    }

    const registeredWorkflows = new Set<new (...args: any[]) => ExecutableWorkflow>();

    const modules = this.discoveryService
      .getProviders()
      .map(wrapper => wrapper.host?.metatype)
      .filter(metatype => metatype != null);

    for (const moduleClass of modules) {
      const workflows = getRegisteredWorkflows(moduleClass);

      if (workflows) {
        workflows.forEach(wf => registeredWorkflows.add(wf));
      }
    }

    for (const WorkflowClass of registeredWorkflows) {
      try {
        const workflowInstance = this.moduleRef.get(WorkflowClass, { strict: false });

        if (workflowInstance instanceof ExecutableWorkflow) {
          workflowInstance.setInstanceFactory(instanceFactory);
        }
      } catch {
        // Workflow not found in container
      }
    }

    const workflowProviders = this.discoveryService
      .getProviders()
      .filter(wrapper => wrapper.instance instanceof ExecutableWorkflow)
      .map(wrapper => wrapper.instance as ExecutableWorkflow);

    for (const workflow of workflowProviders) {
      if (!workflow['instanceFactory']) {
        workflow.setInstanceFactory(instanceFactory);
      }
    }
  }

  static configure(options: FlowMeshModuleOptions = {}): DynamicModule {
    return {
      module: FlowMeshModule,
      global: options.isGlobal !== false,
    };
  }
}
