# FlowMesh

[![npm version](https://badge.fury.io/js/flowmesh.svg)](https://badge.fury.io/js/flowmesh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Test Coverage](https://img.shields.io/badge/coverage-82.76%25-brightgreen.svg)](https://github.com/RobinCK/flowmesh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

A type-safe workflow engine for TypeScript with declarative approach and NestJS integration.

## Features

- Full type safety with TypeScript
- Declarative workflow definitions using decorators
- Multiple transition types (automatic, explicit, conditional, dynamic)
- Lifecycle hooks for workflows and states
- Automatic persistence with adapter pattern
- Concurrency control (sequential, parallel, throttle modes)
- Suspend/resume workflows
- NestJS integration with dependency injection
- Plugin system for extensibility
- Flexible error handling with custom error handlers
- Workflow graph generation for visualization and analysis

## Installation

```bash
npm install flowmesh reflect-metadata
```

**Peer dependencies:**
- `reflect-metadata` (required)
- `@nestjs/common`, `@nestjs/core` (optional, for NestJS integration)

## Quick Start

```typescript
import { Workflow, State, WorkflowEngine, StateRegistry, WorkflowContext, StateActions } from 'flowmesh';

// Define states enum
enum OrderState {
  CREATED = 'CREATED',
  INVENTORY_CHECK = 'INVENTORY_CHECK',
  COMPLETED = 'COMPLETED',
}

// Define data and outputs interfaces
interface OrderData {
  orderId: string;
  items: string[];
}

interface OrderOutputs {
  [OrderState.CREATED]: { orderId: string };
  [OrderState.INVENTORY_CHECK]: { available: boolean };
}

// Define workflow
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
})
export class OrderWorkflow {}

// Define state handlers
@State(OrderState.CREATED)
export class CreatedState {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.CREATED>
  ) {
    actions.next({ output: { orderId: ctx.data.orderId } });
  }
}

@State(OrderState.INVENTORY_CHECK)
export class InventoryCheckState {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.INVENTORY_CHECK>
  ) {
    const available = ctx.data.items.length > 0;
    actions.next({ output: { available } });
  }
}

@State(OrderState.COMPLETED)
export class CompletedState {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.COMPLETED>
  ) {
    console.log('Order completed:', ctx.data.orderId);
    actions.complete({ output: {} });
  }
}

// Execute workflow
const engine = new WorkflowEngine();
StateRegistry.autoRegister([CreatedState, InventoryCheckState, CompletedState]);

const result = await engine.execute(OrderWorkflow, {
  data: { orderId: 'ORD-001', items: ['item1', 'item2'] }
});

console.log(result.status); // 'completed'
console.log(result.outputs[OrderState.CREATED]?.orderId); // 'ORD-001'
```

## Table of Contents

- [Core Concepts](#core-concepts)
- [Workflow Definition](#workflow-definition)
- [State Handlers](#state-handlers)
- [State Behavior Decorators](#state-behavior-decorators)
- [Transitions](#transitions)
- [Lifecycle Hooks](#lifecycle-hooks)
- [Error Handling](#error-handling)
- [Concurrency Control](#concurrency-control)
- [Suspend and Resume](#suspend-and-resume)
- [Adapters](#adapters)
- [NestJS Integration](#nestjs-integration)
- [Workflow Graphs](#workflow-graphs)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Testing](#testing)
- [Best Practices](#best-practices)

## Core Concepts

### Workflow

A workflow is a class decorated with `@Workflow` that defines:
- Workflow name
- States enum
- Initial state
- Transitions configuration
- Concurrency settings

### State

A state is a class decorated with `@State` that implements business logic:
- Receives typed context with data and outputs
- Has access to actions (next, goto, suspend, updateData)
- Can define lifecycle hooks

### Context

`WorkflowContext<TData, TOutputs>` provides:
- `executionId`: Unique workflow execution identifier
- `groupId`: Group identifier for concurrency control
- `currentState`: Current state value
- `data`: Workflow input data
- `outputs`: Type-safe map of previous state outputs
- `history`: Array of state transitions
- `metadata`: Custom metadata object

### State Actions

`StateActions<TData, TOutputs, TCurrentState>` provides:
- `next(options)`: Move to next state with output
- `goto(state, options)`: Move to specific state
- `suspend(options)`: Suspend workflow execution
- `complete(options)`: Explicitly complete workflow with final state context

## Workflow Definition

### Basic Workflow

```typescript
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
})
export class OrderWorkflow {}
```

### With Explicit Transitions

```typescript
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  transitions: [
    { from: [OrderState.CREATED], to: OrderState.PAYMENT },
    { from: [OrderState.PAYMENT], to: OrderState.COMPLETED },
  ],
})
export class OrderWorkflow {}
```

### With Conditional Transitions

```typescript
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  conditionalTransitions: [
    {
      from: OrderState.INVENTORY_CHECK,
      conditions: [
        {
          condition: (ctx) => ctx.data.amount > 1000,
          to: OrderState.MANAGER_APPROVAL
        },
        {
          condition: (ctx) => ctx.data.inStock,
          to: OrderState.PAYMENT
        },
      ],
      default: OrderState.OUT_OF_STOCK,
    },
  ],
})
export class OrderWorkflow {}
```

### With Concurrency Control

```typescript
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  concurrency: {
    mode: ConcurrencyMode.SEQUENTIAL,
    groupBy: 'orderId', // or function: (data) => data.orderId
  },
})
export class OrderWorkflow {}
```

## State Handlers

### Basic State

```typescript
@State(OrderState.CREATED)
export class CreatedState implements IState<OrderData, OrderOutputs, OrderState.CREATED> {
  execute(
    ctx: WorkflowContext<OrderData, OrderOutputs>,
    actions: StateActions<OrderData, OrderOutputs, OrderState.CREATED>
  ) {
    // Business logic
    actions.next({ output: { orderId: ctx.data.orderId } });
  }
}
```

### State with Lifecycle Hooks

```typescript
@State(OrderState.PAYMENT)
export class PaymentState implements IState {
  @OnStateStart()
  onStart(ctx: WorkflowContext, outputs: OrderOutputs) {
    console.log('Starting payment processing');
  }

  execute(ctx: WorkflowContext, actions: StateActions) {
    // Process payment
    actions.next({ output: { transactionId: 'tx-123' } });
  }

  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext, output: any, outputs: OrderOutputs) {
    console.log('Payment processed successfully');
  }

  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error, outputs: OrderOutputs) {
    console.error('Payment failed:', error);
  }

  @OnStateFinish()
  onFinish(ctx: WorkflowContext, outputs: OrderOutputs) {
    console.log('Payment state finished');
  }
}
```

### State with Dynamic Transitions

```typescript
@State(OrderState.INVENTORY_CHECK)
export class InventoryCheckState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    const { available, quantity } = this.checkInventory(ctx.data.items);

    if (!available) {
      actions.goto(OrderState.OUT_OF_STOCK, {
        output: { available: false }
      });
    } else if (quantity < 10) {
      actions.goto(OrderState.LOW_STOCK_WARNING, {
        output: { quantity }
      });
    } else {
      actions.next({ output: { available: true, quantity } });
    }
  }
}
```

### State with Suspend

```typescript
@State(OrderState.AWAITING_APPROVAL)
export class AwaitingApprovalState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    if (ctx.data.approved) {
      actions.next({ output: { approvedAt: new Date() } });
    } else {
      actions.suspend({
        waitingFor: 'manager_approval',
        output: { pendingAt: new Date() }
      });
    }
  }
}
```

### State with Complete

Use `complete()` to explicitly end workflow execution with full control over final state context:

```typescript
@State(OrderState.PROCESSING)
export class ProcessingState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    const result = this.processOrder(ctx.data);

    // Conditionally complete workflow early
    if (result.skipRemaining) {
      actions.complete({
        data: { completedEarly: true },
        output: { result: 'skipped', reason: result.reason }
      });
      return;
    }

    // Otherwise continue to next state
    actions.next({ output: { result: 'processed' } });
  }
}
```

**When to use `complete()`:**
- Early workflow termination with success status
- Conditional completion based on business logic
- Explicit control over final workflow state
- Bypassing remaining states when they're not needed

**Note:** `complete()` follows "last action wins" pattern - if another action is called after it, the last action takes effect.

### State with Error Handling

```typescript
@State(OrderState.VALIDATE)
export class ValidateState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    if (!ctx.data.orderId) {
      throw new Error('Order ID is required');
    }

    if (ctx.data.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    actions.next({ output: { validated: true } });
  }
}
```

### Shared State Classes

One state class can handle multiple states using array syntax. This is useful when you have the same logic that needs to execute at different points in the workflow.

```typescript
enum ProcessingState {
  // First pass
  VALIDATE = 'VALIDATE',
  TRANSFORM = 'TRANSFORM',
  CHECK = 'CHECK',

  // Retry pass (after queue)
  VALIDATE_RETRY = 'VALIDATE_RETRY',
  TRANSFORM_RETRY = 'TRANSFORM_RETRY',
  CHECK_RETRY = 'CHECK_RETRY',

  QUEUE = 'QUEUE',
  COMPLETE = 'COMPLETE',
}

// One class handles both VALIDATE and VALIDATE_RETRY
@State([ProcessingState.VALIDATE, ProcessingState.VALIDATE_RETRY])
export class ValidateState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Use ctx.currentState to determine which pass we're in
    const attemptNumber = ctx.currentState === ProcessingState.VALIDATE ? 1 : 2;

    const isValid = this.validate(ctx.data);

    actions.next({
      output: {
        isValid,
        attemptNumber,
        validatedAt: new Date(),
      },
    });
  }

  private validate(data: any): boolean {
    // Shared validation logic
    return data.value > 0;
  }
}

@State([ProcessingState.TRANSFORM, ProcessingState.TRANSFORM_RETRY])
export class TransformState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Same transformation logic for both states
    const transformed = this.transform(ctx.data);
    actions.next({ output: { transformed } });
  }

  private transform(data: any): any {
    return { ...data, processed: true };
  }
}

@Workflow({
  name: 'ProcessingWorkflow',
  states: ProcessingState,
  initialState: ProcessingState.VALIDATE,
  transitions: [
    // First pass
    { from: [ProcessingState.VALIDATE], to: ProcessingState.TRANSFORM },
    { from: [ProcessingState.TRANSFORM], to: ProcessingState.CHECK },
    { from: [ProcessingState.CHECK], to: ProcessingState.QUEUE },

    // Retry pass - same classes, different states
    { from: [ProcessingState.QUEUE], to: ProcessingState.VALIDATE_RETRY },
    { from: [ProcessingState.VALIDATE_RETRY], to: ProcessingState.TRANSFORM_RETRY },
    { from: [ProcessingState.TRANSFORM_RETRY], to: ProcessingState.CHECK_RETRY },
    { from: [ProcessingState.CHECK_RETRY], to: ProcessingState.COMPLETE },
  ],
})
class ProcessingWorkflow {}
```

**Benefits:**
- ✅ No code duplication - same logic reused for multiple states
- ✅ Separate outputs - each state gets its own output entry
- ✅ Clear workflow graph - states are explicit in transitions
- ✅ `context.currentState` tells you which state is executing

**Use cases:**
- Retry workflows that go through the same steps twice
- Multi-pass validation with same logic
- Shared processing logic at different workflow stages

## State Behavior Decorators

### @Timeout

Set execution timeout for a state. If the state execution exceeds the timeout, an error will be thrown.

```typescript
@State(OrderState.PAYMENT)
@Timeout(30000) // 30 seconds
export class PaymentState implements IState {
  async execute(ctx: WorkflowContext, actions: StateActions) {
    // If payment processing takes more than 30 seconds, timeout error is thrown
    await this.processPayment(ctx.data);
    actions.next({ output: { paid: true } });
  }
}
```

### @Retry

Configure automatic retry logic with exponential backoff for failed state executions.

```typescript
@State(OrderState.API_CALL)
@Retry({
  maxAttempts: 3,
  strategy: 'exponential',
  initialDelay: 1000,    // 1 second
  maxDelay: 10000,       // 10 seconds
  multiplier: 2,         // Delay doubles each retry
})
export class ApiCallState implements IState {
  async execute(ctx: WorkflowContext, actions: StateActions) {
    // Will retry up to 3 times with exponential backoff if it fails
    const response = await this.externalApiCall(ctx.data);
    actions.next({ output: { response } });
  }
}
```

**Retry strategies:**
- `exponential`: Delay = initialDelay * (multiplier ^ attemptNumber), capped at maxDelay
- `linear`: Delay = initialDelay * attemptNumber, capped at maxDelay
- `fixed`: Delay = initialDelay for all attempts

**Example timing with exponential strategy:**
```
Attempt 1: fails immediately
Attempt 2: waits 1000ms (1s)
Attempt 3: waits 2000ms (2s)
Final attempt: waits 4000ms (4s)
```

### @UnlockAfter

Release concurrency lock after this state completes. Useful for long-running workflows that should allow other executions to start.

```typescript
@State(OrderState.PAYMENT)
@UnlockAfter()
export class PaymentState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Process payment
    // After this state completes, the hard lock is released
    // allowing other workflow executions to start
    actions.next({ output: { paid: true } });
  }
}

@State(OrderState.SEND_EMAIL)
export class SendEmailState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // This state runs without holding the hard lock
    // Other workflows can now execute in parallel
    this.emailService.send(ctx.data.email, 'Order Confirmation');
    actions.next({ output: { emailSent: true } });
  }
}
```

**Use cases for @UnlockAfter:**
- Release lock after critical operations (payment, inventory reservation)
- Allow parallel processing of non-critical operations (emails, notifications)
- Improve throughput in sequential concurrency mode
- Enable throttle mode with maxConcurrentAfterUnlock

### Combining Decorators

You can combine multiple behavior decorators on the same state:

```typescript
@State(OrderState.EXTERNAL_API)
@Timeout(60000)
@Retry({
  maxAttempts: 3,
  strategy: 'exponential',
  initialDelay: 2000,
  maxDelay: 10000,
  multiplier: 2,
})
@UnlockAfter()
export class ExternalApiState implements IState {
  async execute(ctx: WorkflowContext, actions: StateActions) {
    // Will timeout after 60 seconds
    // Will retry up to 3 times with exponential backoff
    // Will release lock after completion
    const result = await this.callExternalApi(ctx.data);
    actions.next({ output: { result } });
  }
}
```

## Transitions

FlowMesh supports four types of transitions, evaluated in this order:

### 1. Dynamic Transitions (goto)

Highest priority. Programmatically determine next state in state handler.

```typescript
@State(OrderState.RISK_CHECK)
export class RiskCheckState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    const riskScore = this.calculateRisk(ctx.data);

    if (riskScore > 80) {
      actions.goto(OrderState.MANUAL_REVIEW);
    } else if (riskScore > 50) {
      actions.goto(OrderState.ADDITIONAL_VERIFICATION);
    } else {
      actions.goto(OrderState.APPROVED);
    }
  }
}
```

### 2. Conditional Transitions

Evaluated based on conditions at runtime.

```typescript
@Workflow({
  conditionalTransitions: [
    {
      from: OrderState.REVIEW,
      conditions: [
        { condition: (ctx) => ctx.data.amount > 10000, to: OrderState.DIRECTOR_APPROVAL },
        { condition: (ctx) => ctx.data.amount > 1000, to: OrderState.MANAGER_APPROVAL },
      ],
      default: OrderState.AUTO_APPROVED,
    },
  ],
})
```

Conditions are evaluated in order. First matching condition determines next state.

#### Virtual Outputs for Skipped States

When using conditional transitions that skip states, you can define virtual outputs for those skipped states. This is useful when you want to standardize output data regardless of which path was taken through the workflow.

```typescript
@Workflow({
  conditionalTransitions: [
    {
      from: OrderState.START,
      conditions: [
        {
          condition: (ctx) => ctx.data.amount > 1000,
          to: OrderState.COMPLETED,
          // Virtual outputs for skipped states
          virtualOutputs: {
            [OrderState.HIGH_VALUE]: { priority: 'high', approved: true },
            [OrderState.MEDIUM_VALUE]: { priority: 'medium', approved: false },
            [OrderState.LOW_VALUE]: { priority: 'low', approved: false },
          },
        },
        {
          condition: (ctx) => ctx.data.amount > 100,
          to: OrderState.COMPLETED,
          virtualOutputs: {
            [OrderState.HIGH_VALUE]: { priority: 'high', approved: false },
            [OrderState.MEDIUM_VALUE]: { priority: 'medium', approved: true },
            [OrderState.LOW_VALUE]: { priority: 'low', approved: false },
          },
        },
      ],
      default: OrderState.COMPLETED,
      defaultVirtualOutputs: {
        [OrderState.HIGH_VALUE]: { priority: 'high', approved: false },
        [OrderState.MEDIUM_VALUE]: { priority: 'medium', approved: false },
        [OrderState.LOW_VALUE]: { priority: 'low', approved: true },
      },
    },
  ],
})
```

**Benefits:**
- Access consistent output structure in final states without checking which path was taken
- Avoid conditional logic in states like "did we go through HIGH_VALUE or MEDIUM_VALUE?"
- Simplify state logic by having predictable output data

**Dynamic Virtual Outputs:**

Virtual outputs can also be functions that receive the workflow context:

```typescript
conditionalTransitions: [
  {
    from: OrderState.START,
    conditions: [
      {
        condition: (ctx) => ctx.data.amount > 1000,
        to: OrderState.COMPLETED,
        virtualOutputs: {
          [OrderState.PROCESSING]: (ctx) => ({
            processedAt: new Date(),
            amount: ctx.data.amount,
            status: 'high-value',
          }),
        },
      },
    ],
  },
]
```

**Example Usage in State:**

```typescript
@State(OrderState.COMPLETED)
export class CompletedState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Access virtual outputs without checking the path
    const highValue = ctx.outputs[OrderState.HIGH_VALUE];
    const mediumValue = ctx.outputs[OrderState.MEDIUM_VALUE];
    const lowValue = ctx.outputs[OrderState.LOW_VALUE];

    // Find which priority was set
    const priority = highValue?.priority || mediumValue?.priority || lowValue?.priority;

    actions.next({
      output: {
        completedAt: new Date(),
        priority
      }
    });
  }
}
```

### 3. Explicit Transitions

Defined in workflow configuration.

```typescript
@Workflow({
  transitions: [
    { from: [OrderState.CREATED, OrderState.UPDATED], to: OrderState.VALIDATION },
    { from: [OrderState.VALIDATION], to: OrderState.PROCESSING },
    { from: [OrderState.PROCESSING], to: OrderState.COMPLETED },
  ],
})
```

### 4. Automatic Transitions

Lowest priority. Follows enum value order.

```typescript
enum OrderState {
  CREATED = 'CREATED',        // → VALIDATION
  VALIDATION = 'VALIDATION',  // → PROCESSING
  PROCESSING = 'PROCESSING',  // → COMPLETED
  COMPLETED = 'COMPLETED',
}
```

## Transition Evaluation Priority

FlowMesh evaluates transitions in the following order:

1. **Dynamic (goto)** - Highest priority, determined in state execute() method
2. **Conditional Transitions** - Evaluated with conditions and default fallback
3. **Explicit Transitions** - Configured in workflow decorator (with or without inline conditions)
4. **Automatic** - Lowest priority, follows enum order if nothing else matches

```
Priority Order:
Dynamic (goto) > Conditional > Explicit > Automatic
```

## Transition Comparison

| Method | Flexibility | Complexity | Use Case |
|--------|------------|-----------|----------|
| Automatic | ⭐ | ⭐ | Simple linear workflows |
| Explicit | ⭐⭐ | ⭐⭐ | Clearly defined flow |
| Conditional | ⭐⭐⭐⭐ | ⭐⭐⭐ | Complex logic with fallback |
| Dynamic (goto) | ⭐⭐⭐⭐⭐ | ⭐⭐ | Highly dynamic runtime logic |
| Explicit + Condition | ⭐⭐⭐ | ⭐⭐ | Simple conditional paths |
| Multiple From States | ⭐⭐⭐ | ⭐⭐ | Converging to single point |
| Combined | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Maximum flexibility |

### Multiple From States

Multiple states can transition to the same target state:

```typescript
@Workflow({
  transitions: [
    {
      from: [OrderState.CREATED, OrderState.OUT_OF_STOCK, OrderState.RETRY],
      to: OrderState.INVENTORY_CHECK,
    },
    {
      from: [OrderState.PAYMENT, OrderState.SHIPPING],
      to: OrderState.COMPLETED,
    },
  ],
})
```

**Result:**
- CREATED → INVENTORY_CHECK
- OUT_OF_STOCK → INVENTORY_CHECK (retry check)
- RETRY → INVENTORY_CHECK (retry check)
- PAYMENT → COMPLETED (skip shipping)
- SHIPPING → COMPLETED (normal path)

### Combining Transition Types

You can combine different transition types for maximum flexibility:

```typescript
@Workflow({
  transitions: [
    { from: [OrderState.CREATED], to: OrderState.INVENTORY_CHECK },
    { from: [OrderState.OUT_OF_STOCK], to: OrderState.CANCELLED },
  ],
  conditionalTransitions: [
    {
      from: OrderState.INVENTORY_CHECK,
      conditions: [
        { condition: (ctx) => ctx.data.available, to: OrderState.PAYMENT }
      ],
      default: OrderState.OUT_OF_STOCK,
    },
  ],
})
```

### Transitions Best Practices

**DO:**
- Use automatic transitions for simple linear flows
- Combine different approaches for complex workflows
- Add `default` in conditionalTransitions for edge cases
- Use `goto()` for highly dynamic runtime logic
- Document complex transition logic

**DON'T:**
- Don't create overly complex conditions inline - extract to methods
- Don't forget `default` in conditionalTransitions
- Don't confuse priority order: conditional transitions are checked BEFORE explicit transitions

## Lifecycle Hooks

### Workflow Lifecycle

```typescript
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
})
export class OrderWorkflow {
  @OnWorkflowStart()
  onStart(ctx: WorkflowContext) {
    console.log('Workflow started');
  }

  @OnWorkflowComplete()
  onComplete(ctx: WorkflowContext) {
    console.log('Workflow completed');
  }

  @OnWorkflowError()
  onError(ctx: WorkflowContext, error: Error) {
    console.error('Workflow error:', error);
  }

  @BeforeState()
  beforeState(ctx: WorkflowContext, stateName: string) {
    console.log('Before state:', stateName);
  }

  @AfterState()
  afterState(ctx: WorkflowContext, stateName: string) {
    console.log('After state:', stateName);
  }
}
```

### State Lifecycle

```typescript
@State(OrderState.PAYMENT)
export class PaymentState implements IState {
  @OnStateStart()
  onStart(ctx: WorkflowContext, outputs: OrderOutputs) {
    // Called before execute()
  }

  execute(ctx: WorkflowContext, actions: StateActions) {
    // Main state logic
  }

  @OnStateSuccess()
  onSuccess(ctx: WorkflowContext, output: any, outputs: OrderOutputs) {
    // Called after successful execute()
  }

  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error, outputs: OrderOutputs) {
    // Called if execute() throws error
  }

  @OnStateFinish()
  onFinish(ctx: WorkflowContext, outputs: OrderOutputs) {
    // Always called after execute() completes (success or failure)
  }
}
```

**Complete Lifecycle Execution Order:**

```
@OnWorkflowStart
  → @BeforeState
    → @OnStateStart
      → execute()
    → @OnStateSuccess (or @OnStateFailure if error)
    → @OnStateFinish
  → @AfterState
  → (repeat for next state)
@OnWorkflowComplete (or @OnWorkflowError if workflow fails)
```

**Success path:**
```
OnStateStart → execute → OnStateSuccess → OnStateFinish
```

**Failure path:**
```
OnStateStart → execute (throws) → OnStateFailure → OnStateFinish
```

**Important:** Hook errors are swallowed and logged as warnings. They do not stop workflow execution.

#### Error Transformation in @OnStateFailure

The `@OnStateFailure` hook can transform errors by returning or throwing a different error. This allows you to:
- Convert technical errors to user-friendly messages
- Enrich errors with context from the workflow
- Wrap errors with additional debugging information
- Transform errors before they reach the workflow error handler

**Basic Error Override (Return):**

```typescript
@State('PROCESSING')
class ProcessingState implements IState {
  execute(ctx, actions) {
    throw new Error('Database timeout');
  }

  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error): Error {
    // Transform technical error to user-friendly error
    return new Error('Service temporarily unavailable. Please try again.');
  }
}
```

**Error Override (Throw):**

```typescript
@State('VALIDATION')
class ValidationState implements IState {
  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error): void {
    // Throwing a new error also overrides the original
    throw new ValidationError(`Validation failed: ${error.message}`);
  }
}
```

**Conditional Transformation:**

```typescript
class RetryableError extends Error {
  constructor(message: string, public readonly originalError: Error) {
    super(message);
  }
}

@State('API_CALL')
class ApiCallState implements IState {
  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error): Error | void {
    // Only transform specific error types
    if (error.message.includes('timeout') || error.message.includes('503')) {
      return new RetryableError('Temporary service error', error);
    }
    // Return void or nothing to keep original error
  }
}
```

**Enriching Errors with Context:**

```typescript
class ContextualError extends Error {
  constructor(
    message: string,
    public readonly context: { userId: string; orderId: string },
    public readonly cause: Error
  ) {
    super(message);
  }
}

@State('ORDER_PROCESSING')
class OrderProcessingState implements IState {
  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error): Error {
    // Add workflow context to error for better debugging
    return new ContextualError(
      `Order processing failed: ${error.message}`,
      {
        userId: ctx.data.userId,
        orderId: ctx.data.orderId,
      },
      error
    );
  }
}
```

**Async Error Transformation:**

```typescript
@State('EXTERNAL_API')
class ExternalApiState implements IState {
  @OnStateFailure()
  async onFailure(ctx: WorkflowContext, error: Error): Promise<Error> {
    // Can perform async operations (e.g., lookup error codes)
    const errorDetails = await this.lookupErrorCode(error);
    return new Error(`External API error: ${errorDetails.userMessage}`);
  }

  private async lookupErrorCode(error: Error) {
    // Fetch additional error information
    return { userMessage: 'Service unavailable' };
  }
}
```

**Working with Previous State Outputs:**

```typescript
@State('PAYMENT')
class PaymentState implements IState {
  @OnStateFailure()
  onFailure(ctx: WorkflowContext, error: Error): Error {
    // Access outputs from previous states
    const orderOutput = ctx.outputs['ORDER_VALIDATION'];
    return new Error(
      `Payment failed for order ${orderOutput.orderId}: ${error.message}`
    );
  }
}
```

**Note:** If `@OnStateFailure` returns `void`, `null`, or `undefined`, the original error is preserved. The transformed error is passed to the workflow-level error handler for further processing.

## Error Handling

FlowMesh provides a flexible error handling system that allows you to control how errors are processed at different phases of workflow execution. This is essential for building resilient workflows in distributed systems.

### Overview

Error handlers give you fine-grained control over error behavior:
- Gracefully handle distributed lock failures
- Continue execution despite non-critical errors
- Exit workflows without marking them as failed
- Custom error logging and monitoring
- Conditional error recovery based on error type

### Error Handler Configuration

Configure an error handler in your workflow decorator:

```typescript
import { ErrorHandler, ErrorContext, ErrorHandlingDecision } from 'flowmesh';

class CustomErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    // Log error
    console.error(`Error in ${phase}:`, error.message);

    // Decide how to handle based on phase and error type
    if (phase === 'lock_acquisition') {
      // Another workflow is processing this group, exit gracefully
      return ErrorHandlingDecision.EXIT;
    }

    if (error.message.includes('Temporary')) {
      // Continue despite temporary errors
      return ErrorHandlingDecision.CONTINUE;
    }

    // Default: mark as failed and persist
    return ErrorHandlingDecision.FAIL;
  }
}

@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  errorHandler: new CustomErrorHandler(),
})
export class OrderWorkflow {}
```

### Error Phases

Errors can occur at different phases of workflow execution:

#### 1. lock_acquisition

Triggered when workflow cannot acquire a distributed lock (Sequential mode).

**Use case:** Handle concurrent execution attempts in distributed systems.

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'lock_acquisition') {
    // Another node is processing this workflow, exit silently
    this.logger.info('Lock held by another instance, exiting');
    return ErrorHandlingDecision.EXIT;
  }
}
```

#### 2. workflow_start

Triggered when `@OnWorkflowStart()` hook throws an error.

**Use case:** Handle initialization failures.

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'workflow_start') {
    if (context.error.message.includes('Config not loaded')) {
      // Non-critical initialization error, continue anyway
      return ErrorHandlingDecision.CONTINUE;
    }
  }
}
```

#### 3. before_state

Triggered when `@BeforeState()` hook throws an error.

**Use case:** Skip beforeState hook but continue with state execution.

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'before_state') {
    // Logging failed but state execution can continue
    this.logger.warn('beforeState logging failed, continuing');
    return ErrorHandlingDecision.CONTINUE;
  }
}
```

#### 4. state_execute

Triggered when state's `execute()` method throws an error.

**Use case:** Handle business logic failures.

**Note:** CONTINUE is not supported for state_execute (treated as EXIT with warning).

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'state_execute') {
    // State execution failed, decide whether to persist failure
    if (context.error.message.includes('Validation')) {
      // Validation errors should not be persisted
      return ErrorHandlingDecision.FAIL_NO_PERSIST;
    }
    return ErrorHandlingDecision.FAIL;
  }
}
```

#### 5. after_state

Triggered when `@AfterState()` hook throws an error.

**Use case:** Skip afterState hook but continue with transition to next state.

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'after_state') {
    // Analytics tracking failed, but workflow should continue
    return ErrorHandlingDecision.CONTINUE;
  }
}
```

#### 6. workflow_complete

Triggered when `@OnWorkflowComplete()` hook throws an error.

**Use case:** Handle cleanup failures without failing the workflow.

```typescript
handle(context: ErrorContext): ErrorHandlingDecision {
  if (context.phase === 'workflow_complete') {
    // Logging or cleanup failed, but workflow is already done
    return ErrorHandlingDecision.CONTINUE;
  }
}
```

### Error Handling Decisions

The error handler can return one of these decisions:

#### CONTINUE

Skip the failed hook and continue workflow execution. Only supported for lifecycle hooks (workflow_start, before_state, after_state).

**Behavior:**
- `workflow_start`: Skip onStart hook, begin state execution
- `before_state`: Skip beforeState hook, execute current state
- `after_state`: Skip afterState hook, transition to next state
- `state_execute`: **Not supported** (treated as EXIT with warning)
- `lock_acquisition`: Return execution without workflow execution

```typescript
return ErrorHandlingDecision.CONTINUE;
```

**Use cases:**
- Non-critical logging/monitoring failures
- Optional analytics tracking errors
- Non-essential notifications

#### EXIT

Stop workflow execution gracefully without marking as failed. Execution status remains RUNNING.

**Behavior:**
- No onError hooks are called
- Execution is not persisted as failed
- Workflow simply stops executing
- Execution object is returned to caller

```typescript
return ErrorHandlingDecision.EXIT;
```

**Use cases:**
- Distributed lock conflicts (another instance processing)
- Graceful shutdown scenarios
- Business rule violations that aren't errors
- Rate limiting or throttling

**Example:**

```typescript
class DistributedErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingDecision {
    if (context.phase === 'lock_acquisition') {
      // Another workflow instance is handling this, exit gracefully
      this.metricsService.increment('workflow.lock_conflict');
      return ErrorHandlingDecision.EXIT;
    }

    if (context.error.message.includes('RATE_LIMIT_EXCEEDED')) {
      // Rate limited, exit without failing
      return ErrorHandlingDecision.EXIT;
    }

    return ErrorHandlingDecision.FAIL;
  }
}
```

#### FAIL

Mark workflow as failed, persist failed status, call onError hooks, and throw error.

**Behavior:**
- Execution status set to FAILED
- Failed execution persisted to database
- `@OnWorkflowError()` hook is called
- Plugin `onError()` hooks are called
- Error is re-thrown to caller

```typescript
return ErrorHandlingDecision.FAIL;
```

**Use cases:**
- Critical business logic failures
- Data integrity violations
- Payment processing errors
- Unrecoverable errors that need investigation

**Example:**

```typescript
class BusinessErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingDecision {
    const error = context.error;

    // Always fail on critical business errors
    if (error.message.includes('Payment')) {
      this.alertService.sendAlert('Payment failure', {
        executionId: context.workflowContext.executionId,
        error: error.message
      });
      return ErrorHandlingDecision.FAIL;
    }

    // Fail on data integrity issues
    if (error.message.includes('Constraint')) {
      return ErrorHandlingDecision.FAIL;
    }

    return ErrorHandlingDecision.CONTINUE;
  }
}
```

#### FAIL_NO_PERSIST

Call onError hooks and throw error WITHOUT persisting failed status to database.

**Behavior:**
- Execution status remains unchanged (not set to FAILED)
- No persistence update for failure
- `@OnWorkflowError()` hook is called
- Plugin `onError()` hooks are called
- Error is re-thrown to caller

```typescript
return ErrorHandlingDecision.FAIL_NO_PERSIST;
```

**Use cases:**
- Validation errors that should be reported but not stored
- Test/development environments
- Temporary errors you don't want in metrics
- When you want to fail fast without database writes

#### TRANSITION_TO

Transition to a different state to handle the error. Only supported for `state_execute` phase.

**Behavior:**
- Transition to specified target state
- Current failed state's transition marked as `error_recovery`
- Optional output can be set for the failed state
- Workflow continues from the target state
- Transition is validated before execution

```typescript
return {
  decision: ErrorHandlingDecision.TRANSITION_TO,
  targetState: 'ERROR_RECOVERY',
  output: { reason: 'Payment failed, rolling back' }
};
```

**Use cases:**
- Rollback operations after critical errors
- Error recovery flows
- Compensation transactions
- Fallback to alternative processing paths

**Example: Conversion Rollback**

```typescript
class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

class WithdrawalErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingResult {
    const { error, phase, workflowContext } = context;

    // Handle conversion errors by transitioning to rollback state
    if (error instanceof ConversionError && phase === 'state_execute') {
      return {
        decision: ErrorHandlingDecision.TRANSITION_TO,
        targetState: 'ROLLING_BACK_CONVERSION',
        output: {
          reason: error.message,
          fromState: String(workflowContext.currentState),
          timestamp: new Date(),
        }
      };
    }

    return ErrorHandlingDecision.FAIL;
  }
}

@Workflow({
  name: 'WithdrawalWorkflow',
  states: WithdrawalState,
  initialState: WithdrawalState.CREATED,
  errorHandler: new WithdrawalErrorHandler(),
})
export class WithdrawalWorkflow {}

// Any state can throw ConversionError to trigger rollback
@State(WithdrawalState.VALIDATING)
export class ValidatingState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    if (ctx.data.shouldRollbackConversion) {
      throw new ConversionError('Validation failed, rollback needed');
    }

    actions.next({ output: { validated: true } });
  }
}

@State(WithdrawalState.ROLLING_BACK_CONVERSION)
export class RollingBackConversionState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Access error context from outputs
    const errorInfo = ctx.outputs[ctx.currentState];
    console.log('Rolling back:', errorInfo.reason);

    // Perform rollback logic

    actions.next({
      output: {
        rolledBack: true,
        originalError: errorInfo.reason
      }
    });
  }
}
```

**History Tracking:**

When `TRANSITION_TO` is used, the workflow history tracks both the error and recovery:

```typescript
const result = await engine.execute(WithdrawalWorkflow, {
  data: { shouldRollbackConversion: true }
});

// History shows error recovery
console.log(result.history);
// [
//   { from: 'CREATED', to: 'VALIDATING', status: 'success' },
//   { from: 'VALIDATING', to: 'VALIDATING', status: 'error_recovery' },
//   { from: 'VALIDATING', to: 'ROLLING_BACK_CONVERSION', status: 'success' },
//   { from: 'ROLLING_BACK_CONVERSION', to: 'COMPLETED', status: 'success' }
// ]
```

**Important Notes:**
- `TRANSITION_TO` only works in `state_execute` phase
- Target state must be a valid transition (validated with `canTransition()`)
- Invalid transitions are treated as `EXIT` with a warning
- Output is set on the **failed state**, not the target state

#### STOP_RETRY

Stop retry attempts immediately and proceed with the current error handling. Only applicable when used with `@Retry` decorator.

**Behavior:**
- Stops any remaining retry attempts
- Error is handled according to default behavior (FAIL)
- Useful when you want to fail fast on specific errors

```typescript
return ErrorHandlingDecision.STOP_RETRY;
```

**Use cases:**
- Validation errors that won't succeed on retry
- Authentication failures
- Business rule violations
- Rate limiting or quota exceeded errors

### Error Context

The error handler receives an `ErrorContext` with full information:

```typescript
interface ErrorContext {
  error: Error;               // The original error
  phase: ErrorPhase;          // Which phase threw the error
  workflowContext: WorkflowContext;  // Full workflow context
}
```

Access workflow data to make informed decisions:

```typescript
class SmartErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    // Access workflow data
    const isTestOrder = workflowContext.data.orderId?.startsWith('TEST-');

    if (isTestOrder) {
      // Don't persist failures for test orders
      return ErrorHandlingDecision.FAIL_NO_PERSIST;
    }

    // Access current state
    if (workflowContext.currentState === 'PAYMENT') {
      // Payment failures always get persisted
      return ErrorHandlingDecision.FAIL;
    }

    // Access outputs from previous states
    const paymentCompleted = workflowContext.outputs['PAYMENT']?.completed;
    if (paymentCompleted && phase === 'after_state') {
      // Payment succeeded, continue despite afterState error
      return ErrorHandlingDecision.CONTINUE;
    }

    return ErrorHandlingDecision.FAIL;
  }
}
```

### Practical Examples

#### Example 1: Distributed Lock Handling

Handle Prisma error P2002 when another workflow instance acquires the lock:

```typescript
class DistributedLockHandler implements ErrorHandler {
  constructor(private readonly logger: LoggerService) {}

  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase } = context;

    if (phase === 'lock_acquisition') {
      this.logger.info('Lock held by another instance', {
        executionId: context.workflowContext.executionId,
        groupId: context.workflowContext.groupId,
      });

      // Exit gracefully, another instance is processing
      return ErrorHandlingDecision.EXIT;
    }

    // Check for database lock errors (Prisma P2002, etc.)
    if (error.message.includes('P2002') || error.message.includes('unique constraint')) {
      this.logger.warn('Database lock conflict, exiting');
      return ErrorHandlingDecision.EXIT;
    }

    return ErrorHandlingDecision.FAIL;
  }
}

