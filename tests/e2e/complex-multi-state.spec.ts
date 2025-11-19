import { WorkflowEngine } from '../../src/core/workflow-engine';
import { Workflow } from '../../src/decorators/workflow.decorator';
import { State, UnlockAfter } from '../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus, ConcurrencyMode } from '../../src/types';
import { StateRegistry } from '../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../src/adapters/in-memory-lock.adapter';
import { OnStateStart, OnStateSuccess, OnWorkflowComplete } from '../../src/decorators/lifecycle.decorator';

/**
 * Complex Multi-State Scenarios E2E Test
 *
 * This test demonstrates advanced workflow patterns:
 * 1. Conditional branching based on data
 * 2. Dynamic state transitions (goto)
 * 3. Suspend and resume mid-workflow
 * 4. Partial unlock with throttle mode
 * 5. Complex state dependencies
 * 6. Multi-step approval process
 */

enum ApprovalState {
  SUBMIT_REQUEST = 'SUBMIT_REQUEST',
  AUTO_APPROVE_CHECK = 'AUTO_APPROVE_CHECK',
  MANAGER_REVIEW = 'MANAGER_REVIEW',
  DIRECTOR_REVIEW = 'DIRECTOR_REVIEW',
  FINANCE_REVIEW = 'FINANCE_REVIEW',
  WAIT_FOR_SIGNATURE = 'WAIT_FOR_SIGNATURE',
  PROCESS_APPROVAL = 'PROCESS_APPROVAL',
  SEND_NOTIFICATION = 'SEND_NOTIFICATION',
  REQUEST_COMPLETED = 'REQUEST_COMPLETED',
}

interface ApprovalData extends Record<string, unknown> {
  requestId: string;
  requestType: 'expense' | 'purchase' | 'contract';
  amount: number;
  submittedBy: string;
  // Approval state
  managerApproved?: boolean;
  directorApproved?: boolean;
  financeApproved?: boolean;
  signatureReceived?: boolean;
  autoApprovalEligible?: boolean;
  // Tracking
  approvalPath: string[];
  rejectionReason?: string;
}

interface ApprovalOutputs extends Record<string, unknown> {
  [ApprovalState.SUBMIT_REQUEST]: { submitted: boolean; timestamp: Date };
  [ApprovalState.AUTO_APPROVE_CHECK]: { autoApproved: boolean; reason: string };
  [ApprovalState.MANAGER_REVIEW]: { approved: boolean; reviewedBy: string };
  [ApprovalState.DIRECTOR_REVIEW]: { approved: boolean; reviewedBy: string };
  [ApprovalState.FINANCE_REVIEW]: { approved: boolean; reviewedBy: string };
  [ApprovalState.WAIT_FOR_SIGNATURE]: { waiting: boolean; requestedAt: Date };
  [ApprovalState.PROCESS_APPROVAL]: { processed: boolean; approvalId: string };
  [ApprovalState.SEND_NOTIFICATION]: { sent: boolean; recipients: string[] };
  [ApprovalState.REQUEST_COMPLETED]: { completed: boolean; finalStatus: string };
}

