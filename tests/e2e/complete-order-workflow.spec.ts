import { WorkflowEngine } from '../../src/core/workflow-engine';
import { Workflow } from '../../src/decorators/workflow.decorator';
import { State, UnlockAfter } from '../../src/decorators/state.decorator';
import { WorkflowContext, StateActions, IState, ConcurrencyMode, WorkflowStatus } from '../../src/types';
import { StateRegistry } from '../../src/core/state-registry';
import { InMemoryPersistenceAdapter } from '../../src/adapters/in-memory-persistence.adapter';
import { InMemoryLockAdapter } from '../../src/adapters/in-memory-lock.adapter';
import { OnStateSuccess } from '../../src/decorators/lifecycle.decorator';

/**
 * Complete Order Workflow E2E Test
 *
 * This test simulates a realistic e-commerce order flow:
 * 1. CREATE_ORDER - Initialize order
 * 2. VALIDATE_INVENTORY - Check product availability
 * 3. PROCESS_PAYMENT - Handle payment (with unlock after)
 * 4. RESERVE_INVENTORY - Lock inventory items
 * 5. SEND_CONFIRMATION - Notify customer
 * 6. PREPARE_SHIPMENT - Prepare for shipping
 * 7. SHIP_ORDER - Ship the order
 * 8. ORDER_COMPLETED - Final state
 */

enum OrderState {
  CREATE_ORDER = 'CREATE_ORDER',
  VALIDATE_INVENTORY = 'VALIDATE_INVENTORY',
  PROCESS_PAYMENT = 'PROCESS_PAYMENT',
  RESERVE_INVENTORY = 'RESERVE_INVENTORY',
  SEND_CONFIRMATION = 'SEND_CONFIRMATION',
  PREPARE_SHIPMENT = 'PREPARE_SHIPMENT',
  SHIP_ORDER = 'SHIP_ORDER',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
}

interface OrderData extends Record<string, unknown> {
  orderId: string;
  customerId: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
  total: number;
  paymentMethod: 'credit_card' | 'paypal';
  shippingAddress: {
    street: string;
    city: string;
    zipCode: string;
  };
  // Runtime state
  inventoryAvailable?: boolean;
  paymentId?: string;
  confirmationEmail?: string;
  trackingNumber?: string;
}

interface OrderOutputs extends Record<string, unknown> {
  [OrderState.CREATE_ORDER]: { orderId: string; createdAt: Date };
  [OrderState.VALIDATE_INVENTORY]: { available: boolean; reservationId?: string };
  [OrderState.PROCESS_PAYMENT]: { paymentId: string; amount: number };
  [OrderState.RESERVE_INVENTORY]: { reserved: boolean; items: string[] };
  [OrderState.SEND_CONFIRMATION]: { emailSent: boolean; confirmationId: string };
  [OrderState.PREPARE_SHIPMENT]: { prepared: boolean; warehouseId: string };
  [OrderState.SHIP_ORDER]: { shipped: boolean; trackingNumber: string };
  [OrderState.ORDER_COMPLETED]: { completed: boolean; completedAt: Date };
}

@Workflow({
  name: 'CompleteOrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATE_ORDER,
  concurrency: {
    groupBy: 'orderId',
    mode: ConcurrencyMode.SEQUENTIAL,
  },
})
class CompleteOrderWorkflow {}

@State(OrderState.CREATE_ORDER)
class CreateOrderState implements IState<OrderData, OrderOutputs, OrderState.CREATE_ORDER> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.CREATE_ORDER>
  ) {
    // Validate order data
    if (!ctx.data.items || ctx.data.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    actions.next({
      output: {
        orderId: ctx.data.orderId,
        createdAt: new Date(),
      },
    });
  }
}

@State(OrderState.VALIDATE_INVENTORY)
class ValidateInventoryState implements IState<OrderData, OrderOutputs, OrderState.VALIDATE_INVENTORY> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.VALIDATE_INVENTORY>
  ) {
    // Simulate inventory check
    const allAvailable = ctx.data.items.every(item => item.quantity <= 100);

    if (!allAvailable) {
      throw new Error('Insufficient inventory');
    }

    actions.next({
      output: {
        available: true,
        reservationId: `res-${Date.now()}`,
      },
    });
  }
}

@State(OrderState.PROCESS_PAYMENT)
@UnlockAfter() // Release lock after payment - allows other orders to proceed
class ProcessPaymentState implements IState<OrderData, OrderOutputs, OrderState.PROCESS_PAYMENT> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.PROCESS_PAYMENT>
  ) {
    // Simulate payment processing
    const paymentId = `pay-${ctx.data.orderId}-${Date.now()}`;

    actions.next({
      output: {
        paymentId,
        amount: ctx.data.total,
      },
    });
  }
}

