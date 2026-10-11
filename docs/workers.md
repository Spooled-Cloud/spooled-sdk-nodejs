# Workers Guide

This guide covers the `SpooledWorker` runtime for processing jobs from queues.

## Basic Worker

```typescript
import { SpooledClient, SpooledWorker } from "@spooled/sdk";

const client = new SpooledClient({ apiKey: "sp_live_..." });

const worker = new SpooledWorker(client, {
  queueName: "emails",
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
  queueName: "my-queue",

  // Concurrency
  concurrency: 10, // Max parallel jobs (default: 5)

  // Polling
  pollInterval: 1000, // Poll every N ms (default: 1000)

  // Lease Management
  leaseDuration: 30, // Lease duration in seconds (default: 30)
  heartbeatFraction: 0.5, // Heartbeat at 50% of lease (default: 0.5)

  // Lifecycle
  autoStart: false, // Auto-start on construction (default: false)
  shutdownTimeout: 30000, // How long stop() lets running handlers finish (default: 30000)

  // Identification
  workerId: "emails-worker-01", // Stable id (default: server-minted UUID)
  hostname: "worker-01", // Worker hostname (default: os.hostname())
  workerType: "nodejs", // Worker type identifier
  version: "my-worker/2.3.0", // Optional application version (defaults to the SDK version)
  metadata: {
    // Custom metadata
    env: "production",
    region: "us-east-1",
  },
});
```

The runtime captures each claimed execution's immutable `leaseId` and echoes it on heartbeat, completion, and failure. If the same job is reclaimed, an older handler cannot settle or clean up the replacement lease.

### Stable Worker IDs

Set `workerId` on any worker that restarts or redeploys. It must be 1-128 characters from
`[A-Za-z0-9._-]`, and it makes registration an upsert: the process reuses a single worker row, and
re-registering an id you already own is not charged against the plan worker cap.

Leave it unset and the server mints a fresh UUID on every start, so each restart leaves the previous
registration counting against the cap until the stale-worker reaper clears it (~2 minutes). A worker
that crash-loops on a tight plan can exhaust its own worker limit that way and start failing to
register with HTTP 429.

Derive the id from something stable about the deployment — a Kubernetes pod name, a systemd instance
name, a container hostname — rather than generating one per process:

```typescript
const worker = new SpooledWorker(client, {
  queueName: "emails",
  workerId: process.env.HOSTNAME ?? "emails-worker-01",
});
```

An id owned by a different organization is rejected with HTTP 409.

## Job Context

The `process` handler receives a context object:

```typescript
interface JobContext {
  jobId: string; // Unique job ID
  queueName: string; // Queue name
  payload: any; // Job payload (your data)
  retryCount: number; // Current retry attempt (0-indexed)
  maxRetries: number; // Max retries configured

  signal: AbortSignal; // Abort signal for cancellation

  progress: (percent: number, message?: string) => Promise<void>;
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta?: any,
  ) => void;
}
```

### Example Handler

```typescript
worker.process(async (ctx) => {
  ctx.log("info", `Starting job ${ctx.jobId}`);

  // Check retry count
  if (ctx.retryCount > 0) {
    ctx.log("warn", `Retry attempt ${ctx.retryCount}/${ctx.maxRetries}`);
  }

  // Process with abort awareness
  for (let i = 0; i < 100; i++) {
    if (ctx.signal.aborted) {
      throw new Error("Job was cancelled");
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
worker.on("started", ({ workerId, queueName }) => {
  console.log(`Worker ${workerId} started on ${queueName}`);
});

worker.on("stopped", ({ workerId, reason }) => {
  console.log(`Worker stopped: ${reason}`);
});

worker.on("error", ({ error }) => {
  console.error("Worker error:", error);
});

// Job lifecycle
worker.on("job:claimed", ({ jobId, queueName }) => {
  console.log(`Claimed job ${jobId}`);
});

worker.on("job:started", ({ jobId, queueName }) => {
  console.log(`Started processing ${jobId}`);
});

worker.on("job:completed", ({ jobId, queueName, result }) => {
  console.log(`Completed ${jobId}:`, result);
});

worker.on("job:failed", ({ jobId, queueName, error, willRetry }) => {
  console.error(`Failed ${jobId}: ${error}`);
  if (willRetry) {
    console.log("Will retry");
  }
});
```

### Removing Event Handlers

```typescript
const unsubscribe = worker.on("job:completed", handler);

// Later...
unsubscribe();

// Or explicitly
worker.off("job:completed", handler);
```

## Graceful Shutdown

Proper shutdown ensures in-progress jobs complete:

```typescript
const worker = new SpooledWorker(client, {
  queueName: "emails",
  shutdownTimeout: 30000, // Wait up to 30 seconds
});

// Handle shutdown signals
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down...");
  await worker.stop();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down...");
  await worker.stop();
  process.exit(0);
});

await worker.start();
```

