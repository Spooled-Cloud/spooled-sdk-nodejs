# Resources Reference

This is a complete reference for all SDK resources and their methods.

## Jobs

### Create Job

```typescript
const { id, created } = await client.jobs.create({
  queueName: "my-queue", // Required: target queue
  payload: { data: "value" }, // Required: job data (any JSON)

  // Optional
  priority: 5, // -100 to 100 (default: 0)
  maxRetries: 3, // Retry attempts (default: 3)
  timeoutSeconds: 300, // Job timeout (default: 300)
  scheduledAt: new Date(), // Delay execution
  idempotencyKey: "unique-key", // Prevent duplicates
  tags: { env: "prod" }, // Metadata tags
});
```

### List Jobs

```typescript
const jobs = await client.jobs.list({
  queueName: "my-queue", // Optional: filter by queue
  status: "pending", // Optional: one status, or several: ["failed", "deadletter"]
  tag: "billing", // Optional: filter by a single tag
  q: "invoice", // Optional: id prefix, or text in the queue name or payload.job_type
  jobType: "send-invoice", // Optional: exact payload.job_type
  createdAfter: new Date(Date.now() - 86_400_000), // Optional: Date or RFC 3339 string
  createdBefore: "2026-10-12T00:00:00Z", // Optional, exclusive
  limit: 10, // Pagination limit (max 100)
  offset: 0, // Pagination offset
});
```

The status list, `q`, `jobType`, `createdAfter` and `createdBefore` need API 0.1.122 or later; an
invalid value is a `ValidationError`. `jobs.dlq.list()` takes the same filters except `status`.

To page through results, `listPage()` also returns whether another page follows (the
`X-Has-More` header):

```typescript
let offset = 0;
for (;;) {
  const page = await client.jobs.listPage({
    status: "failed",
    limit: 100,
    offset,
  });
  handle(page.data);
  if (!page.hasMore) break;
  offset += page.data.length;
}
// jobs.dlq.listPage() works the same way.
```

### Job History

```typescript
const events = await client.jobs.history("job_id", {
  order: "asc",
  limit: 100,
});
// [{ id, jobId, eventType: "processing" | "completed" | "retry_scheduled" | "deadlettered" | ...,
//    workerId, details, createdAt }]
const page = await client.jobs.historyPage("job_id", { limit: 50, offset: 0 }); // { data, hasMore }
```

API 0.1.122+. The server records REST claims, completions and failures and the scheduler's
dead-letter sweeps, so jobs settled over gRPC have sparse history. `details` keeps the server's
snake_case keys.

### Get Job

```typescript
const job = await client.jobs.get("job_id");
// Returns: { id, queueName, status, payload, priority, ... }
```

### Cancel Job

```typescript
await client.jobs.cancel("job_id");
```

### Retry Job

```typescript
const { id } = await client.jobs.retry("job_id");
```

### Boost Priority

```typescript
await client.jobs.boostPriority("job_id", 10); // Add 10 to priority
```

### Get Statistics

```typescript
const stats = await client.jobs.getStats();
// { pending, processing, completed, failed, deadLetter }
```

### Bulk Enqueue

```typescript
const result = await client.jobs.bulkEnqueue({
  queueName: "my-queue",
  jobs: [
    { payload: { n: 1 } },
    { payload: { n: 2 }, priority: 10 },
    { payload: { n: 3 }, maxRetries: 5 },
  ],
});
// { jobIds: ['job_1', 'job_2', 'job_3'], enqueuedCount: 3 }
```

### Batch Status

```typescript
const statuses = await client.jobs.batchStatus(["job_1", "job_2", "job_3"]);
// { job_1: 'completed', job_2: 'processing', job_3: 'pending' }
```

### Claim Jobs (for workers)

```typescript
const result = await client.jobs.claim({
  queueName: "my-queue",
  workerId: "worker-1",
  limit: 10,
  leaseDurationSecs: 300,
});
// Each claimed job may include leaseId, the fencing token for this execution.
```