@Workflow({
  name: 'ComplexApprovalWorkflow',
  states: ApprovalState,
  initialState: ApprovalState.SUBMIT_REQUEST,
  concurrency: {
    groupBy: 'requestId',
    mode: ConcurrencyMode.THROTTLE,
    maxConcurrentAfterUnlock: 5,
  },
  conditionalTransitions: [
    {
      from: ApprovalState.AUTO_APPROVE_CHECK,
      conditions: [
        {
          condition: ctx => ctx.data.autoApprovalEligible === true,
          to: ApprovalState.PROCESS_APPROVAL,
        },
      ],
      default: ApprovalState.MANAGER_REVIEW,
    },
    {
      from: ApprovalState.MANAGER_REVIEW,
      conditions: [
        {
          condition: ctx => ctx.data.managerApproved === false,
          to: ApprovalState.REQUEST_COMPLETED, // Reject
        },
        {
          condition: ctx => (ctx.data as ApprovalData).amount > 10000,
          to: ApprovalState.DIRECTOR_REVIEW, // Escalate
        },
      ],
      default: ApprovalState.FINANCE_REVIEW,
    },
    {
      from: ApprovalState.DIRECTOR_REVIEW,
      conditions: [
        {
          condition: ctx => ctx.data.directorApproved === false,
          to: ApprovalState.REQUEST_COMPLETED, // Reject
        },
      ],
      default: ApprovalState.FINANCE_REVIEW,
    },
    {
      from: ApprovalState.FINANCE_REVIEW,
      conditions: [
        {
          condition: ctx => ctx.data.financeApproved === false,
          to: ApprovalState.REQUEST_COMPLETED, // Reject
        },
        {
          condition: ctx => ctx.data.requestType === 'contract',
          to: ApprovalState.WAIT_FOR_SIGNATURE,
        },
      ],
      default: ApprovalState.PROCESS_APPROVAL,
    },
  ],
})
class ComplexApprovalWorkflow {}

// States with lifecycle hooks to track approval path
@State(ApprovalState.SUBMIT_REQUEST)
class SubmitRequestState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.SUBMIT_REQUEST> {
  @OnStateStart()
  onStart(ctx: WorkflowContext<ApprovalData, ApprovalOutputs>) {
    ctx.data.approvalPath = [];
  }

  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.SUBMIT_REQUEST>
  ) {
    ctx.data.approvalPath.push('SUBMITTED');

    actions.next({
      output: {
        submitted: true,
        timestamp: new Date(),
      },
    });
  }
}

@State(ApprovalState.AUTO_APPROVE_CHECK)
@UnlockAfter() // Release lock - other requests can proceed
class AutoApproveCheckState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.AUTO_APPROVE_CHECK> {
  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.AUTO_APPROVE_CHECK>
  ) {
    // Check if request qualifies for auto-approval
    const isExpense = ctx.data.requestType === 'expense';
    const isSmallAmount = ctx.data.amount < 500;
    const autoApproved = isExpense && isSmallAmount;

    ctx.data.autoApprovalEligible = autoApproved;

    if (autoApproved) {
      ctx.data.approvalPath.push('AUTO_APPROVED');
    }

    actions.next({
      output: {
        autoApproved,
        reason: autoApproved ? 'Small expense under $500' : 'Requires manual review',
      },
    });
  }
}

@State(ApprovalState.MANAGER_REVIEW)
class ManagerReviewState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.MANAGER_REVIEW> {
  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext<ApprovalData, ApprovalOutputs>, output: ApprovalOutputs[ApprovalState.MANAGER_REVIEW]) {
    ctx.data.approvalPath.push(`MANAGER_${output.approved ? 'APPROVED' : 'REJECTED'}`);
  }

  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.MANAGER_REVIEW>
  ) {
    // Simulate manager approval (based on data)
    const approved = ctx.data.managerApproved !== false; // Default approve unless explicitly rejected

    if (!approved) {
      ctx.data.rejectionReason = 'Rejected by manager';
    }

    actions.next({
      output: {
        approved,
        reviewedBy: 'manager@company.com',
      },
    });
  }
}

@State(ApprovalState.DIRECTOR_REVIEW)
class DirectorReviewState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.DIRECTOR_REVIEW> {
  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext<ApprovalData, ApprovalOutputs>, output: ApprovalOutputs[ApprovalState.DIRECTOR_REVIEW]) {
    ctx.data.approvalPath.push(`DIRECTOR_${output.approved ? 'APPROVED' : 'REJECTED'}`);
  }

  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.DIRECTOR_REVIEW>
  ) {
    const approved = ctx.data.directorApproved !== false;

    if (!approved) {
      ctx.data.rejectionReason = 'Rejected by director';
    }

    actions.next({
      output: {
        approved,
        reviewedBy: 'director@company.com',
      },
    });
  }
}

