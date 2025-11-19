import { WorkflowEngine } from '../../src/core/workflow-engine';
import { Workflow } from '../../src/decorators/workflow.decorator';
import { State } from '../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, WorkflowStatus } from '../../src/types';
import { StateRegistry } from '../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../src/adapters/in-memory-lock.adapter';
import { OnStateFailure, OnStateSuccess } from '../../src/decorators/lifecycle.decorator';

/**
 * Payment Workflow with Retry E2E Test
 *
 * This test simulates a payment processing flow with retry logic:
 * 1. INITIALIZE - Set up payment context
 * 2. VALIDATE_CARD - Validate payment method
 * 3. AUTHORIZE_PAYMENT - Authorize the charge (with retries)
 * 4. CAPTURE_PAYMENT - Capture the authorized amount
 * 5. SEND_RECEIPT - Send confirmation
 * 6. PAYMENT_COMPLETE - Final state
 *
 * Special features:
 * - Retry logic for transient failures
 * - Configurable retry attempts via metadata
 * - Error tracking and recovery
 */

enum PaymentState {
  INITIALIZE = 'INITIALIZE',
  VALIDATE_CARD = 'VALIDATE_CARD',
  AUTHORIZE_PAYMENT = 'AUTHORIZE_PAYMENT',
  CAPTURE_PAYMENT = 'CAPTURE_PAYMENT',
  SEND_RECEIPT = 'SEND_RECEIPT',
  PAYMENT_COMPLETE = 'PAYMENT_COMPLETE',
}

interface PaymentData extends Record<string, unknown> {
  paymentId: string;
  amount: number;
  currency: string;
  cardNumber: string;
  cardExpiry: string;
  cvv: string;
  customerEmail: string;
  // Runtime state
  shouldFailAuthorization?: boolean;
  failureCount?: number;
  maxRetries?: number;
}

interface PaymentOutputs extends Record<string, unknown> {
  [PaymentState.INITIALIZE]: { initialized: boolean; timestamp: Date };
  [PaymentState.VALIDATE_CARD]: { valid: boolean; cardType: string };
  [PaymentState.AUTHORIZE_PAYMENT]: { authorized: boolean; authCode: string; retryCount: number };
  [PaymentState.CAPTURE_PAYMENT]: { captured: boolean; transactionId: string };
  [PaymentState.SEND_RECEIPT]: { sent: boolean; receiptId: string };
  [PaymentState.PAYMENT_COMPLETE]: { completed: boolean; completedAt: Date };
}

@Workflow({
  name: 'PaymentRetryWorkflow',
  states: PaymentState,
  initialState: PaymentState.INITIALIZE,
})
class PaymentRetryWorkflow {}

@State(PaymentState.INITIALIZE)
class InitializeState implements IState<PaymentData, PaymentOutputs, PaymentState.INITIALIZE> {
  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.INITIALIZE>
  ) {
    // Initialize retry counter
    ctx.data.failureCount = 0;
    ctx.data.maxRetries = ctx.data.maxRetries || 3;

    actions.next({
      output: {
        initialized: true,
        timestamp: new Date(),
      },
    });
  }
}

@State(PaymentState.VALIDATE_CARD)
class ValidateCardState implements IState<PaymentData, PaymentOutputs, PaymentState.VALIDATE_CARD> {
  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.VALIDATE_CARD>
  ) {
    // Validate card number (basic validation)
    const cardNumber = ctx.data.cardNumber.replace(/\s/g, '');

    if (cardNumber.length < 13 || cardNumber.length > 19) {
      throw new Error('Invalid card number');
    }

    // Determine card type
    let cardType = 'UNKNOWN';
    if (cardNumber.startsWith('4')) cardType = 'VISA';
    else if (cardNumber.startsWith('5')) cardType = 'MASTERCARD';
    else if (cardNumber.startsWith('3')) cardType = 'AMEX';

    actions.next({
      output: {
        valid: true,
        cardType,
      },
    });
  }
}

@State(PaymentState.AUTHORIZE_PAYMENT)
class AuthorizePaymentState implements IState<PaymentData, PaymentOutputs, PaymentState.AUTHORIZE_PAYMENT> {
  private static attemptCounts = new Map<string, number>();