Send `leaseId` from the claimed job on complete, fail, and heartbeat. The API requires it: a call without it is a `ValidationError` (HTTP 422; since 2026-07, before that a 409), and a stale token is HTTP 409 with code `LEASE_EXPIRED`. `SpooledWorker` does this for you.

### Complete Job

```typescript
await client.jobs.complete("job_id", {
  workerId: "worker-1",
  leaseId: claimedJob.leaseId ?? undefined,
  result: { success: true },
});
```

### Fail Job

```typescript
await client.jobs.fail("job_id", {
  workerId: "worker-1",
  leaseId: claimedJob.leaseId ?? undefined,
  error: "Something went wrong",
});
```

### Heartbeat

```typescript
await client.jobs.heartbeat("job_id", {
  workerId: "worker-1",
  leaseId: claimedJob.leaseId ?? undefined,
  leaseDurationSecs: 300,
});
```

### Dead Letter Queue

```typescript
// List DLQ jobs
const dlqJobs = await client.jobs.dlq.list({
  queueName: "my-queue",
  limit: 50,
});

// Retry DLQ jobs
await client.jobs.dlq.retry({
  jobIds: ["job_1", "job_2"],
});

// Retry all DLQ jobs for a queue
await client.jobs.dlq.retry({
  queueName: "my-queue",
});

// Purge DLQ
await client.jobs.dlq.purge({
  queueName: "my-queue",
  confirm: true,
});
```

---

## Queues

### List Queues

```typescript
const queues = await client.queues.list();
// [{ queueName, enabled, defaultPriority, ... }]
```

### Get Queue Config

```typescript
const config = await client.queues.get("my-queue");
```

### Update Queue Config

```typescript
await client.queues.updateConfig("my-queue", {
  maxRetries: 5,
  defaultTimeout: 600,
  rateLimit: 100, // stored and returned, but NOT enforced: workers are not throttled by it
  enabled: true,
});
```

### Get Queue Stats

```typescript
const stats = await client.queues.getStats("my-queue");
// { pending, processing, completed, failed, ... }
```

### Pause Queue

```typescript
await client.queues.pause("my-queue", "Maintenance window");
```

### Resume Queue

```typescript
await client.queues.resume("my-queue");
```

### Delete Queue

```typescript
// Config only; the API answers 409 for a queue with pending/processing jobs
// or one that has no stored config (it exists only because jobs were posted).
await client.queues.delete("my-queue");

// Also delete the queue's jobs and dead-letter rows
await client.queues.delete("my-queue", { deleteJobs: true });
```

---

## Schedules

### Create Schedule

```typescript
const schedule = await client.schedules.create({
  name: "Daily Report",
  cronExpression: "0 0 9 * * *", // 6-field cron (with seconds)
  timezone: "America/New_York",
  queueName: "reports",
  payloadTemplate: { type: "daily" },
  enabled: true,
});
```

### List Schedules

```typescript
const schedules = await client.schedules.list();
```

### Get Schedule

```typescript
const schedule = await client.schedules.get("schedule_id");
```

### Update Schedule

```typescript
await client.schedules.update("schedule_id", {
  cronExpression: "0 0 8 * * *",
  enabled: false,
});
```

### Delete Schedule

```typescript
await client.schedules.delete("schedule_id");
```

### Pause/Resume

```typescript
await client.schedules.pause("schedule_id");
await client.schedules.resume("schedule_id");
```

### Trigger Manually

```typescript
const { jobId } = await client.schedules.trigger("schedule_id");
```

### Get History

```typescript
const runs = await client.schedules.getHistory("schedule_id", 10);
// Last 10 executions
```

---

## Workflows

### Create Workflow

```typescript
const workflow = await client.workflows.create({
  name: "ETL Pipeline",
  jobs: [
    { key: "extract", queueName: "etl", payload: {} },
    { key: "transform", queueName: "etl", payload: {}, dependsOn: ["extract"] },
    { key: "load", queueName: "etl", payload: {}, dependsOn: ["transform"] },
  ],
});
// { workflowId, jobIds: [{ key: 'extract', jobId: 'job_1' }, ...] }
```

### Get Workflow