@State(ApprovalState.FINANCE_REVIEW)
class FinanceReviewState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.FINANCE_REVIEW> {
  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext<ApprovalData, ApprovalOutputs>, output: ApprovalOutputs[ApprovalState.FINANCE_REVIEW]) {
    ctx.data.approvalPath.push(`FINANCE_${output.approved ? 'APPROVED' : 'REJECTED'}`);
  }

  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.FINANCE_REVIEW>
  ) {
    const approved = ctx.data.financeApproved !== false;

    if (!approved) {
      ctx.data.rejectionReason = 'Rejected by finance';
    }

    actions.next({
      output: {
        approved,
        reviewedBy: 'finance@company.com',
      },
    });
  }
}

@State(ApprovalState.WAIT_FOR_SIGNATURE)
class WaitForSignatureState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.WAIT_FOR_SIGNATURE> {
  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.WAIT_FOR_SIGNATURE>
  ) {
    ctx.data.approvalPath.push('WAITING_SIGNATURE');

    // If signature not received, suspend workflow
    if (!ctx.data.signatureReceived) {
      actions.suspend({
        waitingFor: 'contract_signature',
        output: {
          waiting: true,
          requestedAt: new Date(),
        },
      });
    } else {
      actions.next({
        output: {
          waiting: false,
          requestedAt: new Date(),
        },
      });
    }
  }
}

@State(ApprovalState.PROCESS_APPROVAL)
class ProcessApprovalState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.PROCESS_APPROVAL> {
  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.PROCESS_APPROVAL>
  ) {
    ctx.data.approvalPath.push('PROCESSED');

    const approvalId = `APP-${ctx.data.requestId}-${Date.now()}`;

    actions.next({
      output: {
        processed: true,
        approvalId,
      },
    });
  }
}

@State(ApprovalState.SEND_NOTIFICATION)
class SendNotificationState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.SEND_NOTIFICATION> {
  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.SEND_NOTIFICATION>
  ) {
    const recipients = [ctx.data.submittedBy];

    // Add approvers to notification list
    if (ctx.outputs[ApprovalState.MANAGER_REVIEW]) {
      recipients.push('manager@company.com');
    }
    if (ctx.outputs[ApprovalState.DIRECTOR_REVIEW]) {
      recipients.push('director@company.com');
    }
    if (ctx.outputs[ApprovalState.FINANCE_REVIEW]) {
      recipients.push('finance@company.com');
    }

    actions.next({
      output: {
        sent: true,
        recipients,
      },
    });
  }
}

@State(ApprovalState.REQUEST_COMPLETED)
class RequestCompletedState implements IState<ApprovalData, ApprovalOutputs, ApprovalState.REQUEST_COMPLETED> {
  @OnWorkflowComplete()
  onComplete(ctx: WorkflowContext<ApprovalData, ApprovalOutputs>) {
    console.log(`Request ${ctx.data.requestId} completed. Path:`, ctx.data.approvalPath);
  }

  execute(
    ctx: WorkflowContext<ApprovalData, ApprovalOutputs>,
    actions: StateActions<ApprovalData, ApprovalOutputs, ApprovalState.REQUEST_COMPLETED>
  ) {
    const finalStatus = ctx.data.rejectionReason ? 'REJECTED' : 'APPROVED';
    ctx.data.approvalPath.push(finalStatus);

    actions.next({
      output: {
        completed: true,
        finalStatus,
      },
    });
  }
}