@State(OrderState.RESERVE_INVENTORY)
class ReserveInventoryState implements IState<OrderData, OrderOutputs, OrderState.RESERVE_INVENTORY> {
  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext<OrderData, OrderOutputs>, output: OrderOutputs[OrderState.RESERVE_INVENTORY]) {
    // Track reserved items for potential rollback
    console.log(`Reserved items for order ${ctx.data.orderId}:`, output.items);
  }

  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.RESERVE_INVENTORY>
  ) {
    const items = ctx.data.items.map(item => item.sku);

    actions.next({
      output: {
        reserved: true,
        items,
      },
    });
  }
}

@State(OrderState.SEND_CONFIRMATION)
class SendConfirmationState implements IState<OrderData, OrderOutputs, OrderState.SEND_CONFIRMATION> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.SEND_CONFIRMATION>
  ) {
    // Simulate email sending
    const confirmationId = `conf-${ctx.data.orderId}`;

    actions.next({
      output: {
        emailSent: true,
        confirmationId,
      },
    });
  }
}

@State(OrderState.PREPARE_SHIPMENT)
class PrepareShipmentState implements IState<OrderData, OrderOutputs, OrderState.PREPARE_SHIPMENT> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.PREPARE_SHIPMENT>
  ) {
    // Simulate shipment preparation
    const warehouseId = 'WH-001';

    actions.next({
      output: {
        prepared: true,
        warehouseId,
      },
    });
  }
}

@State(OrderState.SHIP_ORDER)
class ShipOrderState implements IState<OrderData, OrderOutputs, OrderState.SHIP_ORDER> {
  execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions<OrderData, OrderOutputs, OrderState.SHIP_ORDER>) {
    // Generate tracking number
    const trackingNumber = `TRACK-${ctx.data.orderId}-${Date.now()}`;

    actions.next({
      output: {
        shipped: true,
        trackingNumber,
      },
    });
  }
}

@State(OrderState.ORDER_COMPLETED)
class OrderCompletedState implements IState<OrderData, OrderOutputs, OrderState.ORDER_COMPLETED> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.ORDER_COMPLETED>
  ) {
    actions.next({
      output: {
        completed: true,
        completedAt: new Date(),
      },
    });
  }
}