@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  concurrency: {
    mode: ConcurrencyMode.SEQUENTIAL,
    groupBy: 'orderId',
  },
  errorHandler: new DistributedLockHandler(loggerService),
})
export class OrderWorkflow {}
```

#### Example 2: Retry on Specific Errors

Continue execution on temporary/retryable errors:

```typescript
class RetryableErrorHandler implements ErrorHandler {
  private readonly retryableErrors = [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'NetworkError',
    'TemporaryFailure'
  ];

  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase } = context;

    // Only apply retry logic to state execution
    if (phase === 'state_execute') {
      // Check if error is retryable
      const isRetryable = this.retryableErrors.some(
        msg => error.message.includes(msg)
      );

      if (isRetryable) {
        // Use @Retry decorator on state for automatic retries
        // Error handler can control retry behavior on each attempt
        return ErrorHandlingDecision.FAIL;  // Allows @Retry to work
      }

      return ErrorHandlingDecision.FAIL;
    }

    // For lifecycle hooks, can use CONTINUE
    if (phase === 'before_state' || phase === 'after_state') {
      return ErrorHandlingDecision.CONTINUE;
    }

    return ErrorHandlingDecision.FAIL;
  }
}
```

#### Example 3: Conditional Error Routing

Route errors to different handling based on error type:

```typescript
class ConditionalErrorHandler implements ErrorHandler {
  constructor(
    private readonly logger: LoggerService,
    private readonly alertService: AlertService,
    private readonly metricsService: MetricsService
  ) {}

  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    // Log all errors
    this.logger.error(`Workflow error in ${phase}`, {
      error: error.message,
      executionId: workflowContext.executionId,
      state: workflowContext.currentState,
    });