```typescript
const status = await client.workflows.get("workflow_id");
const jobs = await client.workflows.jobs.list("workflow_id");
// status: { id, name, status, ... }
// jobs: [{ id, workflowId, status, ... }]
// The API does not return the `key` a job was created with, so `key` is
// undefined; map keys to job IDs from `workflows.create()` (`jobIds`).
```

### Cancel Workflow

```typescript
await client.workflows.cancel("workflow_id");
```

### Retry Failed Workflow

Retry all failed jobs in a workflow. Only works on workflows with status `failed`.

```typescript
const workflow = await client.workflows.retry("workflow_id");
// Workflow status changes from 'failed' to 'running'
// Failed jobs are reset to 'pending' and reprocessed
```

### Job Dependencies

```typescript
const deps = await client.workflows.jobs.getDependencies("job_id");

await client.workflows.jobs.addDependencies("job_id", {
  dependsOnJobIds: ["other_job_id"],
});
```

---

## Webhooks

### Create Webhook

```typescript
const webhook = await client.webhooks.create({
  name: "Slack Notifications",
  url: "https://hooks.slack.com/...",
  events: ["job.completed", "job.failed", "job.deadlettered"],
  secret: "hmac-secret",
  enabled: true,
  format: "slack", // "json" (default) | "slack" | "discord" | "teams"
});
```

Events: `job.created`, `job.started`, `job.completed`, `job.failed`, `job.cancelled`,
`queue.paused`, `queue.resumed`, `worker.registered`, `worker.deregistered`,
`schedule.triggered`, and since API 0.1.122 `job.deadlettered`, `job.retried`,
`workflow.completed` and `workflow.failed`. `format` (API 0.1.122+) makes the delivery a chat
message the chat service's incoming-webhook URL accepts as it is; `teams` is the legacy Office 365
connector card. `update(id, { format })` changes it; omitting it keeps the current one. Values newer
than the SDK's types come back as plain strings.

### List Webhooks

```typescript
const webhooks = await client.webhooks.list();
```

### Get/Update/Delete

```typescript
const wh = await client.webhooks.get("webhook_id");
await client.webhooks.update("webhook_id", { enabled: false });
await client.webhooks.delete("webhook_id");
```

`update` changes only the fields you pass. Two of them carry behaviour worth knowing before you
call it:

```typescript
// Clear the signing secret. Destructive: deliveries then go out unsigned,
// with no X-Spooled-Signature header, and the old secret is gone.
await client.webhooks.update("webhook_id", { secret: null });

// Replace it instead.
await client.webhooks.update("webhook_id", { secret: "new-hmac-secret" });

// Leave it alone by omitting the field. Passing `null` for fields you did not
// mean to change wipes a live secret — pass `undefined` or drop the key.
await client.webhooks.update("webhook_id", { url: "https://new-target" });

// Re-enable a webhook that was auto-disabled after 20 consecutive failed
// deliveries. Charged against the plan webhook cap, so it can throw
// RateLimitError with code QUOTA_EXCEEDED.
await client.webhooks.update("webhook_id", { enabled: true });
```

### Auto-Disable

`webhook.failureCount` counts consecutive failed deliveries — once per delivery, not once per retry
attempt — and a successful delivery resets it to 0, including a successful `retryDelivery()`. At 20
the webhook is disabled automatically: `enabled` is `false` and `lastStatus` is `"auto_disabled"`.
No further events are delivered until it is re-enabled.

```typescript
const wh = await client.webhooks.get("webhook_id");
if (wh.lastStatus === "auto_disabled") {
  await client.webhooks.update("webhook_id", { enabled: true });
}
```

### Test Webhook

```typescript
const result = await client.webhooks.test("webhook_id");
// { success, statusCode, ... }
```

### Get Deliveries

```typescript
const deliveries = await client.webhooks.getDeliveries("webhook_id");
```

Delivery history is a retention window, not an audit log. Rows are removed by the per-organization
retention sweep using the plan's history retention period — free 1 day, starter 7, pro 30,
enterprise 90 — and only the newest 100 deliveries per webhook are returned in any case. Copy
anything you need to keep into your own store.