describe('E2E: Complete Order Workflow', () => {
  let engine: WorkflowEngine;
  let persistence: InMemoryPersistenceAdapter;
  let lockAdapter: InMemoryLockAdapter;

  beforeEach(() => {
    StateRegistry.clear();
    persistence = new InMemoryPersistenceAdapter();
    lockAdapter = new InMemoryLockAdapter();
    engine = new WorkflowEngine({ persistence, lockAdapter });

    StateRegistry.autoRegister([
      new CreateOrderState(),
      new ValidateInventoryState(),
      new ProcessPaymentState(),
      new ReserveInventoryState(),
      new SendConfirmationState(),
      new PrepareShipmentState(),
      new ShipOrderState(),
      new OrderCompletedState(),
    ]);
  });

  describe('successful order flow', () => {
    it('should complete entire order workflow', async () => {
      const result = await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-001',
          customerId: 'CUST-123',
          items: [
            { sku: 'PRODUCT-A', quantity: 2, price: 29.99 },
            { sku: 'PRODUCT-B', quantity: 1, price: 49.99 },
          ],
          total: 109.97,
          paymentMethod: 'credit_card' as const,
          shippingAddress: {
            street: '123 Main St',
            city: 'New York',
            zipCode: '10001',
          },
        },
      });

      expect(result.status).toBe(WorkflowStatus.COMPLETED);
      expect(result.currentState).toBe(OrderState.ORDER_COMPLETED);

      // Verify all states were executed (except initial state which doesn't create transition)
      expect(result.history.length).toBeGreaterThan(0);
      const states = result.history.map(h => h.to);
      // CREATE_ORDER is initial state, won't be in history
      expect(states).toContain(OrderState.VALIDATE_INVENTORY);
      expect(states).toContain(OrderState.PROCESS_PAYMENT);
      expect(states).toContain(OrderState.RESERVE_INVENTORY);
      expect(states).toContain(OrderState.SEND_CONFIRMATION);
      expect(states).toContain(OrderState.PREPARE_SHIPMENT);
      expect(states).toContain(OrderState.SHIP_ORDER);
      expect(states).toContain(OrderState.ORDER_COMPLETED);

      // Verify outputs
      expect((result.outputs[OrderState.CREATE_ORDER] as OrderOutputs[OrderState.CREATE_ORDER])?.orderId).toBe('ORD-001');
      expect((result.outputs[OrderState.VALIDATE_INVENTORY] as OrderOutputs[OrderState.VALIDATE_INVENTORY])?.available).toBe(
        true
      );
      expect((result.outputs[OrderState.PROCESS_PAYMENT] as OrderOutputs[OrderState.PROCESS_PAYMENT])?.paymentId).toBeDefined();
      expect((result.outputs[OrderState.RESERVE_INVENTORY] as OrderOutputs[OrderState.RESERVE_INVENTORY])?.reserved).toBe(true);
      expect((result.outputs[OrderState.SEND_CONFIRMATION] as OrderOutputs[OrderState.SEND_CONFIRMATION])?.emailSent).toBe(true);
      expect((result.outputs[OrderState.PREPARE_SHIPMENT] as OrderOutputs[OrderState.PREPARE_SHIPMENT])?.prepared).toBe(true);
      expect((result.outputs[OrderState.SHIP_ORDER] as OrderOutputs[OrderState.SHIP_ORDER])?.trackingNumber).toBeDefined();
      expect((result.outputs[OrderState.ORDER_COMPLETED] as OrderOutputs[OrderState.ORDER_COMPLETED])?.completed).toBe(true);
    });

    it('should track complete execution history', async () => {
      const result = await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-002',
          customerId: 'CUST-456',
          items: [{ sku: 'PRODUCT-C', quantity: 1, price: 99.99 }],
          total: 99.99,
          paymentMethod: 'paypal' as const,
          shippingAddress: {
            street: '456 Oak Ave',
            city: 'Los Angeles',
            zipCode: '90001',
          },
        },
      });

      // Each transition should have timing information
      result.history.forEach(transition => {
        expect(transition.startedAt).toBeInstanceOf(Date);
        expect(transition.completedAt).toBeInstanceOf(Date);
        expect(transition.duration).toBeGreaterThanOrEqual(0);
        expect(transition.status).toBe('success');
      });

      // Verify order of execution
      const stateOrder = result.history.map(h => h.to);
      expect(stateOrder.indexOf(OrderState.CREATE_ORDER)).toBeLessThan(stateOrder.indexOf(OrderState.VALIDATE_INVENTORY));
      expect(stateOrder.indexOf(OrderState.VALIDATE_INVENTORY)).toBeLessThan(stateOrder.indexOf(OrderState.PROCESS_PAYMENT));
      expect(stateOrder.indexOf(OrderState.PROCESS_PAYMENT)).toBeLessThan(stateOrder.indexOf(OrderState.SHIP_ORDER));
    });
  });

  describe('error scenarios', () => {
    it('should fail when order has no items', async () => {
      await expect(
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId: 'ORD-003',
            customerId: 'CUST-789',
            items: [],
            total: 0,
            paymentMethod: 'credit_card' as const,
            shippingAddress: {
              street: '789 Elm St',
              city: 'Chicago',
              zipCode: '60601',
            },
          },
        })
      ).rejects.toThrow('at least one item');
    });

    it('should fail when inventory is insufficient', async () => {
      await expect(
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId: 'ORD-004',
            customerId: 'CUST-999',
            items: [
              { sku: 'PRODUCT-D', quantity: 200, price: 10.0 }, // Over limit
            ],
            total: 2000.0,
            paymentMethod: 'credit_card' as const,
            shippingAddress: {
              street: '321 Pine St',
              city: 'Seattle',
              zipCode: '98101',
            },
          },
        })
      ).rejects.toThrow('Insufficient inventory');
    });
  });

  describe('partial unlock behavior', () => {
    it('should release lock after payment processing', async () => {
      const releaseSpy = jest.spyOn(lockAdapter, 'release');

      await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-005',
          customerId: 'CUST-111',
          items: [{ sku: 'PRODUCT-E', quantity: 1, price: 19.99 }],
          total: 19.99,
          paymentMethod: 'credit_card' as const,
          shippingAddress: {
            street: '111 First St',
            city: 'Boston',
            zipCode: '02101',
          },
        },
      });

      // Lock should be released after PROCESS_PAYMENT (@UnlockAfter)
      expect(releaseSpy).toHaveBeenCalledWith('workflow:group:ORD-005');
    });

    it('should continue execution after unlock', async () => {
      const result = await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-006',
          customerId: 'CUST-222',
          items: [{ sku: 'PRODUCT-F', quantity: 3, price: 15.99 }],
          total: 47.97,
          paymentMethod: 'paypal' as const,
          shippingAddress: {
            street: '222 Second St',
            city: 'Austin',
            zipCode: '78701',
          },
        },
      });

      // Should complete successfully even after unlock
      expect(result.status).toBe(WorkflowStatus.COMPLETED);

      // States after unlock should be executed
      const states = result.history.map(h => h.to);
      expect(states).toContain(OrderState.RESERVE_INVENTORY); // After unlock
      expect(states).toContain(OrderState.SEND_CONFIRMATION); // After unlock
      expect(states).toContain(OrderState.SHIP_ORDER); // After unlock
    });
  });

  describe('persistence and retrieval', () => {
    it('should persist order execution', async () => {
      const result = await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-007',
          customerId: 'CUST-333',
          items: [{ sku: 'PRODUCT-G', quantity: 1, price: 79.99 }],
          total: 79.99,
          paymentMethod: 'credit_card' as const,
          shippingAddress: {
            street: '333 Third St',
            city: 'Denver',
            zipCode: '80201',
          },
        },
      });

      // Load from persistence
      const loaded = await persistence.load(result.id);

      expect(loaded).toBeDefined();
      expect(loaded?.workflowName).toBe('CompleteOrderWorkflow');
      expect(loaded?.status).toBe(WorkflowStatus.COMPLETED);
      expect((loaded?.data as OrderData)?.orderId).toBe('ORD-007');
      expect(loaded?.history.length).toBe(result.history.length);
    });

    it('should find completed orders', async () => {
      await engine.execute(CompleteOrderWorkflow, {
        data: {
          orderId: 'ORD-008',
          customerId: 'CUST-444',
          items: [{ sku: 'PRODUCT-H', quantity: 2, price: 24.99 }],
          total: 49.98,
          paymentMethod: 'credit_card' as const,
          shippingAddress: {
            street: '444 Fourth St',
            city: 'Miami',
            zipCode: '33101',
          },
        },
      });

      const completed = await persistence.find({
        workflowName: 'CompleteOrderWorkflow',
        status: WorkflowStatus.COMPLETED,
      });

      expect(completed.length).toBeGreaterThan(0);
      completed.forEach(order => {
        expect(order.status).toBe(WorkflowStatus.COMPLETED);
        expect(order.currentState).toBe(OrderState.ORDER_COMPLETED);
      });
    });
  });

  describe('multiple orders concurrency', () => {
    it('should process multiple orders sequentially per group', async () => {
      const orderId = 'ORD-SAME';

      // Try to process same order twice concurrently
      const [result1, result2] = await Promise.allSettled([
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId,
            customerId: 'CUST-555',
            items: [{ sku: 'PRODUCT-I', quantity: 1, price: 39.99 }],
            total: 39.99,
            paymentMethod: 'credit_card' as const,
            shippingAddress: {
              street: '555 Fifth St',
              city: 'Portland',
              zipCode: '97201',
            },
          },
        }),
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId,
            customerId: 'CUST-666',
            items: [{ sku: 'PRODUCT-J', quantity: 1, price: 59.99 }],
            total: 59.99,
            paymentMethod: 'paypal' as const,
            shippingAddress: {
              street: '666 Sixth St',
              city: 'Phoenix',
              zipCode: '85001',
            },
          },
        }),
      ]);

      // One should succeed, one should fail (sequential mode)
      const succeeded = [result1, result2].filter(r => r.status === 'fulfilled');
      const failed = [result1, result2].filter(r => r.status === 'rejected');

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(1);
    });

    it('should process different orders in parallel', async () => {
      const [result1, result2, result3] = await Promise.all([
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId: 'ORD-PAR-1',
            customerId: 'CUST-777',
            items: [{ sku: 'PRODUCT-K', quantity: 1, price: 12.99 }],
            total: 12.99,
            paymentMethod: 'credit_card' as const,
            shippingAddress: {
              street: '777 Seventh St',
              city: 'Dallas',
              zipCode: '75201',
            },
          },
        }),
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId: 'ORD-PAR-2',
            customerId: 'CUST-888',
            items: [{ sku: 'PRODUCT-L', quantity: 1, price: 22.99 }],
            total: 22.99,
            paymentMethod: 'paypal' as const,
            shippingAddress: {
              street: '888 Eighth St',
              city: 'Houston',
              zipCode: '77001',
            },
          },
        }),
        engine.execute(CompleteOrderWorkflow, {
          data: {
            orderId: 'ORD-PAR-3',
            customerId: 'CUST-999',
            items: [{ sku: 'PRODUCT-M', quantity: 1, price: 32.99 }],
            total: 32.99,
            paymentMethod: 'credit_card' as const,
            shippingAddress: {
              street: '999 Ninth St',
              city: 'Atlanta',
              zipCode: '30301',
            },
          },
        }),
      ]);

      // All should succeed (different order IDs)
      expect(result1.status).toBe(WorkflowStatus.COMPLETED);
      expect(result2.status).toBe(WorkflowStatus.COMPLETED);
      expect(result3.status).toBe(WorkflowStatus.COMPLETED);
    });
  });
});