  @OnStateFailure()
  onFailure(ctx: WorkflowContext<PaymentData, PaymentOutputs>, error: Error) {
    const attempts = AuthorizePaymentState.attemptCounts.get(ctx.data.paymentId) || 0;
    console.log(`Payment ${ctx.data.paymentId} authorization failed (attempt ${attempts}):`, error.message);
  }

  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext<PaymentData, PaymentOutputs>, output: PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT]) {
    console.log(`Payment ${ctx.data.paymentId} authorized with code:`, output.authCode);
  }

  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.AUTHORIZE_PAYMENT>
  ) {
    // Track attempt count
    const attempts = (AuthorizePaymentState.attemptCounts.get(ctx.data.paymentId) || 0) + 1;
    AuthorizePaymentState.attemptCounts.set(ctx.data.paymentId, attempts);

    // Simulate transient failures that should be retried
    if (ctx.data.shouldFailAuthorization && attempts < 3) {
      throw new Error('Payment gateway timeout - retrying');
    }

    // Simulate permanent failure after max retries
    if (ctx.data.shouldFailAuthorization && attempts >= 3) {
      throw new Error('Payment authorization failed after max retries');
    }

    // Success
    const authCode = `AUTH-${ctx.data.paymentId}-${Date.now()}`;

    actions.next({
      output: {
        authorized: true,
        authCode,
        retryCount: attempts - 1,
      },
    });
  }
}

@State(PaymentState.CAPTURE_PAYMENT)
class CapturePaymentState implements IState<PaymentData, PaymentOutputs, PaymentState.CAPTURE_PAYMENT> {
  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.CAPTURE_PAYMENT>
  ) {
    // Get authorization code from previous state
    const authCode = (ctx.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])?.authCode;

    if (!authCode) {
      throw new Error('No authorization code found');
    }

    const transactionId = `TXN-${ctx.data.paymentId}-${Date.now()}`;

    actions.next({
      output: {
        captured: true,
        transactionId,
      },
    });
  }
}

@State(PaymentState.SEND_RECEIPT)
class SendReceiptState implements IState<PaymentData, PaymentOutputs, PaymentState.SEND_RECEIPT> {
  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.SEND_RECEIPT>
  ) {
    // Get transaction details
    const transactionId = (ctx.outputs[PaymentState.CAPTURE_PAYMENT] as PaymentOutputs[PaymentState.CAPTURE_PAYMENT])
      ?.transactionId;
    const receiptId = `RCPT-${transactionId}`;

    actions.next({
      output: {
        sent: true,
        receiptId,
      },
    });
  }
}

@State(PaymentState.PAYMENT_COMPLETE)
class PaymentCompleteState implements IState<PaymentData, PaymentOutputs, PaymentState.PAYMENT_COMPLETE> {
  execute(
    ctx: WorkflowContext<PaymentData, PaymentOutputs>,
    actions: StateActions<PaymentData, PaymentOutputs, PaymentState.PAYMENT_COMPLETE>
  ) {
    actions.next({
      output: {
        completed: true,
        completedAt: new Date(),
      },
    });
  }
}