    // Increment error metrics
    this.metricsService.increment(`workflow.error.${phase}`);

    // Validation errors - fail without persisting
    if (error.name === 'ValidationError') {
      return ErrorHandlingDecision.FAIL_NO_PERSIST;
    }

    // Critical errors - alert and fail
    if (error.message.includes('CRITICAL') || error.message.includes('FATAL')) {
      this.alertService.sendCriticalAlert({
        workflow: workflowContext.data.workflowName,
        executionId: workflowContext.executionId,
        error: error.message,
      });
      return ErrorHandlingDecision.FAIL;
    }

    // Lock conflicts - exit gracefully
    if (phase === 'lock_acquisition') {
      return ErrorHandlingDecision.EXIT;
    }

    // Non-critical hook errors - continue
    if (phase === 'before_state' || phase === 'after_state') {
      if (error.message.includes('Logging') || error.message.includes('Analytics')) {
        return ErrorHandlingDecision.CONTINUE;
      }
    }

    // Default: fail and persist
    return ErrorHandlingDecision.FAIL;
  }
}
```

#### Example 4: Environment-Specific Handling

Different behavior for development vs production:

```typescript
class EnvironmentAwareErrorHandler implements ErrorHandler {
  constructor(
    private readonly env: 'development' | 'production',
    private readonly logger: LoggerService
  ) {}

  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    if (this.env === 'development') {
      // In development, log everything and fail without persisting
      console.error(`[DEV] Error in ${phase}:`, error);
      console.error('Context:', workflowContext);
      return ErrorHandlingDecision.FAIL_NO_PERSIST;
    }

