# Resources Reference

This is a complete reference for all SDK resources and their methods.

## Jobs

### Create Job

```typescript
const { id, created } = await client.jobs.create({
  queueName: 'my-queue',           // Required: target queue
  payload: { data: 'value' },      // Required: job data (any JSON)

  // Optional
  priority: 5,                      // -100 to 100 (default: 0)
  maxRetries: 3,                    // Retry attempts (default: 3)
  timeoutSeconds: 300,              // Job timeout (default: 300)
  scheduledAt: new Date(),          // Delay execution
  idempotencyKey: 'unique-key',     // Prevent duplicates
  tags: { env: 'prod' },            // Metadata tags
});
```

### List Jobs

```typescript
const jobs = await client.jobs.list({
  queueName: 'my-queue',            // Optional: filter by queue
  status: 'pending',                // Optional: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  limit: 10,                        // Pagination limit
  offset: 0,                        // Pagination offset
});
```

### Get Job

```typescript
const job = await client.jobs.get('job_id');
// Returns: { id, queueName, status, payload, priority, ... }
```

### Cancel Job

```typescript
await client.jobs.cancel('job_id');
```

### Retry Job

```typescript
const { id } = await client.jobs.retry('job_id');
```

### Boost Priority

```typescript
await client.jobs.boostPriority('job_id', 10); // Add 10 to priority
```

### Get Statistics

```typescript
const stats = await client.jobs.getStats();
// { pending, processing, completed, failed, deadLetter }
```

### Bulk Enqueue

```typescript
const result = await client.jobs.bulkEnqueue({
  queueName: 'my-queue',
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
const statuses = await client.jobs.batchStatus(['job_1', 'job_2', 'job_3']);
// { job_1: 'completed', job_2: 'processing', job_3: 'pending' }
```

### Claim Jobs (for workers)

```typescript
const result = await client.jobs.claim({
  queueName: 'my-queue',
  workerId: 'worker-1',
  limit: 10,
  leaseDurationSecs: 300,
});
// { jobs: [...], claimedCount: 5 }
```

### Complete Job

```typescript
await client.jobs.complete('job_id', {
  workerId: 'worker-1',
  result: { success: true },
});
```

### Fail Job

```typescript
await client.jobs.fail('job_id', {
  workerId: 'worker-1',
  error: 'Something went wrong',
});
```

### Heartbeat

```typescript
await client.jobs.heartbeat('job_id', {
  workerId: 'worker-1',
  leaseDurationSecs: 300,
});
```

### Dead Letter Queue

```typescript
// List DLQ jobs
const dlqJobs = await client.jobs.dlq.list({
  queueName: 'my-queue',
  limit: 50,
});

// Retry DLQ jobs
await client.jobs.dlq.retry({
  jobIds: ['job_1', 'job_2'],
});

// Retry all DLQ jobs for a queue
await client.jobs.dlq.retry({
  queueName: 'my-queue',
});

// Purge DLQ
await client.jobs.dlq.purge({
  queueName: 'my-queue',
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
const config = await client.queues.get('my-queue');
```

### Update Queue Config

```typescript
await client.queues.updateConfig('my-queue', {
  maxRetries: 5,
  defaultTimeout: 600,
  rateLimit: 100,
  enabled: true,
});
```

### Get Queue Stats

```typescript
const stats = await client.queues.getStats('my-queue');
// { pending, processing, completed, failed, ... }
```

### Pause Queue

```typescript
await client.queues.pause('my-queue', 'Maintenance window');
```

### Resume Queue

```typescript
await client.queues.resume('my-queue');
```

---

## Schedules

### Create Schedule

```typescript
const schedule = await client.schedules.create({
  name: 'Daily Report',
  cronExpression: '0 0 9 * * *',    // 6-field cron (with seconds)
  timezone: 'America/New_York',
  queueName: 'reports',
  payloadTemplate: { type: 'daily' },
  enabled: true,
});
```

### List Schedules

```typescript
const schedules = await client.schedules.list();
```

### Get Schedule

```typescript
const schedule = await client.schedules.get('schedule_id');
```

### Update Schedule

```typescript
await client.schedules.update('schedule_id', {
  cronExpression: '0 0 8 * * *',
  enabled: false,
});
```

### Delete Schedule

```typescript
await client.schedules.delete('schedule_id');
```

### Pause/Resume

```typescript
await client.schedules.pause('schedule_id');
await client.schedules.resume('schedule_id');
```

### Trigger Manually

