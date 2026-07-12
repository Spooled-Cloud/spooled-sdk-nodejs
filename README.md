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
- **API Key management** with Redis caching (~28x faster authentication)
- **Billing integration** via Stripe
- **Automatic case conversion** between camelCase (SDK) and snake_case (API)

## Installation

```bash
npm install @spooled/sdk
```

## Quick Start

```typescript
import { SpooledClient } from '@spooled/sdk';

const client = new SpooledClient({
  apiKey: 'sp_live_your_api_key',
  // For self-hosted: baseUrl: 'https://your-spooled-server.com'
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

## Real-world examples (beginner friendly)

If you want 5 copy/paste “real life” setups (Stripe → jobs, GitHub Actions → jobs, cron schedules, CSV import, website signup), see:

- `https://github.com/spooled-cloud/spooled-backend/blob/main/docs/guides/real-world-examples.md`

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

const client = new SpooledClient({ apiKey: 'sp_live_...' });

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
  cronExpression: '0 9 * * *',      // 9 AM daily; 5-field (min hour dom mon dow) or 6-field (leading seconds) both work
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

### Organization Management

Manage your organization and track usage:

```typescript
// Get current usage and limits
const usage = await client.organizations.getUsage();
console.log(`Active jobs: ${usage.active_jobs.current}/${usage.active_jobs.limit}`);
console.log(`Plan: ${usage.plan.tier}`);

// Generate a unique slug for a new organization
const { slug } = await client.organizations.generateSlug('My Company');

// Check if a slug is available
const { available } = await client.organizations.checkSlug('my-company');
```

### Webhooks

Configure outgoing webhooks for job events:

```typescript
// Create webhook
const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhooks/spooled',
  events: ['job.completed', 'job.failed'],
  queueName: 'my-queue',
  secret: 'webhook_secret_key'
});

// Retry a failed delivery
await client.webhooks.retryDelivery(webhookId, deliveryId);

// Get delivery history
const deliveries = await client.webhooks.getDeliveries(webhookId);
```

### Dead Letter Queue (DLQ)

Manage jobs that have exhausted all retries:

```typescript
// List DLQ jobs
const dlqJobs = await client.jobs.dlq.list({ limit: 100 });

// Retry specific jobs from DLQ
await client.jobs.dlq.retry({
  jobIds: ['job-1', 'job-2'],
});

// Retry jobs by queue
await client.jobs.dlq.retry({
  queueName: 'my-queue',
  limit: 50
});

// Purge DLQ (requires confirmation)
await client.jobs.dlq.purge({
  queueName: 'my-queue',
  confirm: true
});
```

### API Key Management

Manage API keys programmatically:

```typescript
// Create a new API key
const apiKey = await client.apiKeys.create({
  name: 'Production Worker',
  queues: ['emails', 'notifications'],
  rateLimit: 1000
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
  returnUrl: 'https://your-app.com/settings'
});

// Redirect user to: url
```

### Authentication

Email-based passwordless authentication:

```typescript
// Start email login flow
await client.auth.startEmailLogin('user@example.com');
// User receives email with login link

// Check if email exists
const { exists } = await client.auth.checkEmail('user@example.com');

// Exchange API key for JWT
const { accessToken, refreshToken } = await client.auth.login({
  apiKey: 'sp_live_...'
});

// Use JWT for subsequent requests
const jwtClient = new SpooledClient({ accessToken });
```

## Plan Limits

All operations automatically enforce tier-based limits:

| Tier | Active Jobs | Daily Jobs | Queues | Workers | Webhooks |
|------|-------------|------------|--------|---------|----------|
| **Free** | 10 | 1,000 | 5 | 3 | 2 |
| **Starter** | 100 | 100,000 | 25 | 25 | 10 |
| **Enterprise** | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |

**Limits are enforced on:**
- ✅ HTTP job creation (`POST /jobs`, `POST /jobs/bulk`)
- ✅ gRPC job enqueue
- ✅ Workflow creation (counts all jobs in workflow)
- ✅ Schedule triggers
- ✅ DLQ retry operations
- ✅ Worker registration
- ✅ Queue creation
- ✅ Webhook creation

When a plan quota or limit is exceeded, you'll receive an `HTTP 429` response with
`code: "QUOTA_EXCEEDED"`. The SDK reliably preserves the HTTP status, error code, message,
request ID, and rate-limit headers. `error.details` is populated only when the server nests
metadata under a JSON `details` field; quota fields sent at the top level of the server payload
(such as `resource`, `current`, `limit`, and `plan`) are not currently exposed by the SDK.

```typescript
import { RateLimitError } from '@spooled/sdk';

try {
  await client.jobs.create({ /* ... */ });
} catch (error) {
  if (error instanceof RateLimitError && error.code === 'QUOTA_EXCEEDED') {
    console.log(`Plan limit: ${error.message}`);
    console.log(`Request ID: ${error.requestId ?? 'not provided'}`);
    // Present only if this server response included a nested `details` object.
    if (error.details) console.log('Details:', error.details);
  }
}
```

(Per-second rate limiting also returns `429`, as a `RateLimitError` with the default `RATE_LIMIT_EXCEEDED` code.)

## Error Handling

All errors extend `SpooledError` with specific subclasses:

```typescript
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
  AuthorizationError,
  isSpooledError,
} from '@spooled/sdk';

try {
  await client.jobs.get('non-existent');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Job not found');
  } else if (error instanceof AuthorizationError) {
    console.log(`Forbidden: ${error.message}`);
  } else if (error instanceof RateLimitError) {
    // 429: either a plan quota (code "QUOTA_EXCEEDED") or per-second rate limiting
    console.log(`Retry after ${error.getRetryAfter()} seconds`);
  } else if (isSpooledError(error)) {
    console.log(`API error: ${error.code} - ${error.message}`);
  }
}
```

## gRPC API

For high-throughput workers, use the native gRPC API with the included gRPC client:

```typescript
import { SpooledGrpcClient } from '@spooled/sdk';

// Connect to gRPC server (Optimized for Cloudflare Tunnel)
// useTls: true if connecting to grpc.spooled.cloud:443 (Cloudflare terminates TLS)
// useTls: false if connecting to localhost or direct backend
const grpcClient = new SpooledGrpcClient({
  address: 'grpc.spooled.cloud:443',
  apiKey: 'sp_live_your_key',
  useTls: true
});

// Register worker
const { workerId } = await grpcClient.workers.register({
  queueName: 'emails',
  hostname: 'worker-1',
  maxConcurrency: 10
});

// Enqueue job (enforces plan limits automatically)
const { jobId } = await grpcClient.queue.enqueue({
  queueName: 'emails',
  payload: { to: 'user@example.com' },
  priority: 5
});

// Dequeue jobs in batch
const { jobs } = await grpcClient.queue.dequeue({
  queueName: 'emails',
  workerId,
  batchSize: 10,
  leaseDurationSecs: 300
});

// Process and complete. Echo leaseId when present so current servers can fence stale executions; legacy servers may omit it and then use worker-ID-only fencing.
for (const job of jobs) {
  await processJob(job);
  await grpcClient.queue.complete({
    jobId: job.id,
    workerId,
    leaseId: job.leaseId ?? undefined,
    result: { success: true }
  });
}
```

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
  Job, JobStatus, CreateJobParams,
  Queue, QueueStats,
  Schedule, CreateScheduleParams,
  Workflow, CreateWorkflowParams,
  Worker, WorkerStatus,
} from '@spooled/sdk';
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