### Shutdown Behavior

`stop()` drains the worker:

1. The worker stops polling for new jobs. A claim already on the wire is waited
   for, and its jobs are drained like the rest.
2. Running handlers are left alone for up to `shutdownTimeout`. Their
   `ctx.signal` is **not** aborted merely because a stop was requested.
3. A handler that returns is completed, and one that throws is failed, even
   though the stop was requested meanwhile. A finished handler is never dropped.
4. Handlers still running when `shutdownTimeout` ends are aborted
   (`ctx.signal.reason` is "Worker shutdown timeout") and their jobs are failed
   with "Worker shutdown timeout". A result they produce later is discarded.
5. The worker heartbeat and each job's lease heartbeat keep running during the
   drain, so neither the worker nor a lease expires while handlers finish.
6. Acks already in flight are awaited, then the worker deregisters last.
   Deregistering returns every job the worker still holds to the queue, so it
   must come after the acks.

## Job Timeouts

If a job has `timeoutSeconds` (the default is 300 on the server), the worker
aborts the handler after that long: `ctx.signal` is aborted with the reason
"Job timeout exceeded", the worker emits `job:timeout`, and the job is failed
with "Job timeout exceeded" (retried or dead-lettered per its `maxRetries`). The
lease is no longer extended and the concurrency slot is freed, even if the
handler ignores the signal and never returns; a result it produces later is
discarded.

```typescript
worker.on("job:timeout", ({ jobId, queueName }) => {
  console.warn(`Job ${jobId} on ${queueName} timed out`);
});
```

## Delivery of Results

`complete`, `fail` and both heartbeats are idempotent on the server (lease
fenced), so the SDK retries them on network errors, timeouts, 5xx and 408 within
the client's retry budget (`retry.maxRetries`). If an ack still fails after the
retries, the worker emits `error` with the final error and the job runs again
after its lease expires, so keep handlers idempotent.

The error text sent with a failure is always made acceptable to the API: an empty
message becomes "Job failed" and a message over 2048 characters is truncated.

## Abort-Aware Processing

Jobs receive an `AbortSignal` for cooperative cancellation. It is aborted when
the job exceeds its `timeoutSeconds` and when a stop outlives `shutdownTimeout`
(see above), not when a stop is merely requested:

```typescript
worker.process(async (ctx) => {
  // Check at key points
  if (ctx.signal.aborted) {
    throw new Error("Job aborted");
  }

  // Use with fetch
  const response = await fetch("https://api.example.com", {
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
  ctx.signal.addEventListener("abort", () => {
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
    throw new NonRetryableError("Invalid payload format");
  }
  // ...
});
```

## Worker State

Check worker status programmatically:

```typescript
console.log("State:", worker.getState());
// 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

console.log("Worker ID:", worker.getWorkerId());
// null before start, string after

console.log("Active jobs:", worker.getActiveJobCount());
// Number of jobs currently being processed
```

## Multiple Workers

Run multiple workers for different queues:

```typescript
const emailWorker = new SpooledWorker(client, {
  queueName: "emails",
  concurrency: 10,
});

const reportWorker = new SpooledWorker(client, {
  queueName: "reports",
  concurrency: 2, // Reports are CPU-intensive
});

emailWorker.process(async (ctx) => sendEmail(ctx.payload));
reportWorker.process(async (ctx) => generateReport(ctx.payload));

await Promise.all([emailWorker.start(), reportWorker.start()]);

// Graceful shutdown for all
process.on("SIGTERM", async () => {
  await Promise.all([emailWorker.stop(), reportWorker.stop()]);
});
```

## Concurrency Patterns

### CPU-Bound Work

For CPU-intensive tasks, limit concurrency:

```typescript
const worker = new SpooledWorker(client, {
  queueName: "image-processing",
  concurrency: 2, // Match CPU cores - 2
});
```

### I/O-Bound Work

For I/O-heavy tasks (HTTP, database), increase concurrency:

```typescript
const worker = new SpooledWorker(client, {
  queueName: "api-calls",
  concurrency: 50, // Many parallel I/O operations
});
```

### Dynamic Concurrency

Adjust based on system load:

```typescript
import os from "os";

const cpuCount = os.cpus().length;
const loadAvg = os.loadavg()[0]; // 1-minute load average

const worker = new SpooledWorker(client, {
  queueName: "mixed-workload",
  concurrency: Math.max(1, Math.floor(cpuCount - loadAvg)),
});
```

## Logging Best Practices

```typescript
worker.process(async (ctx) => {
  const startTime = Date.now();

  try {
    ctx.log("info", "Starting job", { payload: ctx.payload });

    const result = await processJob(ctx.payload);

    ctx.log("info", "Job completed", {
      duration: Date.now() - startTime,
      result,
    });

    return result;
  } catch (error) {
    ctx.log("error", "Job failed", {
      duration: Date.now() - startTime,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
});
```