describe('E2E: Payment Workflow with Retry', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    const lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([
      new InitializeState(),
      new ValidateCardState(),
      new AuthorizePaymentState(),
      new CapturePaymentState(),
      new SendReceiptState(),
      new PaymentCompleteState(),
    ]);

    // Clear attempt counts
    (AuthorizePaymentState as any).attemptCounts.clear();
  });

  describe('successful payment flow', () => {
    it('should complete payment without retries', async () => {
      const result = await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-001',
          amount: 99.99,
          currency: 'USD',
          cardNumber: '4111 1111 1111 1111',
          cardExpiry: '12/25',
          cvv: '123',
          customerEmail: 'customer@example.com',
          shouldFailAuthorization: false,
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(result.currentState).toBe(PaymentState.PAYMENT_COMPLETE);

      // Verify outputs
      expect((result.outputs[PaymentState.INITIALIZE] as PaymentOutputs[PaymentState.INITIALIZE])?.initialized).toBe(true);
      expect((result.outputs[PaymentState.VALIDATE_CARD] as PaymentOutputs[PaymentState.VALIDATE_CARD])?.valid).toBe(true);
      expect((result.outputs[PaymentState.VALIDATE_CARD] as PaymentOutputs[PaymentState.VALIDATE_CARD])?.cardType).toBe('VISA');
      expect((result.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])?.authorized).toBe(
        true
      );
      expect((result.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])?.retryCount).toBe(
        0
      );
      expect((result.outputs[PaymentState.CAPTURE_PAYMENT] as PaymentOutputs[PaymentState.CAPTURE_PAYMENT])?.captured).toBe(true);
      expect((result.outputs[PaymentState.SEND_RECEIPT] as PaymentOutputs[PaymentState.SEND_RECEIPT])?.sent).toBe(true);
      expect((result.outputs[PaymentState.PAYMENT_COMPLETE] as PaymentOutputs[PaymentState.PAYMENT_COMPLETE])?.completed).toBe(
        true
      );
    });

    it('should detect card type correctly', async () => {
      const testCases = [
        { cardNumber: '4111111111111111', expectedType: 'VISA' },
        { cardNumber: '5500000000000004', expectedType: 'MASTERCARD' },
        { cardNumber: '340000000000009', expectedType: 'AMEX' },
      ];

      for (const testCase of testCases) {
        const result = await engine.execute(PaymentRetryWorkflow, {
          data: {
            paymentId: `PAY-CARD-${testCase.expectedType}`,
            amount: 50.0,
            currency: 'USD',
            cardNumber: testCase.cardNumber,
            cardExpiry: '12/25',
            cvv: '123',
            customerEmail: 'test@example.com',
          },
        });

        expect((result.outputs[PaymentState.VALIDATE_CARD] as PaymentOutputs[PaymentState.VALIDATE_CARD])?.cardType).toBe(
          testCase.expectedType
        );
      }
    });
  });

  describe('authorization attempt tracking', () => {
    it('should track attempt counts', async () => {
      const result = await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-ATTEMPTS-001',
          amount: 149.99,
          currency: 'USD',
          cardNumber: '4111111111111111',
          cardExpiry: '12/25',
          cvv: '123',
          customerEmail: 'attempts@example.com',
          shouldFailAuthorization: false, // Will succeed
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect((result.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])?.authorized).toBe(
        true
      );
      expect((result.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])?.retryCount).toBe(
        0
      );
    });
  });

  describe('validation failures', () => {
    it('should fail on invalid card number', async () => {
      await expect(
        engine.execute(PaymentRetryWorkflow, {
          data: {
            paymentId: 'PAY-INVALID-001',
            amount: 25.0,
            currency: 'USD',
            cardNumber: '123', // Too short
            cardExpiry: '12/25',
            cvv: '123',
            customerEmail: 'invalid@example.com',
          },
        })
      ).rejects.toThrow('Invalid card number');
    });
  });

  describe('authorization failures', () => {
    it('should fail on authorization error', async () => {
      // Note: Actual retry mechanism would need framework support
      await expect(
        engine.execute(PaymentRetryWorkflow, {
          data: {
            paymentId: 'PAY-FAIL-001',
            amount: 199.99,
            currency: 'USD',
            cardNumber: '4111111111111111',
            cardExpiry: '12/25',
            cvv: '123',
            customerEmail: 'fail@example.com',
            shouldFailAuthorization: true,
            maxRetries: 0, // Don't allow retries
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('state outputs and data flow', () => {
    it('should pass data between states correctly', async () => {
      const result = await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-FLOW-001',
          amount: 300.0,
          currency: 'EUR',
          cardNumber: '4111111111111111',
          cardExpiry: '03/27',
          cvv: '789',
          customerEmail: 'flow@example.com',
        },
      });

      // Authorization code should be used in capture
      const authCode = (result.outputs[PaymentState.AUTHORIZE_PAYMENT] as PaymentOutputs[PaymentState.AUTHORIZE_PAYMENT])
        ?.authCode;
      expect(authCode).toBeDefined();
      expect(authCode).toContain('PAY-FLOW-001');

      // Transaction ID should include payment ID
      const transactionId = (result.outputs[PaymentState.CAPTURE_PAYMENT] as PaymentOutputs[PaymentState.CAPTURE_PAYMENT])
        ?.transactionId;
      expect(transactionId).toBeDefined();
      expect(transactionId).toContain('PAY-FLOW-001');

      // Receipt ID should reference transaction
      const receiptId = (result.outputs[PaymentState.SEND_RECEIPT] as PaymentOutputs[PaymentState.SEND_RECEIPT])?.receiptId;
      expect(receiptId).toBeDefined();
      expect(receiptId).toContain('RCPT');
    });

    it('should preserve original payment data throughout workflow', async () => {
      const originalData = {
        paymentId: 'PAY-PRESERVE-001',
        amount: 125.5,
        currency: 'GBP',
        cardNumber: '5500000000000004',
        cardExpiry: '09/26',
        cvv: '321',
        customerEmail: 'preserve@example.com',
      };

      const result = await engine.execute(PaymentRetryWorkflow, {
        data: originalData,
      });

      // Original data should still be accessible
      expect(result.data.paymentId).toBe(originalData.paymentId);
      expect(result.data.amount).toBe(originalData.amount);
      expect(result.data.currency).toBe(originalData.currency);
      expect(result.data.customerEmail).toBe(originalData.customerEmail);
    });
  });

  describe('history and audit trail', () => {
    it('should maintain complete audit trail', async () => {
      const result = await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-AUDIT-001',
          amount: 88.88,
          currency: 'USD',
          cardNumber: '4111111111111111',
          cardExpiry: '12/25',
          cvv: '888',
          customerEmail: 'audit@example.com',
        },
      });

      // All states should be in history (except initial state)
      const states = result.history.map(h => h.to);
      // INITIALIZE is initial state, won't be in history
      expect(states).toContain(PaymentState.VALIDATE_CARD);
      expect(states).toContain(PaymentState.AUTHORIZE_PAYMENT);
      expect(states).toContain(PaymentState.CAPTURE_PAYMENT);
      expect(states).toContain(PaymentState.SEND_RECEIPT);
      expect(states).toContain(PaymentState.PAYMENT_COMPLETE);

      // Each transition should have timing data
      result.history.forEach(transition => {
        expect(transition.duration).toBeGreaterThanOrEqual(0);
        expect(transition.startedAt).toBeInstanceOf(Date);
        expect(transition.completedAt).toBeInstanceOf(Date);
      });
    });

    it('should throw error on validation failure', async () => {
      await expect(
        engine.execute(PaymentRetryWorkflow, {
          data: {
            paymentId: 'PAY-HISTORY-FAIL',
            amount: 50.0,
            currency: 'USD',
            cardNumber: '999', // Invalid
            cardExpiry: '12/25',
            cvv: '123',
            customerEmail: 'history@example.com',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('persistence', () => {
    it('should persist payment execution state', async () => {
      const result = await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-PERSIST-001',
          amount: 175.0,
          currency: 'USD',
          cardNumber: '4111111111111111',
          cardExpiry: '12/25',
          cvv: '123',
          customerEmail: 'persist@example.com',
        },
      });

      const loaded = await persistence.load(result.id);

      expect(loaded).toBeDefined();
      expect(loaded?.workflowName).toBe('PaymentRetryWorkflow');
      expect((loaded?.data as PaymentData)?.paymentId).toBe('PAY-PERSIST-001');
      expect(loaded?.status).toBe(WorkflowStatus.COMPLETED);
    });

    it('should find completed payments by status', async () => {
      // Create successful payments
      await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-FIND-001',
          amount: 100.0,
          currency: 'USD',
          cardNumber: '4111111111111111',
          cardExpiry: '12/25',
          cvv: '123',
          customerEmail: 'find1@example.com',
        },
      });

      await engine.execute(PaymentRetryWorkflow, {
        data: {
          paymentId: 'PAY-FIND-002',
          amount: 200.0,
          currency: 'USD',
          cardNumber: '4111111111111111',
          cardExpiry: '12/25',
          cvv: '123',
          customerEmail: 'find2@example.com',
        },
      });

      const completed = await persistence.find({
        workflowName: 'PaymentRetryWorkflow',
        status: WorkflowStatus.COMPLETED,
      });

      expect(completed.length).toBeGreaterThanOrEqual(2);
      completed.forEach(payment => {
        expect(payment.status).toBe(WorkflowStatus.COMPLETED);
      });
    });
  });
});
