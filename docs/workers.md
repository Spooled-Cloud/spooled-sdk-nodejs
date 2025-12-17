# Workers Guide

This guide covers the `SpooledWorker` runtime for processing jobs from queues.

## Basic Worker

```typescript
import { SpooledClient, SpooledWorker } from '@spooled/sdk';

const client = new SpooledClient({ apiKey: 'sk_live_...' });

const worker = new SpooledWorker(client, {
  queueName: 'emails',
  concurrency: 10,
});

worker.process(async (ctx) => {
  console.log(`Processing job ${ctx.jobId}`);
  await sendEmail(ctx.payload);
  return { sent: true };
});

await worker.start();
```

## Configuration Options

```typescript
const worker = new SpooledWorker(client, {
  // Required
  queueName: 'my-queue',

  // Concurrency
  concurrency: 10,           // Max parallel jobs (default: 5)

  // Polling
  pollInterval: 1000,        // Poll every N ms (default: 1000)

  // Lease Management
  leaseDuration: 30,         // Lease duration in seconds (default: 30)
  heartbeatFraction: 0.5,    // Heartbeat at 50% of lease (default: 0.5)

  // Lifecycle
  autoStart: false,          // Auto-start on construction (default: false)
  shutdownTimeout: 30000,    // Max wait for graceful shutdown (default: 30000)

  // Identification
  hostname: 'worker-01',     // Worker hostname (default: os.hostname())
  workerType: 'nodejs',      // Worker type identifier
  version: '1.0.0',          // Application version
  metadata: {                // Custom metadata
    env: 'production',
    region: 'us-east-1',
  },
});
```

## Job Context

The `process` handler receives a context object:

```typescript
interface JobContext {
  jobId: string;              // Unique job ID
  queueName: string;          // Queue name
  payload: any;               // Job payload (your data)
  retryCount: number;         // Current retry attempt (0-indexed)
  maxRetries: number;         // Max retries configured

  signal: AbortSignal;        // Abort signal for cancellation

  progress: (percent: number, message?: string) => Promise<void>;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any) => void;
}
```

### Example Handler

```typescript
worker.process(async (ctx) => {
  ctx.log('info', `Starting job ${ctx.jobId}`);

  // Check retry count
  if (ctx.retryCount > 0) {
    ctx.log('warn', `Retry attempt ${ctx.retryCount}/${ctx.maxRetries}`);
  }

  // Process with abort awareness
  for (let i = 0; i < 100; i++) {
    if (ctx.signal.aborted) {
      throw new Error('Job was cancelled');
    }

    await doStep(i, ctx.payload);
    await ctx.progress(i + 1, `Step ${i + 1}/100`);
  }

  return { processedSteps: 100 };
});
```

## Event Handlers

Workers emit events throughout their lifecycle:

```typescript
// Worker lifecycle
worker.on('started', ({ workerId, queueName }) => {
  console.log(`Worker ${workerId} started on ${queueName}`);
});

worker.on('stopped', ({ workerId, reason }) => {
  console.log(`Worker stopped: ${reason}`);
});

worker.on('error', ({ error }) => {
  console.error('Worker error:', error);
});

// Job lifecycle
worker.on('job:claimed', ({ jobId, queueName }) => {
  console.log(`Claimed job ${jobId}`);
});

worker.on('job:started', ({ jobId, queueName }) => {
  console.log(`Started processing ${jobId}`);
});

worker.on('job:completed', ({ jobId, queueName, result }) => {
  console.log(`Completed ${jobId}:`, result);
});

worker.on('job:failed', ({ jobId, queueName, error, willRetry }) => {
  console.error(`Failed ${jobId}: ${error}`);
  if (willRetry) {
    console.log('Will retry');
  }
});
```

### Removing Event Handlers

```typescript
const unsubscribe = worker.on('job:completed', handler);

// Later...
unsubscribe();

// Or explicitly
worker.off('job:completed', handler);
```

## Graceful Shutdown

Proper shutdown ensures in-progress jobs complete:

```typescript
const worker = new SpooledWorker(client, {
  queueName: 'emails',
  shutdownTimeout: 30000, // Wait up to 30 seconds
});

// Handle shutdown signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  await worker.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...');
  await worker.stop();
  process.exit(0);
});

await worker.start();
```