### Retry Delivery

```typescript
const result = await client.webhooks.retryDelivery("webhook_id", "delivery_id");
// { success, message }
```

---

## Workers

### List Workers

```typescript
const workers = await client.workers.list();
```

### Get Worker

```typescript
const worker = await client.workers.get("worker_id");
console.log(worker.jobsProcessed, worker.jobsFailed); // API 0.1.122+
```

`jobsProcessed` and `jobsFailed` (also on `workers.list()` rows) count the outcomes a worker
reported while it held the lease, from API 0.1.122 on: completions, and failures that were retried
or dead-lettered. Lease-expiry recovery is not counted.

### Register Worker

```typescript
const registration = await client.workers.register({
  queueName: "my-queue",
  workerId: "worker-01", // stable id (1-128 chars, [A-Za-z0-9._-])
  hostname: "worker-01",
  workerType: "nodejs",
  maxConcurrency: 10,
  version: "my-worker/1.0.0",
  metadata: { environment: "production" },
});
// { id, leaseDurationSecs, heartbeatIntervalSecs }
```

`workerId` is optional but worth setting on anything that restarts. With a stable id, registration
is an upsert: the process reuses one row, and re-registering an id you already own is not charged
against the plan worker cap. Omit it and the server mints a UUID, so every restart leaves the old
row counting against the cap until the stale-worker reaper clears it (~2 minutes) — enough for a
crash-looping worker on a tight plan to 429 itself out of registering. An id owned by a different
organization is rejected with HTTP 409.

### Heartbeat

```typescript
await client.workers.heartbeat("worker_id", {
  currentJobs: 5,
  status: "healthy",
});
```

### Deregister

```typescript
await client.workers.deregister("worker_id");
```

---

## API Keys

### List Keys

```typescript
const keys = await client.apiKeys.list();
// Keys are masked (only last 4 chars shown)
```

### Create Key

```typescript
const { id, key } = await client.apiKeys.create({
  name: "Production API Key",
  queues: ["queue-1", "queue-2"], // Optional: restrict to queues
  rateLimit: 1000, // requests per minute for this key
});
// IMPORTANT: 'key' is only shown once!
```

### Update Key

```typescript
await client.apiKeys.update("key_id", {
  name: "Updated Name",
  rateLimit: 2000,
});
```

### Revoke Key

```typescript
await client.apiKeys.revoke("key_id");
```

---

## Organizations

### Create Organization

```typescript
const { organization, apiKey } = await client.organizations.create({
  name: "My Company",
  slug: "my-company",
  billingEmail: "billing@company.com",
});
```

### Get Usage

```typescript
const usage = await client.organizations.getUsage();
// { plan, planDisplayName, usage: { jobsToday, queues, workers, ... } }
```

### List Organizations

```typescript
const orgs = await client.organizations.list();
// Returns list of organizations accessible to your API key
```

### Check Slug Availability

```typescript
const { available, valid, suggestion } =
  await client.organizations.checkSlug("my-company");
// available: boolean - whether slug is available
// valid: boolean - whether slug format is valid
// suggestion: string | null - alternative slug if not available
```

### Generate Slug

```typescript
const { slug } = await client.organizations.generateSlug("My Company Name");
// Returns a unique, URL-safe slug generated from the name
```

---

## Billing

### Get Status

```typescript
const status = await client.billing.getStatus();
// { planTier, hasStripeCustomer, ... }
```

### Create Portal Session

```typescript
const portal = await client.billing.createPortal({
  returnUrl: "https://yourapp.com/billing",
});
// { url } - Redirect user to this Stripe portal URL
```

---

## Authentication

### Login with API Key

```typescript
const { accessToken, refreshToken } = await client.auth.login({
  apiKey: "sp_live_...",
});

// Use JWT for subsequent requests
const jwtClient = new SpooledClient({ accessToken });
```

### Validate Token

```typescript
const { valid } = await client.auth.validate({ token: accessToken });
```

### Refresh Token

```typescript
const { accessToken } = await client.auth.refresh({ refreshToken });
```