    // Production behavior
    if (phase === 'lock_acquisition') {
      // Silently exit on lock conflicts
      return ErrorHandlingDecision.EXIT;
    }

    if (phase === 'state_execute') {
      // Log state execution errors with full context
      this.logger.error('State execution failed', {
        executionId: workflowContext.executionId,
        state: workflowContext.currentState,
        error: error.message,
        stack: error.stack,
      });
      return ErrorHandlingDecision.FAIL;
    }

    // Continue on hook errors in production
    if (phase === 'before_state' || phase === 'after_state') {
      this.logger.warn(`${phase} hook failed, continuing`, {
        error: error.message,
      });
      return ErrorHandlingDecision.CONTINUE;
    }

    return ErrorHandlingDecision.FAIL;
  }
}
```

### Integration with Monitoring

Integrate error handler with monitoring systems:

```typescript
class MonitoredErrorHandler implements ErrorHandler {
  constructor(
    private readonly sentry: SentryService,
    private readonly datadog: DatadogService,
    private readonly pagerduty: PagerDutyService
  ) {}

  handle(context: ErrorContext): ErrorHandlingDecision {
    const { error, phase, workflowContext } = context;

    // Send to Sentry
    this.sentry.captureException(error, {
      tags: {
        workflow: workflowContext.data.workflowName,
        phase,
        executionId: workflowContext.executionId,
      },
      extra: {
        state: workflowContext.currentState,
        data: workflowContext.data,
      },
    });

    // Send metrics to Datadog
    this.datadog.increment('workflow.error', {
      workflow: workflowContext.data.workflowName,
      phase,
      state: workflowContext.currentState,
    });

    // Page on critical errors
    if (error.message.includes('Payment') || error.message.includes('CRITICAL')) {
      this.pagerduty.trigger({
        severity: 'critical',
        summary: `Workflow ${workflowContext.data.workflowName} failed`,
        details: {
          error: error.message,
          executionId: workflowContext.executionId,
          phase,
        },
      });
      return ErrorHandlingDecision.FAIL;
    }

    // Exit gracefully on lock conflicts
    if (phase === 'lock_acquisition') {
      return ErrorHandlingDecision.EXIT;
    }

    return ErrorHandlingDecision.FAIL;
  }
}
```

### Default Behavior

Without an error handler, FlowMesh uses default FAIL behavior:

- All errors result in FAIL decision
- Execution marked as failed and persisted
- onError hooks are called
- Error is thrown to caller

```typescript
// No error handler configured
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
})
export class OrderWorkflow {}

