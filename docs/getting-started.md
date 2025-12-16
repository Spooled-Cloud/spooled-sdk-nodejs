# Getting Started with @spooled/sdk

This guide walks you through installing, configuring, and using the Spooled SDK for the first time.

## Prerequisites

- Node.js 18.0.0 or later
- An API key from [Spooled Cloud](https://spooled.cloud)

## Installation

```bash
npm install @spooled/sdk
```

Or with yarn/pnpm:

```bash
yarn add @spooled/sdk
pnpm add @spooled/sdk
```

## Creating a Client

```typescript
import { SpooledClient } from '@spooled/sdk';

const client = new SpooledClient({
  apiKey: 'sk_live_your_api_key',
});
```

For local development or testing:

```typescript
const client = new SpooledClient({
  apiKey: process.env.SPOOLED_API_KEY,
  baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
});
```

## Your First Job

### Creating a Job

```typescript
const { id, created } = await client.jobs.create({
  queueName: 'my-first-queue',
  payload: {
    message: 'Hello, Spooled!',
    timestamp: Date.now(),
  },
});

console.log(`Created job: ${id}`);
```

### Checking Job Status

```typescript
const job = await client.jobs.get(id);

console.log(`Status: ${job.status}`);
// 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
```

### Listing Jobs

```typescript
const jobs = await client.jobs.list({
  queueName: 'my-first-queue',
  status: 'pending',
  limit: 10,
});

for (const job of jobs) {
  console.log(`${job.id}: ${job.status}`);
}
```

## Processing Jobs with a Worker

The SDK includes a built-in worker runtime for processing jobs:

```typescript
import { SpooledClient, SpooledWorker } from '@spooled/sdk';

const client = new SpooledClient({ apiKey: 'sk_live_...' });

const worker = new SpooledWorker(client, {
  queueName: 'my-first-queue',
  concurrency: 5,
});

// Define how to process each job
worker.process(async (ctx) => {
  console.log(`Processing job ${ctx.jobId}`);
  console.log('Payload:', ctx.payload);

  // Your business logic here
  await doSomething(ctx.payload);

  // Optionally return a result
  return { success: true };
});

// Start the worker
await worker.start();

// Graceful shutdown on SIGTERM
process.on('SIGTERM', () => worker.stop());
```

## Key Concepts

### Queues

Queues are logical groupings of jobs. Jobs are processed in priority order within each queue.

```typescript
// List all queues
const queues = await client.queues.list();

// Get queue statistics
const stats = await client.queues.getStats('my-queue');
console.log(`Pending: ${stats.pending}, Processing: ${stats.processing}`);
```

### Priority

Jobs have a priority from -100 (lowest) to 100 (highest). Default is 0.

```typescript
// High priority job
await client.jobs.create({
  queueName: 'urgent',
  payload: { alert: 'critical' },
  priority: 100,
});

// Low priority background task
await client.jobs.create({
  queueName: 'background',
  payload: { cleanup: true },
  priority: -50,
});
```

### Retries

Failed jobs are automatically retried based on the `maxRetries` setting:

```typescript
await client.jobs.create({
  queueName: 'emails',
  payload: { to: 'user@example.com' },
  maxRetries: 5,           // Retry up to 5 times
  timeoutSeconds: 60,      // 60 second timeout per attempt
});
```

### Scheduled Jobs

Delay job execution or run at a specific time:

```typescript
// Execute in 5 minutes
await client.jobs.create({
  queueName: 'notifications',
  payload: { reminder: true },
  scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
});
```

### Idempotency

Prevent duplicate jobs with idempotency keys:

```typescript
const result = await client.jobs.create({
  queueName: 'payments',
  payload: { orderId: 'order-123' },
  idempotencyKey: 'payment-order-123',
});

console.log(result.created); // false if job already exists
```

## Plan Limits

All operations automatically enforce tier-based limits:

```typescript
try {
  await client.jobs.create({ /* ... */ });
} catch (error) {
  if (error.statusCode === 403 && error.code === 'limit_exceeded') {
    console.log(`Limit: ${error.message}`);
    console.log(`Current: ${error.current}/${error.limit}`);
    console.log(`Upgrade to: ${error.upgradeTo}`);
  }
}
```

| Tier | Active Jobs | Daily Jobs | Queues | Workers |
|------|-------------|------------|--------|---------|
| **Free** | 10 | 1,000 | 5 | 3 |
| **Starter** | 100 | 100,000 | 25 | 25 |
| **Enterprise** | Unlimited | Unlimited | Unlimited | Unlimited |

Limits are enforced on:
- ✅ Job creation (HTTP & gRPC)
- ✅ Workflow creation
- ✅ Schedule triggers
- ✅ DLQ retry operations
- ✅ Worker registration

## Organization Management

Track usage and manage your organization:

```typescript
// Get current usage and limits
const usage = await client.organizations.getUsage();
console.log(`Active jobs: ${usage.active_jobs.current}/${usage.active_jobs.limit}`);
console.log(`Plan: ${usage.plan.tier}`);

// Check if at risk of hitting limits
if (usage.active_jobs.percentage && usage.active_jobs.percentage > 80) {
  console.warn('Approaching active jobs limit!');
}
```

## Dead Letter Queue

Manage failed jobs that have exhausted retries:

```typescript
// List jobs in DLQ
const dlqJobs = await client.jobs.dlq.list({ limit: 100 });

// Retry failed jobs
await client.jobs.dlq.retry({
  queueName: 'emails',
  limit: 50
});

// Purge old failures
await client.jobs.dlq.purge({
  queueName: 'emails',
  confirm: true,
  olderThan: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
});
```

## Webhooks

Get notified when job events occur:

```typescript
// Create webhook for job events
const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhooks/spooled',
  events: ['job.completed', 'job.failed'],
  queueName: 'my-queue',
  secret: 'webhook_secret_key'
});

// Retry a failed delivery
await client.webhooks.retryDelivery(webhookId, deliveryId);
```

## What's Next?

- [Configuration Guide](./configuration.md) - All configuration options
- [Workers Guide](./workers.md) - Advanced worker patterns
- [Workflows Guide](./workflows.md) - Building DAGs and job dependencies
- [gRPC Guide](./grpc.md) - High-performance streaming (~28x faster)
- [Resources Reference](./resources.md) - Complete API reference

## Examples

Check out the [examples](../examples/) directory for runnable code:

- `quick-start.ts` - Basic usage
- `worker.ts` - Processing jobs
- `workflow-dag.ts` - Complex workflows with dependencies
- `grpc-streaming.ts` - High-performance gRPC streaming
- `realtime.ts` - Real-time event streaming
- `schedules.ts` - Cron schedules
- `error-handling.ts` - Error handling patterns

