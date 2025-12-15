# @spooled/sdk

Official Node.js/TypeScript SDK for [Spooled Cloud](https://spooled.cloud) - a modern job queue service for distributed applications.

[![npm version](https://badge.fury.io/js/@spooled%2Fsdk.svg)](https://www.npmjs.com/package/@spooled/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Features

- 🚀 **Full TypeScript support** with comprehensive type definitions
- 📦 **ESM and CommonJS** dual package support
- 🔄 **Automatic retries** with exponential backoff and jitter
- ⚡ **Circuit breaker** for fault tolerance
- 🔌 **Realtime events** via WebSocket and SSE
- 👷 **Worker runtime** for processing jobs
- 🔒 **Automatic case conversion** between camelCase (SDK) and snake_case (API)

## Installation

```bash
npm install @spooled/sdk
```

## Quick Start

```typescript
import { SpooledClient } from '@spooled/sdk';

// Create a client
const client = new SpooledClient({
  apiKey: 'sk_live_your_api_key'
});

// Create a job
const { id } = await client.jobs.create({
  queueName: 'email-notifications',
  payload: {
    to: 'user@example.com',
    subject: 'Welcome!',
    body: 'Thanks for signing up.'
  },
  priority: 5,
  maxRetries: 3
});

console.log(`Created job: ${id}`);

// Get job status
const job = await client.jobs.get(id);
console.log(`Status: ${job.status}`);
```

## Configuration

```typescript
const client = new SpooledClient({
  // Authentication (required - one of these)
  apiKey: 'sk_live_...',           // API key
  accessToken: 'jwt_token',         // Or JWT token
  
  // API settings
  baseUrl: 'https://api.spooled.cloud',  // Default
  timeout: 30000,                   // Request timeout (ms)
  
  // Retry settings
  retries: 3,                       // Max retry attempts
  retryDelay: 1000,                 // Base delay (ms)
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,                      // Exponential factor
    jitter: true                    // Add randomness
  },
  
  // Circuit breaker
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,            // Failures to open
    successThreshold: 3,            // Successes to close
    timeout: 30000                  // Reset timeout (ms)
  },
  
  // Advanced
  headers: { 'X-Custom': 'header' },
  fetch: customFetch,               // Custom fetch impl
  debug: true                       // Enable logging
});
```

## Resources

### Jobs

```typescript
// Create a job
const { id, created } = await client.jobs.create({
  queueName: 'my-queue',
  payload: { data: 'value' },
  priority: 5,                      // -100 to 100
  maxRetries: 3,
  timeoutSeconds: 300,
  scheduledAt: new Date(Date.now() + 60000),  // Delay execution
  idempotencyKey: 'unique-key',     // Prevent duplicates
  tags: { env: 'production' }
});

// List jobs
const jobs = await client.jobs.list({
  queueName: 'my-queue',
  status: 'pending',
  limit: 10,
  offset: 0
});

// Get job details
const job = await client.jobs.get(id);

// Cancel a job
await client.jobs.cancel(id);

// Retry a failed job
await client.jobs.retry(id);

// Boost priority
await client.jobs.boostPriority(id, 10);

// Get statistics
const stats = await client.jobs.getStats();

// Bulk enqueue
const result = await client.jobs.bulkEnqueue({
  queueName: 'my-queue',
  jobs: [
    { payload: { n: 1 } },
    { payload: { n: 2 } },
    { payload: { n: 3 } }
  ]
});

// Batch status check
const statuses = await client.jobs.batchStatus(['id1', 'id2', 'id3']);

// Dead-letter queue operations
const dlqJobs = await client.jobs.dlq.list();
await client.jobs.dlq.retry({ jobIds: ['id1', 'id2'] });
await client.jobs.dlq.purge({ confirm: true });
```

### Queues

```typescript
// List queues
const queues = await client.queues.list();

// Get queue config
const config = await client.queues.get('my-queue');

// Update queue config
await client.queues.updateConfig('my-queue', {
  maxRetries: 5,
  defaultTimeout: 600,
  rateLimit: 100
});

// Get queue stats
const stats = await client.queues.getStats('my-queue');

// Pause/resume
await client.queues.pause('my-queue', 'Maintenance');
await client.queues.resume('my-queue');
```

### Schedules

```typescript
// Create a schedule
const schedule = await client.schedules.create({
  name: 'Daily Report',
  cronExpression: '0 0 9 * * *',    // 6-field cron
  timezone: 'America/New_York',
  queueName: 'reports',
  payloadTemplate: { type: 'daily' }
});

// List schedules
const schedules = await client.schedules.list();

// Get/update/delete
const s = await client.schedules.get(schedule.id);
await client.schedules.update(schedule.id, { cronExpression: '0 0 8 * * *' });
await client.schedules.delete(schedule.id);

// Pause/resume
await client.schedules.pause(schedule.id);
await client.schedules.resume(schedule.id);

// Manual trigger
const { jobId } = await client.schedules.trigger(schedule.id);

// Get history
const runs = await client.schedules.getHistory(schedule.id, 10);
```

### Workflows

```typescript
// Create a workflow with dependencies
const workflow = await client.workflows.create({
  name: 'ETL Pipeline',
  jobs: [
    { key: 'extract', queueName: 'etl', payload: { step: 'extract' } },
    { key: 'transform', queueName: 'etl', payload: { step: 'transform' }, dependsOn: ['extract'] },
    { key: 'load', queueName: 'etl', payload: { step: 'load' }, dependsOn: ['transform'] }
  ]
});

// Get workflow status
const status = await client.workflows.get(workflow.workflowId);

// Cancel workflow
await client.workflows.cancel(workflow.workflowId);

// Job dependencies
const deps = await client.workflows.jobs.getDependencies(jobId);
await client.workflows.jobs.addDependencies(jobId, { dependsOnJobIds: ['other-job'] });
```

### Webhooks

```typescript
// Create outgoing webhook
const webhook = await client.webhooks.create({
  name: 'Slack Notifications',
  url: 'https://hooks.slack.com/...',
  events: ['job.completed', 'job.failed'],
  secret: 'hmac-secret'
});

// List/get/update/delete
const webhooks = await client.webhooks.list();
const wh = await client.webhooks.get(webhook.id);
await client.webhooks.update(webhook.id, { enabled: false });
await client.webhooks.delete(webhook.id);

// Test webhook
const result = await client.webhooks.test(webhook.id);

// Get delivery history
const deliveries = await client.webhooks.getDeliveries(webhook.id);
```

### API Keys

```typescript
// List keys (sensitive data hidden)
const keys = await client.apiKeys.list();

// Create new key (key shown only once!)
const { id, key } = await client.apiKeys.create({
  name: 'Production API Key',
  queues: ['queue-1', 'queue-2'],  // Optional: restrict to queues
  rateLimit: 1000
});

// Update/revoke
await client.apiKeys.update(id, { name: 'Updated Name' });
await client.apiKeys.revoke(id);
```

### Organizations

```typescript
// Create organization (returns initial API key)
const { organization, apiKey } = await client.organizations.create({
  name: 'My Company',
  slug: 'my-company',
  billingEmail: 'billing@company.com'
});

// Get usage and limits
const usage = await client.organizations.getUsage();
console.log(`Plan: ${usage.plan} (${usage.planDisplayName})`);
console.log(`Jobs today: ${usage.usage.jobsToday.current}/${usage.usage.jobsToday.limit ?? 'unlimited'}`);
```

### Billing

```typescript
// Get billing status (Stripe subscription info)
const status = await client.billing.getStatus();
console.log(status.planTier, status.hasStripeCustomer);

// Create Stripe billing portal session
const portal = await client.billing.createPortal({
  returnUrl: 'https://spooled.cloud/dashboard/billing'
});
console.log('Portal URL:', portal.url);
```

### Dashboard

```typescript
const dashboard = await client.dashboard.get();
console.log('Jobs pending:', dashboard.jobs.pending);
console.log('Queues:', dashboard.queues.length);
```

### Health & Metrics

```typescript
const health = await client.health.get();
console.log(health.status, health.database, health.cache);

const ready = await client.health.readiness();
console.log('Ready:', ready);

const metrics = await client.metrics.get();
console.log(metrics.slice(0, 200));
```

### Admin API

```typescript
const adminClient = new SpooledClient({
  apiKey: 'sk_live_...',
  adminKey: 'admin_...'
});

const orgs = await adminClient.admin.listOrganizations({ planTier: 'pro', limit: 10 });
console.log(orgs.total);

const stats = await adminClient.admin.getStats();
console.log(stats.organizations.total);
```

### Webhook Ingestion

These endpoints are primarily for webhook providers (GitHub/Stripe/custom) and are **signature-based** (not API key based).

```typescript
await client.ingest.custom('org_123', {
  queueName: 'custom_events',
  eventType: 'custom.event',
  payload: { hello: 'world' },
});
```

## Worker Runtime

Process jobs with the built-in worker runtime:

```typescript
import { SpooledClient, SpooledWorker } from '@spooled/sdk';

const client = new SpooledClient({ apiKey: 'sk_live_...' });

const worker = new SpooledWorker(client, {
  queueName: 'my-queue',
  concurrency: 10,           // Process up to 10 jobs simultaneously
  pollInterval: 1000,        // Poll every second
  leaseDuration: 30,         // 30 second lease
  shutdownTimeout: 30000     // Wait 30s for graceful shutdown
});

// Define job handler
worker.process(async (ctx) => {
  console.log(`Processing job ${ctx.jobId}`);
  console.log('Payload:', ctx.payload);
  
  // Check for shutdown signal
  if (ctx.signal.aborted) {
    throw new Error('Job aborted');
  }
  
  // Do work...
  await doSomething(ctx.payload);
  
  // Return optional result
  return { processed: true };
});

// Event handlers
worker.on('job:completed', ({ jobId }) => console.log(`Completed: ${jobId}`));
worker.on('job:failed', ({ jobId, error }) => console.error(`Failed: ${jobId}`, error));

// Start worker
await worker.start();

// Graceful shutdown
process.on('SIGTERM', () => worker.stop());
```

## Realtime Events

Subscribe to real-time events via WebSocket:

```typescript
const realtime = await client.realtime();

// Connection state
realtime.onStateChange((state) => {
  console.log('State:', state); // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
});

// Event handlers
realtime.on('job.created', (data) => {
  console.log(`New job: ${data.jobId} in ${data.queueName}`);
});

realtime.on('job.completed', (data) => {
  console.log(`Job completed: ${data.jobId} in ${data.durationMs}ms`);
});

realtime.on('job.failed', (data) => {
  console.log(`Job failed: ${data.jobId} - ${data.error}`);
});

// Listen to all events
realtime.onEvent((event) => {
  console.log(event.type, event);
});

// Connect and subscribe
await realtime.connect();
await realtime.subscribe({ queueName: 'my-queue' });

// Cleanup
realtime.disconnect();
```

### Choosing WebSocket vs SSE (server load)

- **Default**: WebSocket (`type: 'websocket'`). This is usually **lowest load** on the Spooled backend because it can push events (pub/sub) without polling.
- **SSE**: `type: 'sse'`. In the current backend implementation, SSE queue/job endpoints periodically query the database, which can be heavier at scale. Use SSE primarily when WebSocket is not possible.

```typescript
const realtime = await client.realtime({ type: 'sse' });
await realtime.connect();
await realtime.subscribe({ queueName: 'my-queue' });
```

## gRPC API

Spooled provides a **real gRPC API** on port `50051` using HTTP/2 + Protobuf for high-performance worker communication.

For high-throughput workers or streaming scenarios, consider using the native gRPC client with `@grpc/grpc-js`:

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const packageDefinition = protoLoader.loadSync('spooled.proto');
const spooled = grpc.loadPackageDefinition(packageDefinition).spooled.v1;

const client = new spooled.QueueService(
  'api.spooled.cloud:50051',
  grpc.credentials.createSsl()
);

// Add API key metadata to calls
const metadata = new grpc.Metadata();
metadata.add('x-api-key', 'sk_live_your_key');

client.Enqueue({
  queue_name: 'emails',
  payload: { to: 'user@example.com' },
  max_retries: 3
}, metadata, (err, response) => {
  console.log('Job ID:', response.job_id);
});

// Streaming example
const stream = client.StreamJobs({
  queue_name: 'emails',
  worker_id: 'worker-1',
  lease_duration_secs: 300
}, metadata);

stream.on('data', (job) => {
  console.log('Received job:', job.id);
});
```

**When to use gRPC vs REST:**

| Use Case | Recommended |
|----------|-------------|
| Web/mobile apps | REST API |
| Dashboard/admin | REST API |
| High-throughput workers | gRPC |
| Streaming job delivery | gRPC |

See [spooled-backend/proto/spooled.proto](https://github.com/spooled-cloud/spooled-backend/blob/main/proto/spooled.proto) for the full protocol definition.
## Error Handling

All errors extend `SpooledError` with specific subclasses:

```typescript
import {
  SpooledError,
  AuthenticationError,   // 401
  AuthorizationError,    // 403
  NotFoundError,         // 404
  ValidationError,       // 400
  ConflictError,         // 409
  RateLimitError,        // 429
  ServerError,           // 5xx
  NetworkError,          // Network failure
  TimeoutError,          // Request timeout
  CircuitBreakerOpenError,
  isSpooledError
} from '@spooled/sdk';

try {
  await client.jobs.get('non-existent');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Job not found');
  } else if (error instanceof RateLimitError) {
    console.log(`Retry after ${error.getRetryAfter()} seconds`);
  } else if (isSpooledError(error)) {
    console.log(`API error: ${error.code} - ${error.message}`);
    console.log('Retryable:', error.isRetryable());
  }
}
```

## Case Conversion

The SDK automatically converts between camelCase (SDK) and snake_case (API):

```typescript
// You write camelCase
await client.jobs.create({
  queueName: 'my-queue',
  maxRetries: 3,
  timeoutSeconds: 300
});

// API receives snake_case
// { queue_name: 'my-queue', max_retries: 3, timeout_seconds: 300 }

// Response is converted back
const job = await client.jobs.get(id);
console.log(job.queueName);      // camelCase
console.log(job.maxRetries);     // camelCase
```

**Important:** User-defined JSON blobs (`payload`, `result`, `metadata`, `tags`) are preserved as-is and not converted.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  SpooledClientConfig,
  Job, JobStatus, CreateJobParams,
  Queue, QueueStats,
  Schedule, CreateScheduleParams,
  Workflow, CreateWorkflowParams,
  Worker, WorkerStatus
} from '@spooled/sdk';
```

## Examples

See the [`examples/`](examples/) directory for runnable examples:

- [`quick-start.ts`](examples/quick-start.ts) - Basic usage
- [`worker.ts`](examples/worker.ts) - Processing jobs
- [`realtime.ts`](examples/realtime.ts) - Event streaming
- [`schedules.ts`](examples/schedules.ts) - Cron schedules
- [`error-handling.ts`](examples/error-handling.ts) - Error handling patterns

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.