// Equivalent to:
@Workflow({
  name: 'OrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATED,
  errorHandler: {
    handle: () => ErrorHandlingDecision.FAIL
  },
})
export class OrderWorkflow {}
```

### Best Practices

**DO:**
- Use EXIT for distributed lock conflicts in sequential mode
- Use CONTINUE for non-critical monitoring/logging failures
- Use FAIL for business-critical errors that need investigation
- Use FAIL_NO_PERSIST for validation errors in development
- Log all errors regardless of decision
- Integrate with monitoring/alerting systems
- Test error handling with different error scenarios

**DON'T:**
- Don't use CONTINUE for state_execute errors (not supported)
- Don't exit silently without logging in production
- Don't persist validation errors in test environments
- Don't ignore critical errors like payment failures
- Don't make error handler itself throw errors (fallback to FAIL)

**Error Handler Safety:**
- If error handler throws, FlowMesh falls back to FAIL decision
- Error handlers should be defensive and never throw
- Always have a default case that returns a decision

```typescript
class SafeErrorHandler implements ErrorHandler {
  handle(context: ErrorContext): ErrorHandlingDecision {
    try {
      // Your error handling logic
      return this.handleError(context);
    } catch (handlerError) {
      // Handler itself failed, log and use default
      console.error('Error handler failed:', handlerError);
      return ErrorHandlingDecision.FAIL;
    }
  }

  private handleError(context: ErrorContext): ErrorHandlingDecision {
    // Implementation
    return ErrorHandlingDecision.FAIL;
  }
}
```

## Concurrency Control

FlowMesh provides three concurrency modes for controlling parallel workflow executions.

### Sequential Mode

Only one workflow execution per group at a time. Subsequent executions wait for lock.

```typescript
@Workflow({
  concurrency: {
    mode: ConcurrencyMode.SEQUENTIAL,
    groupBy: 'orderId',
  },
})
export class OrderWorkflow {}
```

**Use cases:**
- Order processing (prevent duplicate orders)
- Payment transactions
- Critical state updates

### Parallel Mode

No concurrency restrictions. All executions run simultaneously.

```typescript
@Workflow({
  concurrency: {
    mode: ConcurrencyMode.PARALLEL,
  },
})
export class AnalyticsWorkflow {}
```

**Use cases:**
- Independent analytics
- Notifications
- Read-only operations

### Throttle Mode

Limit concurrent executions after initial lock release.

```typescript
@Workflow({
  concurrency: {
    mode: ConcurrencyMode.THROTTLE,
    groupBy: 'userId',
    maxConcurrentAfterUnlock: 3,
  },
})
export class ApiRequestWorkflow {}
```

Requires `@UnlockAfter()` decorator on at least one state:

```typescript
@State(ApiState.VALIDATE)
@UnlockAfter()
export class ValidateState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // After this state, hard lock is released
    // Soft lock allows up to maxConcurrentAfterUnlock executions
    actions.next({ output: { validated: true } });
  }
}
```

**Use cases:**
- API rate limiting
- Resource pool management
- Batch processing with limits

### Partial Unlock

Release hard lock early to allow other operations while workflow continues.

```typescript
@State(OrderState.PAYMENT)
@UnlockAfter()
export class PaymentState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Process payment
    // After this state, lock is released
    actions.next({ output: { paid: true } });
  }
}

@State(OrderState.SEND_EMAIL)
export class SendEmailState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // This runs without holding the hard lock
    // Other workflows can start
    actions.next({ output: { emailSent: true } });
  }
}
```

## Suspend and Resume

Workflows can be suspended to wait for external events and resumed later.

### How Resume Works

**Important:** When you resume a suspended workflow with default (RETRY) strategy:
1. The suspended state's `execute()` method **runs again** with updated data
2. The `options.data` is merged with existing execution data
3. Your state logic must check the updated data to decide whether to continue or suspend again

This allows the state to re-evaluate its condition with fresh data.

Other strategies (SKIP, GOTO) bypass the suspended state and move to the next or target state directly.

### Suspend Workflow

When a state needs to wait for external data (webhook, user approval, etc.), use `actions.suspend()`:

```typescript
@State(OrderState.AWAITING_PAYMENT)
export class AwaitingPaymentState implements IState {
  execute(ctx: WorkflowContext, actions: StateActions) {
    // Check if payment data is available (e.g., set via resume)
    if (!ctx.data.paymentReceived) {
      // Still waiting - suspend the workflow
      actions.suspend({
        waitingFor: 'payment_webhook',
        output: { pendingAt: new Date() }
      });
    } else {
      // Payment received via resume - continue to next state
      actions.next({
        output: {
          paymentId: ctx.data.paymentId,
          processedAt: new Date()
        }
      });
    }
  }
}
```

**Key points:**
- State checks `ctx.data` to decide: suspend or continue
- When resumed, the same state executes again with updated data
- State can suspend multiple times if condition isn't met

### Resume Workflow

There are two ways to provide data when resuming:

#### Option 1: Pass data in options (Recommended)

```typescript
// Resume with updated data (default RETRY strategy)
const result = await engine.resume(OrderWorkflow, executionId, {
  data: {
    paymentReceived: true,
    paymentId: 'pay_123'
  }
});

// The AWAITING_PAYMENT state will execute again
// This time ctx.data.paymentReceived = true, so it continues
```

#### Option 2: Update Persistence First

```typescript
// Update data in database
await persistence.update(executionId, {
  data: {
    ...existingData,
    paymentReceived: true,
    paymentId: 'pay_123'
  }
});

// Resume without passing data (uses data from DB)
const result = await engine.resume(OrderWorkflow, executionId);
```

**Both approaches work**, but Option 1 is more atomic and recommended.

### Complete Example

```typescript
// 1. Initial execution - workflow suspends
const execution = await engine.execute(OrderWorkflow, {
  data: {
    orderId: 'ORD-001',
    paymentReceived: false
  }
});

console.log(execution.status);        // 'suspended'
console.log(execution.currentState);  // 'AWAITING_PAYMENT'

// 2. External event occurs (webhook received)
// Resume with updated data
const resumed = await engine.resume(OrderWorkflow, execution.id, {
  data: {
    paymentReceived: true,
    paymentId: 'pay_xyz123'
  }
});

console.log(resumed.status);  // 'completed' (if no more states)
console.log(resumed.outputs[OrderState.AWAITING_PAYMENT]?.paymentId);  // 'pay_xyz123'
```

### Resume Strategies

FlowMesh supports different strategies for resuming suspended workflows:

#### RETRY Strategy (Default)

Re-executes the suspended state with updated data. This is the default behavior.

```typescript
import { ResumeStrategy } from 'flowmesh';
```

```typescript

// Explicit RETRY strategy
const resumed = await engine.resume(OrderWorkflow, executionId, {
  strategy: ResumeStrategy.RETRY,
  data: { paymentReceived: true }
});

// Or omit strategy (defaults to RETRY)
const resumed = await engine.resume(OrderWorkflow, executionId, {
  data: { paymentReceived: true }
});
```

**Use case:** When the suspended state needs to re-evaluate its condition with new data.

#### SKIP Strategy

Skips the suspended state and moves to the next state in the workflow.

```typescript
const resumed = await engine.resume(OrderWorkflow, executionId, {
  strategy: ResumeStrategy.SKIP,
  data: { skipReason: 'Manual override' }
});
```

**Use case:** When you want to bypass the suspended state (e.g., manual intervention, error recovery).

**Important:**
- The output for the suspended state remains as it was when suspended
- A transition is added to history showing the skip (duration: 0)
- If there's no next state, the workflow completes

#### GOTO Strategy

Jumps to a specific state, bypassing the normal flow.

```typescript
const resumed = await engine.resume(OrderWorkflow, executionId, {
  strategy: ResumeStrategy.GOTO,
  targetState: OrderState.SHIPPING,
  data: { fastTrack: true }
});
```

**Use case:** When you need explicit control over which state to execute next (e.g., error recovery, workflow correction).

**Important:**
- `targetState` is required when using GOTO strategy
- The target state must be registered in the StateRegistry
- A transition is added to history from suspended state to target state

#### Strategy Comparison

| Strategy | Suspended State Re-executes? | Next State | Use Case |
|----------|------------------------------|------------|----------|
| RETRY (default) | ✅ Yes | Determined by state logic | Normal resume with updated data |
| SKIP | ❌ No | Next in workflow sequence | Bypass suspended state |
| GOTO | ❌ No | Explicit target state | Jump to specific state |

### Check Workflow Status

```typescript
const execution = await engine.getExecution(executionId);

if (execution.status === WorkflowStatus.SUSPENDED) {
  console.log('Waiting for:', execution.suspension?.waitingFor);
  console.log('Suspended at state:', execution.currentState);
}
```

### Common Pattern: Webhook Handler

```typescript
// Webhook endpoint
app.post('/webhook/payment/:executionId', async (req, res) => {
  const { executionId } = req.params;
  const webhookData = req.body;

  // Resume workflow with webhook data
  await engine.resume(OrderWorkflow, executionId, {
    data: {
      paymentReceived: true,
      paymentId: webhookData.paymentId,
      paymentStatus: webhookData.status
    }
  });

  res.sendStatus(200);
});
```

## Adapters

FlowMesh uses adapter pattern for external dependencies.

### Persistence Adapter

Store and retrieve workflow executions.

```typescript
interface PersistenceAdapter {
  save(execution: WorkflowExecution): Promise<void>;
  load(executionId: string): Promise<WorkflowExecution | null>;
  update(executionId: string, updates: Partial<WorkflowExecution>): Promise<void>;
  find(filter: ExecutionFilter): Promise<WorkflowExecution[]>;
}

interface ExecutionFilter {
  status?: WorkflowStatus | WorkflowStatus[];
  groupId?: string;
  workflowName?: string;
  currentState?: string;
}
```

**Built-in adapter:**

```typescript
import { InMemoryPersistenceAdapter } from 'flowmesh';