```typescript
const { jobId } = await client.schedules.trigger('schedule_id');
```

### Get History

```typescript
const runs = await client.schedules.getHistory('schedule_id', 10);
// Last 10 executions
```

---

## Workflows

### Create Workflow

```typescript
const workflow = await client.workflows.create({
  name: 'ETL Pipeline',
  jobs: [
    { key: 'extract', queueName: 'etl', payload: {} },
    { key: 'transform', queueName: 'etl', payload: {}, dependsOn: ['extract'] },
    { key: 'load', queueName: 'etl', payload: {}, dependsOn: ['transform'] },
  ],
});
// { workflowId, jobMappings: { extract: 'job_1', ... } }
```

### Get Workflow

```typescript
const status = await client.workflows.get('workflow_id');
// { workflowId, status, jobs: [...] }
```

### Cancel Workflow

```typescript
await client.workflows.cancel('workflow_id');
```

### Job Dependencies

```typescript
const deps = await client.workflows.jobs.getDependencies('job_id');

await client.workflows.jobs.addDependencies('job_id', {
  dependsOnJobIds: ['other_job_id'],
});
```

---

## Webhooks

### Create Webhook

```typescript
const webhook = await client.webhooks.create({
  name: 'Slack Notifications',
  url: 'https://hooks.slack.com/...',
  events: ['job.completed', 'job.failed'],
  secret: 'hmac-secret',
  enabled: true,
});
```

### List Webhooks

```typescript
const webhooks = await client.webhooks.list();
```

### Get/Update/Delete

```typescript
const wh = await client.webhooks.get('webhook_id');
await client.webhooks.update('webhook_id', { enabled: false });
await client.webhooks.delete('webhook_id');
```

### Test Webhook

```typescript
const result = await client.webhooks.test('webhook_id');
// { success, statusCode, ... }
```

### Get Deliveries

```typescript
const deliveries = await client.webhooks.getDeliveries('webhook_id', { limit: 50 });
```

---

## Workers

### List Workers

```typescript
const workers = await client.workers.list();
```

### Get Worker

```typescript
const worker = await client.workers.get('worker_id');
```

### Register Worker

```typescript
const registration = await client.workers.register({
  queueName: 'my-queue',
  hostname: 'worker-01',
  workerType: 'nodejs',
  maxConcurrency: 10,
  metadata: { version: '1.0.0' },
});
// { id, leaseDurationSecs, heartbeatIntervalSecs }
```

### Heartbeat

```typescript
await client.workers.heartbeat('worker_id', {
  currentJobs: 5,
  status: 'healthy',
});
```

### Deregister

```typescript
await client.workers.deregister('worker_id');
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
  name: 'Production API Key',
  queues: ['queue-1', 'queue-2'],  // Optional: restrict to queues
  rateLimit: 1000,
});
// IMPORTANT: 'key' is only shown once!
```

### Update Key

```typescript
await client.apiKeys.update('key_id', {
  name: 'Updated Name',
  rateLimit: 2000,
});
```

### Revoke Key

```typescript
await client.apiKeys.revoke('key_id');
```

---

## Organizations

### Create Organization

```typescript
const { organization, apiKey } = await client.organizations.create({
  name: 'My Company',
  slug: 'my-company',
  billingEmail: 'billing@company.com',
});
```

### Get Usage

```typescript
const usage = await client.organizations.getUsage();
// { plan, planDisplayName, usage: { jobsToday, queues, workers, ... } }
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
  returnUrl: 'https://yourapp.com/billing',
});
// { url } - Redirect user to this Stripe portal URL
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

---

## Admin API

Requires `adminKey` in client config.

### List Organizations

```typescript
const orgs = await client.admin.listOrganizations({
  planTier: 'pro',
  limit: 10,
});
```

### Get Organization

```typescript
const org = await client.admin.getOrganization('org_id');
```

### Update Organization

```typescript
await client.admin.updateOrganization('org_id', {
  planTier: 'enterprise',
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
  organizationId: 'org_id',
  name: 'Admin-created key',
});
```

---

## Webhook Ingestion

For receiving webhooks from external services. These are signature-based, not API-key-based.

### Custom Webhook

```typescript
await client.ingest.custom('org_id', {
  queueName: 'custom_events',
  eventType: 'custom.event',
  payload: { data: 'value' },
});
```

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
  Webhook,
  WebhookEvent,

  // Common
  PaginationParams,
  JsonObject,
} from '@spooled/sdk';
```