### Shutdown Behavior

1. Worker stops polling for new jobs
2. Worker heartbeat stops
3. In-progress jobs receive abort signal
4. Wait for jobs to complete (up to `shutdownTimeout`)
5. Force-fail any remaining jobs after timeout
6. Deregister worker from API

## Abort-Aware Processing

Jobs receive an `AbortSignal` for cooperative cancellation:

```typescript
worker.process(async (ctx) => {
  // Check at key points
  if (ctx.signal.aborted) {
    throw new Error('Job aborted');
  }

  // Use with fetch
  const response = await fetch('https://api.example.com', {
    signal: ctx.signal,
  });

  // Use with async iteration
  for await (const item of asyncIterator) {
    if (ctx.signal.aborted) {
      break;
    }
    await processItem(item);
  }
});
```

### AbortController Example

```typescript
worker.process(async (ctx) => {
  // Create child abort controller
  const childController = new AbortController();

  // Propagate parent abort
  ctx.signal.addEventListener('abort', () => {
    childController.abort();
  });

  await longRunningOperation({
    signal: childController.signal,
  });
});
```

## Error Handling

### Throwing Errors

Throwing an error marks the job as failed:

```typescript
worker.process(async (ctx) => {
  const user = await db.users.find(ctx.payload.userId);

  if (!user) {
    throw new Error(`User not found: ${ctx.payload.userId}`);
  }

  await sendEmail(user.email, ctx.payload.template);
});
```

### Retry vs No-Retry Errors

By default, failed jobs are retried up to `maxRetries`. To prevent retries:

```typescript
class NonRetryableError extends Error {
  retryable = false;
}

worker.process(async (ctx) => {
  if (!isValidPayload(ctx.payload)) {
    throw new NonRetryableError('Invalid payload format');
  }
  // ...
});
```

## Worker State

Check worker status programmatically:

```typescript
console.log('State:', worker.getState());
// 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

console.log('Worker ID:', worker.getWorkerId());
// null before start, string after

console.log('Active jobs:', worker.getActiveJobCount());
// Number of jobs currently being processed
```

## Multiple Workers

Run multiple workers for different queues:

```typescript
const emailWorker = new SpooledWorker(client, {
  queueName: 'emails',
  concurrency: 10,
});

const reportWorker = new SpooledWorker(client, {
  queueName: 'reports',
  concurrency: 2, // Reports are CPU-intensive
});

emailWorker.process(async (ctx) => sendEmail(ctx.payload));
reportWorker.process(async (ctx) => generateReport(ctx.payload));

await Promise.all([
  emailWorker.start(),
  reportWorker.start(),
]);

// Graceful shutdown for all
process.on('SIGTERM', async () => {
  await Promise.all([
    emailWorker.stop(),
    reportWorker.stop(),
  ]);
});
```

## Concurrency Patterns

### CPU-Bound Work

For CPU-intensive tasks, limit concurrency:

```typescript
const worker = new SpooledWorker(client, {
  queueName: 'image-processing',
  concurrency: 2, // Match CPU cores - 2
});
```

### I/O-Bound Work

For I/O-heavy tasks (HTTP, database), increase concurrency:

```typescript
const worker = new SpooledWorker(client, {
  queueName: 'api-calls',
  concurrency: 50, // Many parallel I/O operations
});
```

### Dynamic Concurrency

Adjust based on system load:

```typescript
import os from 'os';

const cpuCount = os.cpus().length;
const loadAvg = os.loadavg()[0]; // 1-minute load average

const worker = new SpooledWorker(client, {
  queueName: 'mixed-workload',
  concurrency: Math.max(1, Math.floor(cpuCount - loadAvg)),
});
```

## Logging Best Practices

```typescript
worker.process(async (ctx) => {
  const startTime = Date.now();

  try {
    ctx.log('info', 'Starting job', { payload: ctx.payload });

    const result = await processJob(ctx.payload);

    ctx.log('info', 'Job completed', {
      duration: Date.now() - startTime,
      result,
    });

    return result;
  } catch (error) {
    ctx.log('error', 'Job failed', {
      duration: Date.now() - startTime,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});
```