describe('E2E: Complex Multi-State Scenarios', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    const lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([
      new SubmitRequestState(),
      new AutoApproveCheckState(),
      new ManagerReviewState(),
      new DirectorReviewState(),
      new FinanceReviewState(),
      new WaitForSignatureState(),
      new ProcessApprovalState(),
      new SendNotificationState(),
      new RequestCompletedState(),
    ]);
  });

  describe('auto-approval path', () => {
    it('should auto-approve small expenses', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-001',
          requestType: 'expense' as const,
          amount: 250,
          submittedBy: 'employee@company.com',
          approvalPath: [],
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(
        (result.outputs[ApprovalState.AUTO_APPROVE_CHECK] as ApprovalOutputs[ApprovalState.AUTO_APPROVE_CHECK])?.autoApproved
      ).toBe(true);

      // Should skip manual review states
      const states = result.history.map(h => h.to);
      expect(states).toContain(ApprovalState.AUTO_APPROVE_CHECK);
      expect(states).toContain(ApprovalState.PROCESS_APPROVAL);
      expect(states).not.toContain(ApprovalState.MANAGER_REVIEW);

      // Check approval path
      expect((result.data as ApprovalData).approvalPath).toContain('AUTO_APPROVED');
      expect((result.data as ApprovalData).approvalPath).toContain('PROCESSED');
    });
  });

  describe('manager review path', () => {
    it('should route through manager for larger expenses', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-002',
          requestType: 'expense' as const,
          amount: 2500,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          financeApproved: true,
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);

      const states = result.history.map(h => h.to);
      expect(states).toContain(ApprovalState.MANAGER_REVIEW);
      expect(states).toContain(ApprovalState.FINANCE_REVIEW);
      expect(states).not.toContain(ApprovalState.DIRECTOR_REVIEW); // Amount < 10000

      expect((result.data as ApprovalData).approvalPath).toContain('MANAGER_APPROVED');
      expect((result.data as ApprovalData).approvalPath).toContain('FINANCE_APPROVED');
    });

    it('should reject when manager rejects', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-003',
          requestType: 'purchase' as const,
          amount: 5000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: false,
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(
        (result.outputs[ApprovalState.REQUEST_COMPLETED] as ApprovalOutputs[ApprovalState.REQUEST_COMPLETED])?.finalStatus
      ).toBe('REJECTED');
      expect((result.data as ApprovalData).rejectionReason).toBe('Rejected by manager');

      // Should not reach finance review
      const states = result.history.map(h => h.to);
      expect(states).not.toContain(ApprovalState.FINANCE_REVIEW);
    });
  });

  describe('director escalation path', () => {
    it('should escalate to director for large amounts', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-004',
          requestType: 'purchase' as const,
          amount: 25000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          directorApproved: true,
          financeApproved: true,
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);

      const states = result.history.map(h => h.to);
      expect(states).toContain(ApprovalState.MANAGER_REVIEW);
      expect(states).toContain(ApprovalState.DIRECTOR_REVIEW);
      expect(states).toContain(ApprovalState.FINANCE_REVIEW);

      expect((result.data as ApprovalData).approvalPath).toContain('MANAGER_APPROVED');
      expect((result.data as ApprovalData).approvalPath).toContain('DIRECTOR_APPROVED');
      expect((result.data as ApprovalData).approvalPath).toContain('FINANCE_APPROVED');
    });

    it('should reject when director rejects', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-005',
          requestType: 'purchase' as const,
          amount: 50000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          directorApproved: false,
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(
        (result.outputs[ApprovalState.REQUEST_COMPLETED] as ApprovalOutputs[ApprovalState.REQUEST_COMPLETED])?.finalStatus
      ).toBe('REJECTED');
      expect((result.data as ApprovalData).rejectionReason).toBe('Rejected by director');
    });
  });

  describe('suspend and resume for contracts', () => {
    it('should suspend waiting for signature', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-006',
          requestType: 'contract' as const,
          amount: 15000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          directorApproved: true,
          financeApproved: true,
          signatureReceived: false, // Will suspend
        },
      });

      expect(result.status).toBe(WorkflowStatus.SUSPENDED);
      expect(result.currentState).toBe(ApprovalState.WAIT_FOR_SIGNATURE);
      expect(result.suspension?.waitingFor).toBe('contract_signature');

      expect((result.data as ApprovalData).approvalPath).toContain('WAITING_SIGNATURE');
    });

    it('should resume and complete after signature received', async () => {
      // First, suspend
      const suspended = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-007',
          requestType: 'contract' as const,
          amount: 20000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          directorApproved: true,
          financeApproved: true,
          signatureReceived: false,
        },
      });

      expect(suspended.status).toBe(WorkflowStatus.SUSPENDED);

      // Update data to simulate signature received
      await persistence.update(suspended.id, {
        data: {
          ...suspended.data,
          signatureReceived: true,
        },
      });

      // Resume
      const resumed = await engine.resume(ComplexApprovalWorkflow, suspended.id);

      expect(resumed.status).toBe(WorkflowStatus.COMPLETED);
      expect(
        (resumed.outputs[ApprovalState.PROCESS_APPROVAL] as ApprovalOutputs[ApprovalState.PROCESS_APPROVAL])?.processed
      ).toBe(true);
      expect(
        (resumed.outputs[ApprovalState.REQUEST_COMPLETED] as ApprovalOutputs[ApprovalState.REQUEST_COMPLETED])?.finalStatus
      ).toBe('APPROVED');

      // Should have complete path
      expect((resumed.data as ApprovalData).approvalPath).toContain('WAITING_SIGNATURE');
      expect((resumed.data as ApprovalData).approvalPath).toContain('PROCESSED');
      expect((resumed.data as ApprovalData).approvalPath).toContain('APPROVED');
    });
  });

  describe('approval path tracking', () => {
    it('should track complete approval path', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-008',
          requestType: 'purchase' as const,
          amount: 8000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          financeApproved: true,
        },
      });

      expect((result.data as ApprovalData).approvalPath).toEqual([
        'SUBMITTED',
        'MANAGER_APPROVED',
        'FINANCE_APPROVED',
        'PROCESSED',
        'APPROVED',
      ]);
    });

    it('should track rejection path', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-009',
          requestType: 'purchase' as const,
          amount: 3000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          financeApproved: false,
        },
      });

      expect((result.data as ApprovalData).approvalPath).toContain('SUBMITTED');
      expect((result.data as ApprovalData).approvalPath).toContain('MANAGER_APPROVED');
      expect((result.data as ApprovalData).approvalPath).toContain('FINANCE_REJECTED');
      expect((result.data as ApprovalData).approvalPath).toContain('REJECTED');
    });
  });

  describe('notification handling', () => {
    it('should notify all approvers involved', async () => {
      const result = await engine.execute(ComplexApprovalWorkflow, {
        data: {
          requestId: 'REQ-010',
          requestType: 'purchase' as const,
          amount: 30000,
          submittedBy: 'employee@company.com',
          approvalPath: [],
          managerApproved: true,
          directorApproved: true,
          financeApproved: true,
        },
      });

      const recipients = (result.outputs[ApprovalState.SEND_NOTIFICATION] as ApprovalOutputs[ApprovalState.SEND_NOTIFICATION])
        ?.recipients;
      expect(recipients).toContain('employee@company.com');
      expect(recipients).toContain('manager@company.com');
      expect(recipients).toContain('director@company.com');
      expect(recipients).toContain('finance@company.com');
    });
  });

  describe('throttle mode concurrency', () => {
    it('should allow multiple requests with throttle limit', async () => {
      // Submit 3 requests concurrently
      const results = await Promise.all([
        engine.execute(ComplexApprovalWorkflow, {
          data: {
            requestId: 'REQ-THROTTLE-1',
            requestType: 'expense' as const,
            amount: 100,
            submittedBy: 'user1@company.com',
            approvalPath: [],
          },
        }),
        engine.execute(ComplexApprovalWorkflow, {
          data: {
            requestId: 'REQ-THROTTLE-2',
            requestType: 'expense' as const,
            amount: 200,
            submittedBy: 'user2@company.com',
            approvalPath: [],
          },
        }),
        engine.execute(ComplexApprovalWorkflow, {
          data: {
            requestId: 'REQ-THROTTLE-3',
            requestType: 'expense' as const,
            amount: 300,
            submittedBy: 'user3@company.com',
            approvalPath: [],
          },
        }),
      ]);

      // All should succeed (different request IDs, throttle limit not exceeded)
      results.forEach(result => {
        expect(result.status).toBe(WorkflowStatus.COMPLETED);
      });
    });
  });
});