const engine = new WorkflowEngine({
  persistence: new InMemoryPersistenceAdapter()
});
```

**Custom adapter example:**

```typescript
class PostgresPersistenceAdapter implements IPersistenceAdapter {
  constructor(private readonly pool: Pool) {}

  async save(execution: WorkflowExecution): Promise<void> {
    await this.pool.query(
      'INSERT INTO workflow_executions (id, workflow_name, data, status) VALUES ($1, $2, $3, $4)',
      [execution.id, execution.workflowName, execution.data, execution.status]
    );
  }

  async load(executionId: string): Promise<WorkflowExecution | null> {
    const result = await this.pool.query(
      'SELECT * FROM workflow_executions WHERE id = $1',
      [executionId]
    );
    return result.rows[0] || null;
  }

  // ... implement update and find
}
```

### Lock Adapter

Manage distributed locks for concurrency control.

```typescript
interface ILockAdapter {
  acquire(key: string, executionId: string, ttl?: number): Promise<boolean>;
  release(key: string): Promise<void>;
  extend(key: string, ttl: number): Promise<boolean>;
  isLocked(key: string): Promise<boolean>;
}
```

**Built-in adapter:**

```typescript
import { InMemoryLockAdapter } from 'flowmesh';

const engine = new WorkflowEngine({
  lockAdapter: new InMemoryLockAdapter()
});
```

**Redis adapter example:**

```typescript
import Redis from 'ioredis';

class RedisLockAdapter implements ILockAdapter {
  constructor(private readonly redis: Redis) {}

  async acquire(key: string, executionId: string, ttl = 60000): Promise<boolean> {
    const result = await this.redis.set(key, executionId, 'PX', ttl, 'NX');
    return result === 'OK';
  }

  async release(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async extend(key: string, ttl: number): Promise<boolean> {
    const result = await this.redis.pexpire(key, ttl);
    return result === 1;
  }

  async isLocked(key: string): Promise<boolean> {
    const value = await this.redis.get(key);
    return value !== null;
  }
}
```

### Logger Adapter

Custom logging implementation.

```typescript
interface LoggerAdapter {
  log(message: string, context?: unknown): void;
  error(message: string, error?: Error, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  debug(message: string, context?: unknown): void;
}
```

## NestJS Integration

FlowMesh integrates seamlessly with NestJS, providing **fully automatic** dependency injection for workflows and states with zero boilerplate.

### Module Setup

Simply import `FlowMeshModule` - everything else is automatic:

```typescript
import { Module } from '@nestjs/common';
import { FlowMeshModule } from 'flowmesh';

@Module({
  imports: [FlowMeshModule],  // Global by default
})
export class AppModule {}
```

That's it! FlowMeshModule automatically:
- Discovers all `@State` decorated classes
- Registers them with StateRegistry
- Sets up dependency injection for all workflows
- Configures adapters from `@WorkflowConfig`

### Creating Executable Workflows

Workflows extend `ExecutableWorkflow` and use `@WorkflowConfig` for per-workflow configuration:

```typescript
import { Injectable } from '@nestjs/common';
import { Workflow, WorkflowConfig, ExecutableWorkflow } from 'flowmesh';

@Workflow({
  name: 'OrderProcessing',
  states: OrderState,
  initialState: OrderState.CREATED,
  transitions: [
    { from: [OrderState.CREATED], to: OrderState.PAYMENT },
    { from: [OrderState.PAYMENT], to: OrderState.COMPLETE },
  ],
})
@WorkflowConfig({
  persistence: PostgresPersistenceAdapter,  // Optional: DI class reference
  lockAdapter: RedisLockAdapter,            // Optional: DI class reference
})
@Injectable()
export class OrderWorkflow extends ExecutableWorkflow<OrderData> {
  constructor(private readonly orderService: OrderService) {
    super();
    // No manual setup needed!
  }
}
```

**Key points:**
- No `@Inject(FLOWMESH_MODULE_REF)` needed
- No `setInstanceFactory()` call needed
- Adapters in `@WorkflowConfig` are resolved from DI automatically

### Dependency Injection in States

States are regular NestJS providers with full DI support:

```typescript
import { Injectable } from '@nestjs/common';
import { State } from 'flowmesh';

@State(OrderState.PAYMENT)
@Injectable()
export class PaymentState implements IState {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly logger: LoggerService
  ) {}

