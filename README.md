# @spooled/sdk

Official Node.js/TypeScript SDK for [Spooled Cloud](https://spooled.cloud) - a modern job queue service for distributed applications.

[**Live Demo (SpriteForge)**](https://example.spooled.cloud) • [Documentation](https://spooled.cloud/docs)

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
- **gRPC streaming** for high-performance workers (with automatic limit enforcement)
- **Tier-based limits** with automatic enforcement across all endpoints
- **Organization management** with usage tracking
- **Webhook management** with automatic retries
- **Dead Letter Queue (DLQ)** operations
- **Server-side job search** (status lists, text, job type, creation time), paging with `hasMore`, and **job history**
- **API Key management** with Redis caching (~28x faster authentication)
- **Billing integration** via Stripe
- **Automatic case conversion** between camelCase (SDK) and snake_case (API)

## Installation

```bash
npm install @spooled/sdk
```

## Quick Start

```typescript
import { SpooledClient } from "@spooled/sdk";

const client = new SpooledClient({
  apiKey: "sp_live_your_api_key",
  // For self-hosted: baseUrl: 'https://your-spooled-server.com'
});

// Create a job
const { id } = await client.jobs.create({
  queueName: "email-notifications",
  payload: {
    to: "user@example.com",
    subject: "Welcome!",
    body: "Thanks for signing up.",
  },
  priority: 5,
  maxRetries: 3,
});

console.log(`Created job: ${id}`);

// Get job status
const job = await client.jobs.get(id);
console.log(`Status: ${job.status}`);
```

## Documentation

| Guide                                      | Description                         |
| ------------------------------------------ | ----------------------------------- |
| [Getting Started](docs/getting-started.md) | Installation, setup, and first job  |
| [Configuration](docs/configuration.md)     | All configuration options           |
| [Workers](docs/workers.md)                 | Job processing with SpooledWorker   |
| [Workflows](docs/workflows.md)             | Building DAGs with job dependencies |
| [gRPC](docs/grpc.md)                       | High-performance streaming          |
| [Resources](docs/resources.md)             | Complete API reference              |

## Examples

See the [`examples/`](examples/) directory for runnable code:

| Example                                           | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| [`quick-start.ts`](examples/quick-start.ts)       | Basic SDK usage                     |
| [`worker.ts`](examples/worker.ts)                 | Processing jobs with SpooledWorker  |
| [`workflow-dag.ts`](examples/workflow-dag.ts)     | Complex workflows with dependencies |
| [`grpc-streaming.ts`](examples/grpc-streaming.ts) | High-performance gRPC streaming     |
| [`realtime.ts`](examples/realtime.ts)             | Real-time event streaming           |
| [`schedules.ts`](examples/schedules.ts)           | Cron schedules                      |
| [`error-handling.ts`](examples/error-handling.ts) | Error handling patterns             |

## Real-world examples (beginner friendly)

If you want 5 copy/paste “real life” setups (Stripe → jobs, GitHub Actions → jobs, cron schedules, CSV import, website signup), see:

- `https://github.com/spooled-cloud/spooled-backend/blob/main/docs/guides/real-world-examples.md`

## Core Concepts

### Jobs

Jobs are units of work with payloads, priorities, and retry policies:

```typescript
const { id } = await client.jobs.create({
  queueName: "my-queue",
  payload: { data: "value" },
  priority: 5, // -100 to 100
  maxRetries: 3,
  timeoutSeconds: 300,
  scheduledAt: new Date(Date.now() + 60000),
  idempotencyKey: "unique-key",
});
```

Find jobs on the server and page through them (API 0.1.122+):

```typescript
const page = await client.jobs.listPage({
  status: ["failed", "deadletter"], // one status or several
  q: "invoice", // id prefix, or text in the queue name or payload.job_type
  jobType: "send-invoice", // exact payload.job_type
  createdAfter: new Date(Date.now() - 86_400_000), // Date or RFC 3339 string
  limit: 100,
});
console.log(page.data.length, page.hasMore); // hasMore comes from X-Has-More

// What happened to a job: claims, completions, retries, dead-lettering
const history = await client.jobs.history(id, { order: "desc" });
```

`jobs.list()` takes the same filters and still returns a plain array.

### Workers

Process jobs with the built-in worker runtime:

```typescript
import { SpooledClient, SpooledWorker } from "@spooled/sdk";

const client = new SpooledClient({ apiKey: "sp_live_..." });

const worker = new SpooledWorker(client, {
  queueName: "my-queue",
  workerId: "my-queue-worker-01", // stable id — see below
  concurrency: 10,
});

worker.process(async (ctx) => {
  console.log(`Processing job ${ctx.jobId}`);
  await doSomething(ctx.payload);
  return { success: true };
});

await worker.start();

// Graceful shutdown
process.on("SIGTERM", () => worker.stop());
```

`stop()` drains. The worker stops claiming, then lets running handlers finish for up to
`shutdownTimeout` (default 30 s). A handler that returns is completed and one that throws is
failed, even though the stop was requested meanwhile; `ctx.signal` is not aborted during that
grace period. Handlers still running when it ends are aborted and failed with "Worker shutdown
timeout". The worker deregisters last.

If a job has `timeoutSeconds`, the worker aborts the handler (`ctx.signal`) when it runs longer,
emits `job:timeout`, and fails the job with "Job timeout exceeded". The error text sent with a
failure is always made acceptable to the API: empty becomes "Job failed", and text over 2048
characters is truncated.

`complete`, `fail` and both heartbeats are retried on network errors, timeouts and 5xx, because
the server makes them idempotent. If an ack still fails after the retries the worker emits `error`.

Give any worker that restarts a stable `workerId` (1-128 chars, `[A-Za-z0-9._-]`). Registration then
upserts a single row instead of minting a new UUID each start, which otherwise leaves the previous
registration counting against your plan's worker limit until the stale-worker reaper clears it
(~2 minutes). `workers.get()` and `workers.list()` report `jobsProcessed` and `jobsFailed` per worker
(API 0.1.122+).

If you process jobs without `SpooledWorker` (`jobs.claim()` and then `jobs.complete()`,
`jobs.fail()` or `jobs.heartbeat()`), pass the claimed job's `leaseId` on every one of those calls.
The API requires it: a call without it fails with a `ValidationError` (HTTP 422), and a stale lease
with HTTP 409. `SpooledWorker` does this for you.

### Workflows (DAGs)

Orchestrate multiple jobs with dependencies:

```typescript
const workflow = await client.workflows.create({
  name: "ETL Pipeline",
  jobs: [
    { key: "extract", queueName: "etl", payload: { step: "extract" } },
    {
      key: "transform",
      queueName: "etl",
      payload: { step: "transform" },
      dependsOn: ["extract"],
    },
    {
      key: "load",
      queueName: "etl",
      payload: { step: "load" },
      dependsOn: ["transform"],
    },
  ],
});
```

### Schedules

Run jobs on a cron schedule:

```typescript
const schedule = await client.schedules.create({
  name: "Daily Report",
  cronExpression: "0 9 * * *", // 9 AM daily; 5-field (min hour dom mon dow) or 6-field (leading seconds) both work
  timezone: "America/New_York",
  queueName: "reports",
  payloadTemplate: { type: "daily" },
});
```

### Realtime Events

Subscribe to real-time job events:

```typescript
const realtime = await client.realtime();

realtime.on("job.completed", (data) => {
  console.log(`Job completed: ${data.jobId}`);
});

await realtime.connect();
await realtime.subscribe({ queueName: "my-queue" });
```

### Organization Management

Manage your organization and track usage:

```typescript
// Get current usage and limits
const usage = await client.organizations.getUsage();
console.log(
  `Active jobs: ${usage.usage.activeJobs.current}/${usage.usage.activeJobs.limit}`,
);
console.log(`Plan: ${usage.plan}`); // e.g. "free"

// Generate a unique slug for a new organization
const { slug } = await client.organizations.generateSlug("My Company");

// Check if a slug is available
const { available } = await client.organizations.checkSlug("my-company");
```

### Webhooks

Configure outgoing webhooks for job events:

```typescript
// Create webhook
const webhook = await client.webhooks.create({
  name: "App notifications",
  url: "https://your-app.com/webhooks/spooled",
  events: ["job.completed", "job.failed"],
  secret: "webhook_secret_key",
});

// Post dead-lettered jobs and workflow outcomes straight to a Slack channel
await client.webhooks.create({
  name: "On-call",
  url: "https://hooks.slack.com/services/...",
  events: ["job.deadlettered", "workflow.failed"],
  format: "slack", // "json" (default) | "slack" | "discord" | "teams"
});

// Retry a failed delivery
await client.webhooks.retryDelivery(webhookId, deliveryId);

// Get delivery history (retention-bounded: free 1 day, starter 7, pro 30,
// enterprise 90 — and only the newest 100 deliveries per webhook)
const deliveries = await client.webhooks.getDeliveries(webhookId);
```

API 0.1.122 added the events `job.deadlettered`, `job.retried`, `workflow.completed` and
`workflow.failed`, and `format`, which sends each delivery as a chat message that a Slack, Discord
or Teams (legacy Office 365 connector) incoming-webhook URL accepts as it is.

The inbound side has a log too: `client.ingest.listDeliveries({ status, since, queueName })` lists
the accepted requests to your custom webhook URL (`GET /webhooks/deliveries`, no payloads).

After 20 consecutive failed deliveries a webhook is disabled automatically (`enabled: false`,
`lastStatus: "auto_disabled"`) and stops receiving events until you turn it back on:

```typescript
await client.webhooks.update(webhookId, { enabled: true });
```

Updating changes only the fields you send. `secret` is three-state — omit it to keep the current
secret, pass a string to replace it, or pass `null` to clear it. Clearing is destructive: deliveries
then go out unsigned, with no `X-Spooled-Signature` header. Do not serialise unchanged fields as
`null`.

### Dead Letter Queue (DLQ)

Manage jobs that have exhausted all retries:

```typescript
// List DLQ jobs
const dlqJobs = await client.jobs.dlq.list({ limit: 100 });

// Retry specific jobs from DLQ
await client.jobs.dlq.retry({
  jobIds: ["job-1", "job-2"],
});

// Retry jobs by queue
await client.jobs.dlq.retry({
  queueName: "my-queue",
  limit: 50,
});

// Purge DLQ (requires confirmation)
await client.jobs.dlq.purge({
  queueName: "my-queue",
  confirm: true,
});
```

### API Key Management

Manage API keys programmatically:

```typescript
// Create a new API key
const apiKey = await client.apiKeys.create({
  name: "Production Worker",
  queues: ["emails", "notifications"],
  rateLimit: 1000, // optional, requests per MINUTE for this key (can only lower the plan limit)
});

console.log(`Save this key: ${apiKey.key}`); // Only shown once!

// List all API keys
const keys = await client.apiKeys.list();

// Revoke a key
await client.apiKeys.revoke(keyId);
```

### Billing & Subscriptions

Manage billing via Stripe integration:

```typescript
// Get billing status
const status = await client.billing.getStatus();

// Create customer portal session
const { url } = await client.billing.createPortal({
  returnUrl: "https://your-app.com/settings",
});

// Redirect user to: url
```

### Authentication

Email-based passwordless authentication:

```typescript
// Start email login flow
await client.auth.startEmailLogin("user@example.com");
// User receives email with login link

// Check if email exists
const { exists } = await client.auth.checkEmail("user@example.com");

// Exchange API key for JWT
const { accessToken, refreshToken } = await client.auth.login({
  apiKey: "sp_live_...",
});

// Use JWT for subsequent requests
const jwtClient = new SpooledClient({ accessToken });
```

## Plan Limits

All operations automatically enforce tier-based limits:

| Tier           | Active Jobs | Daily Jobs | Queues    | Workers   | Webhooks  |
| -------------- | ----------- | ---------- | --------- | --------- | --------- |
| **Free**       | 10          | 1,000      | 2         | 1         | 1         |
| **Starter**    | 500         | 10,000     | 10        | 5         | 5         |
| **Pro**        | 5,000       | 100,000    | 50        | 25        | 20        |
| **Enterprise** | Unlimited   | Unlimited  | Unlimited | Unlimited | Unlimited |

(Source: the backend's `config/plans.rs`; Free has no workflows, Starter 5, Pro 25.)

**Limits are enforced on:**

- ✅ HTTP job creation (`POST /jobs`, `POST /jobs/bulk`)
- ✅ gRPC job enqueue
- ✅ Workflow creation (counts all jobs in workflow)
- ✅ Schedule triggers
- ✅ DLQ retry operations
- ✅ Worker registration (re-registering your own stable `workerId` is not charged again)
- ✅ Queue creation
- ✅ Webhook creation, and re-enabling a disabled webhook

When a plan quota or limit is exceeded, you'll receive an `HTTP 429` response with
`code: "QUOTA_EXCEEDED"`. The SDK reliably preserves the HTTP status, error code, message,
request ID, and rate-limit headers. `error.details` is populated only when the server nests
metadata under a JSON `details` field; quota fields sent at the top level of the server payload
(such as `resource`, `current`, `limit`, and `plan`) are not currently exposed by the SDK.

```typescript
import { RateLimitError } from "@spooled/sdk";

try {
  await client.jobs.create({
    /* ... */
  });
} catch (error) {
  if (error instanceof RateLimitError && error.code === "QUOTA_EXCEEDED") {
    console.log(`Plan limit: ${error.message}`);
    console.log(`Request ID: ${error.requestId ?? "not provided"}`);
    // Present only if this server response included a nested `details` object.
    if (error.details) console.log("Details:", error.details);
  }
}
```

(Request-rate limiting also returns `429`, as a `RateLimitError` with the default `RATE_LIMIT_EXCEEDED` code. The plan limit is per organization in requests per second; an API key's own `rateLimit` is requests per minute.)

Since API 0.1.122, responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
(a Unix time in seconds) and `X-RateLimit-Scope` (`organization` or `api_key`), and a 429 adds
`Retry-After`. `client.getRateLimitInfo()` returns the values from the most recent response that had
them, and `RateLimitError.rateLimitInfo` those of a 429. The headers are optional: public routes and
servers without Redis do not send them.

```typescript
await client.jobs.getStats();
const rate = client.getRateLimitInfo();
// { limit: 200, remaining: 199, reset: Date, scope: "organization" }
```

A plan quota does not clear for hours, so `error.isQuota` is `true` for it and the SDK never retries it.
Rate-limit 429s are retried after `Retry-After`. No 429 counts toward the circuit breaker, so a burst
above the plan limit slows the client down instead of opening the breaker for every call.

## Error Handling

All errors extend `SpooledError` with specific subclasses:

```typescript
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
  AuthorizationError,
  isSpooledError,
} from "@spooled/sdk";

try {
  await client.jobs.get("non-existent");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log("Job not found");
  } else if (error instanceof AuthorizationError) {
    console.log(`Forbidden: ${error.message}`);
  } else if (error instanceof RateLimitError) {
    // 429: either a plan quota (error.isQuota, code "QUOTA_EXCEEDED") or per-second rate limiting
    if (!error.isQuota)
      console.log(`Retry after ${error.getRetryAfter()} seconds`);
  } else if (isSpooledError(error)) {
    console.log(`API error: ${error.code} - ${error.message}`);
  }
}
```

## gRPC API

For high-throughput workers, use the native gRPC API with the included gRPC client:

```typescript
import { SpooledGrpcClient } from "@spooled/sdk";

// Connect to gRPC server (Optimized for Cloudflare Tunnel)
// useTls: true if connecting to grpc.spooled.cloud:443 (Cloudflare terminates TLS)
// useTls: false if connecting to localhost or direct backend
const grpcClient = new SpooledGrpcClient({
  address: "grpc.spooled.cloud:443",
  apiKey: "sp_live_your_key",
  useTls: true,
});

// Register worker (a stable workerId is reused across restarts)
const { workerId } = await grpcClient.workers.register({
  queueName: "emails",
  hostname: "worker-1",
  maxConcurrency: 10,
  workerId: "emails-worker-1",
});

// Enqueue job (enforces plan limits automatically)
const { jobId } = await grpcClient.queue.enqueue({
  queueName: "emails",
  payload: { to: "user@example.com" },
  priority: 5,
});

// Dequeue jobs in batch
const { jobs } = await grpcClient.queue.dequeue({
  queueName: "emails",
  workerId,
  batchSize: 10,
  leaseDurationSecs: 300,
});

// Process and settle. leaseId is required: the server rejects a complete/fail/renew
// without the lease token that dequeue returned. fail() retries by default (until the
// job's maxRetries run out); pass retry: false to dead-letter on purpose.
for (const job of jobs) {
  const leaseId = job.leaseId as string;
  try {
    await processJob(job);
    await grpcClient.queue.complete({
      jobId: job.id,
      workerId,
      leaseId,
      result: { success: true },
    });
  } catch (error) {
    await grpcClient.queue.fail({
      jobId: job.id,
      workerId,
      leaseId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
```

`fail` sends `retry: true` unless you pass `retry: false`; `false` is sent on the wire (proto field 4
has presence) and dead-letters the job at once, whatever its `maxRetries`.

Over gRPC `payload` and `result` are `google.protobuf.Struct`, so two things differ from REST: only a
JSON object travels (a job whose payload is an array, string, number or `null` arrives as an empty
object), and integers at or above 2^53 lose precision (send them as strings). Use REST for such jobs.

`dequeue` hands out up to `batchSize` jobs, each with a lease of `leaseDurationSecs` (5-3600 s; when
omitted the server default applies, 300 s on Spooled Cloud). For a job that can run longer than its
lease, pass a longer lease or renew it before it expires (`renewLease` with `jobId`, `workerId`,
`leaseId`, `extensionSecs`). A gRPC `StreamJobs` stream delivers **one job at a time**: the next
job is sent only after the previous one on that stream is completed, failed or released, so open
one stream per job slot you want to run in parallel.

**gRPC Features:**

- **~28x faster** than HTTP (with Redis cache: ~50ms vs 1400ms)
- **Automatic plan limit enforcement** on enqueue operations
- **Batch operations** for higher throughput
- **Streaming support** for real-time job processing
- **Secure authentication** via API key metadata

See [gRPC Guide](docs/grpc.md) for complete documentation.

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  SpooledClientConfig,
  Job,
  JobStatus,
  CreateJobParams,
  Queue,
  QueueStats,
  Schedule,
  CreateScheduleParams,
  Workflow,
  CreateWorkflowParams,
  Worker,
  WorkerStatus,
} from "@spooled/sdk";
```

## Development and releases

Before opening a pull request or tagging a release, run the same checks used by the package and publish workflow:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm test
```

Production-safe API verification is separate and credentialed: `npm run verify:production`. Integration tests use `npm run test:integration` against a local or isolated test backend.

Maintainers release by pushing a matching `vX.Y.Z` tag. The tag workflow verifies all same-artifact version surfaces before publishing through npm Trusted Publishing (OIDC) with provenance.

### Maintainer release checklist (advisory)

This checklist records evidence and does not block ordinary commits, experiments, or compatibility research. A mismatch among values that identify the same npm artifact is a release error and cannot be waived for publication. Publishing the SDK is not a service deployment; consumers report new metadata only after upgrading and restarting or redeploying their applications.

Before pushing `vX.Y.Z`:

- [ ] Set `package.json.version` to `X.Y.Z`.
- [ ] Regenerate `package-lock.json`; verify both top-level `version` and `packages[""].version` are `X.Y.Z`.
- [ ] Set `SDK_VERSION` and the default User-Agent in `src/config.ts` to `X.Y.Z`.
- [ ] Confirm `SpooledWorker` derives its default registration version from `SDK_VERSION`.
- [ ] Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md` and review version-bearing worker documentation.
- [ ] Run `npm ci`, lint, typecheck, build, tests, and `npm pack --dry-run`.
- [ ] Review the packed file list and compiled output; confirm the package contains no local logs, caches, credentials, or unintended generated files.
- [ ] Record any cross-repository compatibility difference separately; backend, SDK, and application versions are not required to match numerically.

Publish and verify:

- [ ] Create one immutable `vX.Y.Z` tag on the reviewed commit and never move or recreate a pushed tag. Fix forward with a new patch version after external visibility.
- [ ] Record the tag commit and publish workflow URL.
- [ ] Verify `npm view @spooled/sdk@X.Y.Z version gitHead dist.integrity dist.attestations --json` against the tag and commit.
- [ ] Confirm `latest` points to `X.Y.Z` when intended and inspect the published tarball's `SDK_VERSION`, User-Agent, and worker registration default.
- [ ] Confirm npm provenance names this repository, `.github/workflows/publish.yml`, `refs/tags/vX.Y.Z`, and the release commit.
- [ ] Record registry publication separately from consumer rollout, backend deployment, or documentation deployment.

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.