### Get Current User

```typescript
const user = await client.auth.me(); // Requires JWT token
// { organizationId, ... }
```

### Logout

```typescript
await client.auth.logout();
```

### Email-Based Login

```typescript
// Start email login flow (sends magic link)
const result = await client.auth.startEmailLogin("user@example.com");
// { message, emailSentTo }

const { exists, available, signupEnabled } =
  await client.auth.checkEmail("user@example.com");
```

---

## Dashboard

### Get Dashboard Data

```typescript
const dashboard = await client.dashboard.get();
// { system, jobs, queues, workers, recentActivity }
```

---

## Health & Metrics

### Health Check

```typescript
const health = await client.health.get();
// { status, database, cache, timestamp }
```

### Readiness

```typescript
const ready = await client.health.readiness();
// true | false
```

### Prometheus Metrics

```typescript
const metrics = await client.metrics.get();
// Raw Prometheus metrics text
```

These are the service's own operator-level metrics, not per-tenant metrics: Spooled has no tenant-facing Prometheus endpoint or alert rules. Self-hosters scrape this endpoint. When the server sets `METRICS_TOKEN` (Spooled Cloud does), `/metrics` needs `Authorization: Bearer <METRICS_TOKEN>` and answers an API key with 401 (`AuthenticationError`).

---

## Admin API

Requires `adminKey` in client config. A client built with only `adminKey`
(`new SpooledClient({ adminKey })`) is enough for `client.admin.*`.

### List Organizations

```typescript
const orgs = await client.admin.listOrganizations({
  planTier: "pro",
  limit: 10,
});
```

### Get Organization

```typescript
const org = await client.admin.getOrganization("org_id");
```

### Update Organization

```typescript
await client.admin.updateOrganization("org_id", {
  planTier: "enterprise",
});
```

### Get Admin Stats

```typescript
const stats = await client.admin.getStats();
// { organizations, jobs, queues, ... }
```

### Create API Key for Organization

```typescript
const { id, key } = await client.admin.createApiKey({
  organizationId: "org_id",
  name: "Admin-created key",
});
```

---

## Webhook Ingestion

For receiving webhooks from external services. These are authenticated by the organization webhook token, not an API key.

`ingest.github()` and `ingest.stripe()` are deprecated: the API has no GitHub or
Stripe webhook route, so they throw `UnsupportedOperationError` without a
network call. Point those providers at the custom endpoint instead.

### Custom Webhook

```typescript
await client.ingest.custom("org_id", {
  queueName: "custom_events",
  eventType: "custom.event",
  payload: { data: "value" },
});
```

### Inbound Webhook Log

```typescript
const deliveries = await client.ingest.listDeliveries({
  status: "created", // or "duplicate"
  since: new Date(Date.now() - 3_600_000),
  queueName: "custom_events",
  limit: 50,
});
// [{ id, provider, eventType, matchedQueue, jobId, status, createdAt }]
```

`GET /webhooks/deliveries` (API 0.1.122+) lists the accepted requests to the custom endpoint, newest
first. Unlike `custom()` it uses the client's API key, which must not be queue-scoped (403). It
never returns payloads or signatures.

---

## Type Exports

```typescript
import type {
  // Client
  SpooledClient,
  SpooledClientConfig,

  // Jobs
  Job,
  JobStatus,
  CreateJobParams,
  JobStats,
  ListJobsParams,
  JobHistoryEvent,
  ListPage,

  // Queues
  Queue,
  QueueStats,
  QueueConfig,

  // Schedules
  Schedule,
  CreateScheduleParams,

  // Workflows
  Workflow,
  CreateWorkflowParams,

  // Workers
  Worker,
  WorkerStatus,
  SpooledWorker,
  SpooledWorkerOptions,
  JobContext,

  // Webhooks
  OutgoingWebhook,
  WebhookEventType,
  WebhookFormat,
  InboundWebhookDelivery,

  // Rate limits
  RateLimitInfo,

  // Common
  PaginationParams,
  JsonObject,
} from "@spooled/sdk";
```
