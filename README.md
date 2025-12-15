# @spooled/sdk

Official Node.js/TypeScript SDK for [Spooled Cloud](https://spooled.cloud) - a modern job queue service for distributed applications.

[![npm version](https://badge.fury.io/js/@spooled%2Fsdk.svg)](https://www.npmjs.com/package/@spooled/sdk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Features

- **Full TypeScript support** with comprehensive type definitions
- **ESM and CommonJS** dual package support
- **Automatic retries** with exponential backoff and jitter
- **Circuit breaker** for fault tolerance
- **Realtime events** via WebSocket and SSE
- **Worker runtime** for processing jobs
- **Workflow DAGs** for complex job dependencies
- **gRPC streaming** for high-performance workers
- **Automatic case conversion** between camelCase (SDK) and snake_case (API)

## Installation

```bash
npm install @spooled/sdk
```

## Quick Start

```typescript
import { SpooledClient } from '@spooled/sdk';

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

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, and first job |
| [Configuration](docs/configuration.md) | All configuration options |
| [Workers](docs/workers.md) | Job processing with SpooledWorker |
| [Workflows](docs/workflows.md) | Building DAGs with job dependencies |
| [gRPC](docs/grpc.md) | High-performance streaming |
| [Resources](docs/resources.md) | Complete API reference |

## Examples

See the [`examples/`](examples/) directory for runnable code:

| Example | Description |
|---------|-------------|
| [`quick-start.ts`](examples/quick-start.ts) | Basic SDK usage |
| [`worker.ts`](examples/worker.ts) | Processing jobs with SpooledWorker |
| [`workflow-dag.ts`](examples/workflow-dag.ts) | Complex workflows with dependencies |
| [`grpc-streaming.ts`](examples/grpc-streaming.ts) | High-performance gRPC streaming |
| [`realtime.ts`](examples/realtime.ts) | Real-time event streaming |
| [`schedules.ts`](examples/schedules.ts) | Cron schedules |
| [`error-handling.ts`](examples/error-handling.ts) | Error handling patterns |

## Core Concepts

### Jobs

Jobs are units of work with payloads, priorities, and retry policies:

```typescript
const { id } = await client.jobs.create({
  queueName: 'my-queue',
  payload: { data: 'value' },
  priority: 5,                      // -100 to 100
  maxRetries: 3,
  timeoutSeconds: 300,
  scheduledAt: new Date(Date.now() + 60000),
  idempotencyKey: 'unique-key',
});
```

### Workers

Process jobs with the built-in worker runtime:

```typescript
import { SpooledClient, SpooledWorker } from '@spooled/sdk';

const client = new SpooledClient({ apiKey: 'sk_live_...' });

const worker = new SpooledWorker(client, {
  queueName: 'my-queue',
  concurrency: 10,
});

worker.process(async (ctx) => {
  console.log(`Processing job ${ctx.jobId}`);
  await doSomething(ctx.payload);
  return { success: true };
});

await worker.start();

// Graceful shutdown
process.on('SIGTERM', () => worker.stop());
```

### Workflows (DAGs)

Orchestrate multiple jobs with dependencies:

```typescript
const workflow = await client.workflows.create({
  name: 'ETL Pipeline',
  jobs: [
    { key: 'extract', queueName: 'etl', payload: { step: 'extract' } },
    { key: 'transform', queueName: 'etl', payload: { step: 'transform' }, dependsOn: ['extract'] },
    { key: 'load', queueName: 'etl', payload: { step: 'load' }, dependsOn: ['transform'] },
  ],
});
```

### Schedules

Run jobs on a cron schedule:

```typescript
const schedule = await client.schedules.create({
  name: 'Daily Report',
  cronExpression: '0 0 9 * * *',    // 6-field cron
  timezone: 'America/New_York',
  queueName: 'reports',
  payloadTemplate: { type: 'daily' },
});
```

### Realtime Events

Subscribe to real-time job events:

```typescript
const realtime = await client.realtime();

realtime.on('job.completed', (data) => {
  console.log(`Job completed: ${data.jobId}`);
});

await realtime.connect();
await realtime.subscribe({ queueName: 'my-queue' });
```

## Error Handling

All errors extend `SpooledError` with specific subclasses:

```typescript
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
  isSpooledError,
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
  }
}
```

## gRPC API

For high-throughput workers, use the native gRPC API:

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const packageDefinition = protoLoader.loadSync('spooled.proto');
const spooled = grpc.loadPackageDefinition(packageDefinition).spooled.v1;

const client = new spooled.QueueService(
  'grpc.spooled.cloud:443',
  grpc.credentials.createSsl()
);

const metadata = new grpc.Metadata();
metadata.add('x-api-key', 'sk_live_your_key');

// Stream jobs
const stream = client.StreamJobs({
  queue_name: 'emails',
  worker_id: 'worker-1',
  lease_duration_secs: 300,
}, metadata);

stream.on('data', (job) => {
  console.log('Received job:', job.id);
});
```

See [gRPC Guide](docs/grpc.md) for complete documentation.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  SpooledClientConfig,
  Job, JobStatus, CreateJobParams,
  Queue, QueueStats,
  Schedule, CreateScheduleParams,
  Workflow, CreateWorkflowParams,
  Worker, WorkerStatus,
} from '@spooled/sdk';
```

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.