  execute(ctx: WorkflowContext, actions: StateActions) {
    const result = this.paymentService.process(ctx.data.amount);
    this.logger.log(`Payment processed: ${result}`);
    actions.next({ output: { paid: true } });
  }
}
```

### Module Configuration

Register workflows and states as providers, and declare workflows with `@RegisterWorkflows`:

```typescript
import { RegisterWorkflows } from 'flowmesh';

@Module({
  imports: [FlowMeshModule, DatabaseModule],
  providers: [
    // Services
    OrderService,
    PaymentService,

    // Workflows
    OrderWorkflow,

    // States
    CreatedState,
    PaymentState,
    CompletedState,
  ],
  exports: [OrderWorkflow],
})
@RegisterWorkflows([OrderWorkflow])
export class OrderModule {}
```

**That's it!** FlowMeshModule automatically:
1. Reads `@RegisterWorkflows` metadata to find workflows
2. Finds all `@State` decorated classes (CreatedState, PaymentState, CompletedState)
3. Registers states with StateRegistry
4. Injects `instanceFactory` into workflows for DI resolution

No `OnModuleInit`, no manual registration, no boilerplate.

### Using Workflows

Inject workflow instances directly into your services:

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderService {
  constructor(private readonly orderWorkflow: OrderWorkflow) {}

  async createOrder(data: OrderData) {
    // Execute workflow directly
    const result = await this.orderWorkflow.execute(data);
    return result;
  }

  async resumeOrder(executionId: string, data?: Partial<OrderData>) {
    const result = await this.orderWorkflow.resume(executionId, {
      data,
      strategy: ResumeStrategy.RETRY,
    });
    return result;
  }
}
```

### Workflow Composition

Workflows can be composed by injecting one workflow into another's states:

```typescript
@State(OrderState.PAYMENT)
@Injectable()
export class PaymentState implements IState {
  constructor(
    private readonly paymentWorkflow: PaymentWorkflow  // Nested workflow
  ) {}

  async execute(ctx: WorkflowContext, actions: StateActions) {
    // Execute nested workflow
    const paymentResult = await this.paymentWorkflow.execute({
      amount: ctx.data.amount,
      userId: ctx.data.userId,
    });

    actions.next({ output: { paymentId: paymentResult.id } });
  }
}
```

### Per-Workflow Configuration

Use `@WorkflowConfig` to specify different adapters for different workflows:

```typescript
// Workflow with PostgreSQL persistence
@WorkflowConfig({
  persistence: PostgresPersistenceAdapter,
  lockAdapter: RedisLockAdapter,
})
@Injectable()
export class OrderWorkflow extends ExecutableWorkflow {}

// Workflow without persistence (in-memory only)
@WorkflowConfig({})
@Injectable()
export class NotificationWorkflow extends ExecutableWorkflow {}
```

## Workflow Graphs

FlowMesh provides powerful graph generation capabilities for visualizing and analyzing workflows. There are two types of graphs:

### Static Workflow Graph

Generate a complete graph showing all possible states and transitions from workflow metadata:

```typescript
// Get static graph with all possible paths
const graph = engine.getWorkflowGraph(WithdrawalWorkflow);

console.log(graph.workflowName);  // 'cryptocurrency-withdrawal'
console.log(graph.nodes.length);   // All states from enum
console.log(graph.edges.length);   // All possible transitions
```

**Graph Structure:**

```typescript
interface WorkflowGraph {
  workflowName: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;              // State name
  label: string;           // Display label
  isInitial: boolean;      // Is this the initial state?
  isVirtual?: boolean;     // Can be skipped via conditional transition?
  metadata?: {             // State decorators
    timeout?: number;
    retry?: RetryConfig;
    unlockAfter?: boolean;
  };
}

interface GraphEdge {
  from: string;                // Source state
  to: string;                  // Target state
  type: 'explicit' | 'conditional' | 'automatic';
  condition?: string;          // Function string for conditionals
  label?: string;              // 'condition 1', 'default', 'next'
  virtualStates?: string[];    // States skipped on this transition
}
```

**Example - Iterating Through Graph:**

```typescript
const graph = engine.getWorkflowGraph(WithdrawalWorkflow);

// Show all states (including rollback states)
graph.nodes.forEach(node => {
  const markers = [
    node.isInitial ? '[INITIAL]' : '',
    node.isVirtual ? '(can be skipped)' : '',
  ].filter(Boolean).join(' ');

  console.log(`${node.id} ${markers}`);

  // Show state metadata
  if (node.metadata) {
    if (node.metadata.timeout) {
      console.log(`  Timeout: ${node.metadata.timeout}ms`);
    }
    if (node.metadata.retry) {
      console.log(`  Retry: ${node.metadata.retry.maxAttempts} attempts`);
    }
  }
});

// Show all transitions
graph.edges.forEach(edge => {
  const skipInfo = edge.virtualStates
    ? ` [skips: ${edge.virtualStates.join(', ')}]`
    : '';
  console.log(`${edge.from} → ${edge.to} [${edge.type}]${skipInfo}`);
});
```

**Virtual States:**

States marked as `isVirtual: true` can be skipped via conditional transitions with `virtualOutputs`:

```typescript
@Workflow({
  conditionalTransitions: [
    {
      from: OrderState.START,
      conditions: [
        {
          condition: ctx => ctx.data.isPremium,
          to: OrderState.COMPLETED,
          virtualOutputs: {
            // These states will be skipped but get virtual outputs
            [OrderState.VALIDATION]: { validated: true, skipped: true },
            [OrderState.PAYMENT]: { paid: true, skipped: true },
          },
        },
      ],
      default: OrderState.VALIDATION,
    },
  ],
})
export class OrderWorkflow {}

// In the graph:
const validationNode = graph.nodes.find(n => n.id === 'VALIDATION');
console.log(validationNode.isVirtual);  // true

const premiumEdge = graph.edges.find(e => e.from === 'START' && e.to === 'COMPLETED');
console.log(premiumEdge.virtualStates);  // ['VALIDATION', 'PAYMENT']
```

### Dynamic Execution Graph

Generate a graph showing the actual execution path with statuses and timing:

```typescript
// Execute workflow
const execution = await engine.execute(WithdrawalWorkflow, { data });

// Get execution graph
const execGraph = await engine.getExecutionGraph(execution.id);

console.log(execGraph.status);        // 'completed'
console.log(execGraph.currentState);  // 'COMPLETED'
```

**Graph Structure:**

```typescript
interface ExecutionGraph {
  executionId: string;
  workflowName: string;
  status: WorkflowStatus;   // 'running' | 'suspended' | 'completed' | 'failed'
  currentState: string;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
}

interface ExecutionNode {
  id: string;                // State name
  label: string;
  status: ExecutionNodeStatus;  // 'executed' | 'current' | 'failed' | 'suspended' | 'skipped'
  attempts: number;          // Number of retry attempts
  totalDuration?: number;    // Total execution time in ms
  output?: unknown;          // State output data
  error?: string;            // Error message if failed
}

interface ExecutionEdge {
  from: string;
  to: string;
  status: 'success' | 'failure' | 'suspended' | 'error_recovery';
  transitionType?: 'explicit' | 'conditional' | 'automatic';
  startedAt: Date;
  completedAt?: Date;
  duration?: number;         // Transition duration in ms
  error?: string;
  attempt?: number;          // Retry attempt number
}
```

**Example - Analyzing Execution:**

```typescript
const execGraph = await engine.getExecutionGraph(executionId);

// Show executed states with timing
execGraph.nodes.forEach(node => {
  const timing = node.totalDuration ? `(${node.totalDuration}ms)` : '';
  const retries = node.attempts > 1 ? `[${node.attempts} attempts]` : '';
  console.log(`${node.id}: ${node.status} ${timing} ${retries}`);

  if (node.error) {
    console.log(`  Error: ${node.error}`);
  }
});

// Show transitions with status
execGraph.edges.forEach(edge => {
  const duration = edge.duration ? `${edge.duration}ms` : '';
  console.log(`${edge.from} → ${edge.to} [${edge.status}] ${duration}`);
});
```

**Comparing Static vs Execution Graphs:**

```typescript
// Get both graphs
const staticGraph = engine.getWorkflowGraph(WithdrawalWorkflow);
const execGraph = await engine.getExecutionGraph(executionId);

// Static graph shows ALL possible states (including rollback)
console.log('All possible states:', staticGraph.nodes.length);

// Execution graph shows only states that were actually executed
console.log('Executed states:', execGraph.nodes.length);

// Find which states weren't executed
const executedStateIds = new Set(execGraph.nodes.map(n => n.id));
const notExecuted = staticGraph.nodes.filter(n => !executedStateIds.has(n.id));

console.log('States not executed:', notExecuted.map(n => n.id));
// Example output: ['SIMPLE_ROLLBACK', 'CONVERSION_ROLLBACK']
```

### Use Cases

**1. Visualization** - Generate diagrams for documentation:
```typescript
const graph = engine.getWorkflowGraph(Workflow);

// Generate Mermaid diagram
function toMermaid(graph: WorkflowGraph): string {
  let diagram = 'graph TD\n';

  graph.edges.forEach(edge => {
    const label = edge.virtualStates
      ? `skips: ${edge.virtualStates.join(', ')}`
      : edge.label || '';
    diagram += `  ${edge.from}-->${label}-->${edge.to}\n`;
  });

  return diagram;
}
```

**2. Debugging** - Understand execution vs expected flow:
```typescript
const staticGraph = engine.getWorkflowGraph(Workflow);
const execGraph = await engine.getExecutionGraph(executionId);

// Check if execution followed expected path
const expectedPath = ['START', 'VALIDATION', 'PROCESSING', 'END'];
const actualPath = execGraph.nodes.map(n => n.id);

console.log('Expected:', expectedPath);
console.log('Actual:', actualPath);
```

**3. Validation** - Verify workflow configuration:
```typescript
const graph = engine.getWorkflowGraph(Workflow);

// Find unreachable states
const reachableStates = new Set(graph.edges.map(e => e.to));
reachableStates.add(graph.nodes.find(n => n.isInitial)?.id);

const unreachable = graph.nodes.filter(n => !reachableStates.has(n.id));
console.log('Unreachable states:', unreachable.map(n => n.id));
```

**4. Monitoring** - Track workflow performance:
```typescript
const execGraph = await engine.getExecutionGraph(executionId);

// Find slowest states
const slowStates = execGraph.nodes
  .filter(n => n.totalDuration)
  .sort((a, b) => (b.totalDuration || 0) - (a.totalDuration || 0))
  .slice(0, 5);

console.log('Slowest states:', slowStates);
```

**5. Runtime Analysis** - Compare actual vs possible paths:
```typescript
const staticGraph = engine.getWorkflowGraph(Workflow);
const execGraph = await engine.getExecutionGraph(executionId);

// Show which conditional branch was taken
const conditionalEdges = staticGraph.edges.filter(e => e.type === 'conditional');
const takenTransitions = new Set(
  execGraph.edges.map(e => `${e.from}->${e.to}`)
);

conditionalEdges.forEach(edge => {
  const key = `${edge.from}->${edge.to}`;
  const taken = takenTransitions.has(key) ? '✓' : '✗';
  console.log(`${taken} ${edge.from} → ${edge.to} [${edge.label}]`);
});
```

## API Reference

### WorkflowEngine

#### Constructor

```typescript
new WorkflowEngine(options?: {
  persistence?: IPersistenceAdapter;
  lockAdapter?: ILockAdapter;
  logger?: ILoggerAdapter;
  plugins?: IWorkflowPlugin[];
})
```

#### Methods

**execute**

Start a new workflow execution.

```typescript
execute<TWorkflow, TData, TOutputs>(
  workflow: Type<TWorkflow>,
  options: {
    data: TData;
    groupId?: string;
    executionId?: string;
    metadata?: Record<string, any>;
  }
): Promise<WorkflowExecution<TData, TOutputs>>
```

**Parameters:**
- `data`: Initial workflow data
- `groupId` (optional): Group identifier for concurrency control
- `executionId` (optional): Custom execution ID. If not provided, auto-generated as `exec_{timestamp}_{random}`
- `metadata` (optional): Additional metadata

**resume**

Resume a suspended workflow with different strategies.

```typescript
resume<TWorkflow, TData, TOutputs>(
  workflow: Type<TWorkflow>,
  executionId: string,
  options?: {
    data?: Partial<TData>;
    strategy?: ResumeStrategy;
    targetState?: string;
  }
): Promise<WorkflowExecution<TData, TOutputs>>
```

**Parameters:**
- `workflow`: The workflow class to resume
- `executionId`: ID of the suspended execution
- `options`: Optional resume options
  - `data`: Data to merge with existing execution data
  - `strategy`: Resume strategy (RETRY | SKIP | GOTO), defaults to RETRY
  - `targetState`: Required when strategy is GOTO

**Strategies:**
- `ResumeStrategy.RETRY` (default): Re-executes suspended state with updated data
- `ResumeStrategy.SKIP`: Skips suspended state and moves to next state
- `ResumeStrategy.GOTO`: Jumps to specified target state

**Examples:**
```typescript
// RETRY strategy (default) - re-execute suspended state
const execution = await engine.resume(OrderWorkflow, executionId, {
  data: { webhookReceived: true }
});

// SKIP strategy - bypass suspended state
const execution = await engine.resume(OrderWorkflow, executionId, {
  strategy: ResumeStrategy.SKIP,
  data: { skipReason: 'Manual override' }
});

// GOTO strategy - jump to specific state
const execution = await engine.resume(OrderWorkflow, executionId, {
  strategy: ResumeStrategy.GOTO,
  targetState: 'SHIPPING',
  data: { fastTrack: true }
});
```

**Custom Execution ID**

You can provide a custom `executionId` for idempotency or integration with external systems:

```typescript
// Using custom executionId for idempotency
const transactionId = 'tx_12345';
const result = await engine.execute(WithdrawalWorkflow, {
  data: {
    transactionId,
    amount: 100,
    userId: 'user_123'
  },
  executionId: `withdrawal_${transactionId}` // Custom ID based on transaction
});

// Later, you can retrieve the execution by the same ID
const execution = await engine.getExecution(`withdrawal_${transactionId}`);
```

**Use cases for custom executionId:**
- **Idempotency**: Use external transaction/request IDs to prevent duplicate workflow executions
- **Integration**: Match workflow executions with external system identifiers
- **Tracking**: Use meaningful IDs for easier monitoring and debugging

**With ExecutableWorkflow:**

```typescript
@Workflow({
  name: 'OrderProcessing',
  states: OrderState,
  initialState: OrderState.CREATED
})
class OrderWorkflow extends ExecutableWorkflow<OrderData> {}

// Provide custom executionId as second parameter
const workflow = new OrderWorkflow();
const result = await workflow.execute(
  { orderId: 'ORD-123', items: ['item1'] },
  'order_ORD-123' // Custom executionId
);
```

**getExecution**

Get workflow execution by ID.

```typescript
getExecution(executionId: string): Promise<WorkflowExecution | null>
```

**findExecutions**

Find workflow executions by filters.

```typescript
findExecutions(filters: {
  workflowName?: string;
  status?: WorkflowStatus;
  currentState?: string;
  groupId?: string;
}): Promise<WorkflowExecution[]>
```

### StateRegistry

Global registry for state classes.

#### Methods

**autoRegister**

Register multiple state classes.

```typescript
StateRegistry.autoRegister([
  CreatedState,
  PaymentState,
  CompletedState
])
```

**register**

Register single state class.

```typescript
StateRegistry.register('CREATED', CreatedState)
```

**get**

Get state class by name.

```typescript
const StateClass = StateRegistry.get('CREATED')
```

**getInstance**

Get singleton state instance.

```typescript
const instance = StateRegistry.getInstance('CREATED')
```

**clear**

Clear all registrations (useful for testing).

```typescript
StateRegistry.clear()
```

### StateActions

Actions available in state `execute()` method for controlling workflow flow.

#### Methods

**next(options?)**

Move to the next state in the workflow. The next state is determined by:
1. Conditional transitions (if conditions match)
2. Explicit transitions (if defined)
3. Automatic transitions (enum order)

```typescript
actions.next({
  data?: Partial<TData>,        // Update workflow data
  output?: TOutputs[TState]     // Set current state output
})
```

**goto(state, options?)**

Jump to a specific state. The target state must be allowed by workflow transitions.

```typescript
actions.goto(TargetState.SPECIFIC_STATE, {
  data?: Partial<TData>,        // Update workflow data
  output?: TOutputs[TState]     // Set current state output
})
```

**suspend(options?)**

Pause workflow execution until manually resumed. The workflow status becomes SUSPENDED.

```typescript
actions.suspend({
  waitingFor?: string,          // Reason for suspension (e.g., 'webhook', 'approval')
  data?: Partial<TData>,        // Update workflow data
  output?: TOutputs[TState]     // Set current state output
})
```

**complete(options?)**

Explicitly complete the workflow with success status. Use this to terminate workflow early or when you want precise control over completion.

```typescript
actions.complete({
  data?: Partial<TData>,        // Final workflow data
  output?: TOutputs[TState]     // Final state output
})
```

**When to use `complete()`:**
- Early workflow termination with success status
- Conditional completion based on business logic
- Bypassing remaining states when they're not needed
- Explicit control over final workflow state

**Note:** All actions follow "last action wins" pattern. If multiple actions are called, only the last one takes effect.

### WorkflowExecution

Execution result object.

```typescript
interface WorkflowExecution<TData = Record<string, unknown>> {
  id: string;
  workflowName: string;
  groupId?: string;
  currentState: string;
  status: WorkflowStatus;
  suspension?: SuspensionInfo;
  data: TData;
  outputs: Record<string, unknown>;
  history: StateTransition[];
  metadata: WorkflowMetadata;
}

interface StateTransition<TState = unknown> {
  from: TState;
  to: TState;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  status: 'success' | 'failure' | 'suspended' | 'error_recovery';
  error?: string;
}

interface WorkflowMetadata {
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  totalAttempts: number;
  [key: string]: unknown;
}

interface SuspensionInfo {
  waitingFor?: string;
  metadata?: Record<string, unknown>;
  suspendedAt: Date;
}
```

**WorkflowStatus values:**
- `RUNNING`: Currently executing
- `SUSPENDED`: Waiting for external event
- `COMPLETED`: Successfully completed
- `FAILED`: Failed with error

## Examples

### E-commerce Order Processing

Complete order workflow with inventory check, payment, and fulfillment.

```typescript
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

interface OrderData {
  orderId: string;
  userId: string;
  items: Array<{ sku: string; quantity: number }>;
  total: number;
}

interface OrderOutputs {
  [OrderState.CREATE_ORDER]: { orderId: string };
  [OrderState.VALIDATE_INVENTORY]: { available: boolean };
  [OrderState.PROCESS_PAYMENT]: { paymentId: string; amount: number };
  [OrderState.RESERVE_INVENTORY]: { reservationId: string };
  [OrderState.SEND_CONFIRMATION]: { emailSent: boolean };
  [OrderState.PREPARE_SHIPMENT]: { shipmentId: string };
  [OrderState.SHIP_ORDER]: { trackingNumber: string };
}

@Workflow({
  name: 'CompleteOrderWorkflow',
  states: OrderState,
  initialState: OrderState.CREATE_ORDER,
  concurrency: {
    mode: ConcurrencyMode.SEQUENTIAL,
    groupBy: 'orderId',
  },
})
export class CompleteOrderWorkflow {}

@State(OrderState.CREATE_ORDER)
export class CreateOrderState implements IState {
  execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions) {
    if (!ctx.data.items || ctx.data.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    actions.next({
      output: { orderId: ctx.data.orderId }
    });
  }
}

@State(OrderState.VALIDATE_INVENTORY)
export class ValidateInventoryState implements IState {
  execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions) {
    const available = ctx.data.items.every(item => item.quantity > 0);

    if (!available) {
      throw new Error('Insufficient inventory');
    }

    actions.next({ output: { available } });
  }
}

@State(OrderState.PROCESS_PAYMENT)
@UnlockAfter()
export class ProcessPaymentState implements IState {
  execute(ctx: WorkflowContext<OrderData, OrderOutputs>, actions: StateActions) {
    const paymentId = `pay-${ctx.data.orderId}-${Date.now()}`;

    actions.next({
      output: {
        paymentId,
        amount: ctx.data.total
      }
    });
  }
}

// ... implement remaining states

// Execute workflow
const engine = new WorkflowEngine();
StateRegistry.autoRegister([
  CreateOrderState,
  ValidateInventoryState,
  ProcessPaymentState,
  // ... register all states
]);

const result = await engine.execute(CompleteOrderWorkflow, {
  data: {
    orderId: 'ORD-001',
    userId: 'user-123',
    items: [{ sku: 'PRODUCT-A', quantity: 2 }],
    total: 99.99
  }
});
```

### Multi-Step Approval Workflow

Approval workflow with conditional routing based on amount and type.

```typescript
enum ApprovalState {
  INITIALIZE = 'INITIALIZE',
  AUTO_APPROVE_CHECK = 'AUTO_APPROVE_CHECK',
  MANAGER_REVIEW = 'MANAGER_REVIEW',
  DIRECTOR_REVIEW = 'DIRECTOR_REVIEW',
  FINANCE_REVIEW = 'FINANCE_REVIEW',
  LEGAL_REVIEW = 'LEGAL_REVIEW',
  CONTRACT_SIGNATURE = 'CONTRACT_SIGNATURE',
  PROCESS_APPROVAL = 'PROCESS_APPROVAL',
  REQUEST_COMPLETED = 'REQUEST_COMPLETED',
}

interface ApprovalData {
  requestId: string;
  requestType: 'purchase' | 'contract' | 'expense';
  amount: number;
  autoApprovalEligible?: boolean;
  managerApproved?: boolean;
  directorApproved?: boolean;
  financeApproved?: boolean;
  legalApproved?: boolean;
  signatureReceived?: boolean;
}

@Workflow({
  name: 'ComplexApprovalWorkflow',
  states: ApprovalState,
  initialState: ApprovalState.INITIALIZE,
  concurrency: {
    mode: ConcurrencyMode.THROTTLE,
    groupBy: 'requestType',
    maxConcurrentAfterUnlock: 5,
  },
  conditionalTransitions: [
    {
      from: ApprovalState.AUTO_APPROVE_CHECK,
      conditions: [
        {
          condition: (ctx) => ctx.data.autoApprovalEligible === true,
          to: ApprovalState.PROCESS_APPROVAL
        }
      ],
      default: ApprovalState.MANAGER_REVIEW,
    },
    {
      from: ApprovalState.MANAGER_REVIEW,
      conditions: [
        {
          condition: (ctx) => ctx.data.managerApproved === false,
          to: ApprovalState.REQUEST_COMPLETED
        },
        {
          condition: (ctx) => ctx.data.amount > 10000,
          to: ApprovalState.DIRECTOR_REVIEW
        }
      ],
      default: ApprovalState.FINANCE_REVIEW,
    },
    {
      from: ApprovalState.DIRECTOR_REVIEW,
      conditions: [
        {
          condition: (ctx) => ctx.data.directorApproved === false,
          to: ApprovalState.REQUEST_COMPLETED
        },
        {
          condition: (ctx) => ctx.data.requestType === 'contract',
          to: ApprovalState.LEGAL_REVIEW
        }
      ],
      default: ApprovalState.FINANCE_REVIEW,
    },
  ],
})
export class ComplexApprovalWorkflow {}

@State(ApprovalState.CONTRACT_SIGNATURE)
export class ContractSignatureState implements IState {
  execute(ctx: WorkflowContext<ApprovalData>, actions: StateActions) {
    if (ctx.data.signatureReceived) {
      actions.next({ output: { waiting: false } });
    } else {
      actions.suspend({
        waitingFor: 'contract_signature',
        output: { waiting: true, requestedAt: new Date() }
      });
    }
  }
}

// Execute workflow
const result = await engine.execute(ComplexApprovalWorkflow, {
  data: {
    requestId: 'REQ-001',
    requestType: 'contract',
    amount: 15000,
    autoApprovalEligible: false,
    managerApproved: true,
    directorApproved: true,
  }
});
```

## Testing

### Test Setup

```typescript
import {
  StateRegistry,
  WorkflowEngine,
  InMemoryPersistenceAdapter,
  InMemoryLockAdapter,
  WorkflowStatus
} from 'flowmesh';

describe('OrderWorkflow', () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    // Always clear registry between tests
    StateRegistry.clear();

    engine = new WorkflowEngine({
      persistence: new InMemoryPersistenceAdapter(),
      lockAdapter: new InMemoryLockAdapter()
    });

    StateRegistry.autoRegister([
      CreatedState,
      PaymentState,
      CompletedState
    ]);
  });

  it('should complete order workflow', async () => {
    const result = await engine.execute(OrderWorkflow, {
      data: { orderId: 'ORD-001', items: ['item1'] }
    });

    expect(result.status).toBe(WorkflowStatus.COMPLETED);
    expect(result.outputs[OrderState.CREATED]?.orderId).toBe('ORD-001');
  });

  it('should handle validation errors', async () => {
    await expect(
      engine.execute(OrderWorkflow, {
        data: { orderId: 'ORD-002', items: [] }
      })
    ).rejects.toThrow('Order must contain at least one item');
  });
});
```

### Testing with Type Assertions

```typescript
const result = await engine.execute(OrderWorkflow, { data });

// Type assertions for workflow outputs
const orderId = (result.outputs[OrderState.CREATED] as OrderOutputs[OrderState.CREATED])?.orderId;
expect(orderId).toBe('ORD-001');
```

## Best Practices

1. **Always clear StateRegistry in tests**
   ```typescript
   beforeEach(() => {
     StateRegistry.clear();
   });
   ```

2. **Use type-safe outputs interface**
   ```typescript
   interface OrderOutputs {
     [OrderState.CREATED]: { orderId: string };
     [OrderState.PAYMENT]: { transactionId: string };
   }
   ```

3. **Handle errors in states**
   ```typescript
   execute(ctx, actions) {
     if (!isValid(ctx.data)) {
       throw new Error('Validation failed');
     }
     actions.next({ output });
   }
   ```

4. **Use lifecycle hooks for side effects**
   ```typescript
   @OnStateSuccess()
   onSuccess(ctx, output) {
     this.logger.log('State completed', output);
   }
   ```

5. **Choose appropriate concurrency mode**
   - SEQUENTIAL: Critical operations (payments, orders)
   - PARALLEL: Independent operations (analytics, notifications)
   - THROTTLE: Rate-limited operations (API calls, batch processing)

6. **Use @UnlockAfter for long-running workflows**
   ```typescript
   @State(OrderState.PAYMENT)
   @UnlockAfter()
   export class PaymentState { /* ... */ }
   ```

7. **Suspend workflows for external events**
   ```typescript
   execute(ctx, actions) {
     if (!ctx.data.approved) {
       actions.suspend({ waitingFor: 'approval' });
     }
   }
   ```

8. **Design suspend/resume states to re-evaluate conditions**
   ```typescript
   @State(State.AWAITING_WEBHOOK)
   class AwaitingWebhookState implements IState {
     execute(ctx, actions) {
       // Always check the condition - state re-executes on resume
       if (!ctx.data.webhookReceived) {
         // Still waiting - suspend again
         actions.suspend({ waitingFor: 'webhook' });
       } else {
         // Data updated via resume - continue
         actions.next({ output: { processed: ctx.data.webhookData } });
       }
     }
   }

   // Resume with data
   await engine.resume(Workflow, executionId, {
     data: {
       webhookReceived: true,
       webhookData: { status: 'completed' }
     }
   });
   ```

9. **Use `complete()` for explicit workflow completion**
   ```typescript
   @State(OrderState.PROCESSING)
   class ProcessingState implements IState {
     execute(ctx, actions) {
       // Early completion when conditions are met
       if (ctx.data.autoApproved && ctx.data.amount < 100) {
         actions.complete({
           data: { skipManualReview: true },
           output: { result: 'auto-approved' }
         });
         return;
       }

       // Otherwise continue through remaining states
       actions.next({ output: { needsReview: true } });
     }
   }
   ```

## License

MIT

