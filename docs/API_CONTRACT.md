# Spooled Cloud API Contract

This document describes the API endpoints and request/response shapes that the SDK implements.
Source of truth: `spooled-backend/src/api/mod.rs` (routes) and `spooled-backend/src/models/*.rs` (types).

## Base URLs

| Service | Spooled Cloud | Self-Hosted Example |
|---------|---------------|---------------------|
| REST API | `https://api.spooled.cloud` | `https://your-server.com` |
| WebSocket | `wss://api.spooled.cloud` | `wss://your-server.com` |
| gRPC | `grpc.spooled.cloud:443` | `grpc.your-server.com:443` |

For self-hosted deployments, configure the SDK with your custom endpoints:

```typescript
const client = new SpooledClient({
  apiKey: 'sk_live_...',
  baseUrl: 'https://your-server.com',        // REST API
  wsUrl: 'wss://your-server.com',            // WebSocket (optional, derived from baseUrl)
  grpcAddress: 'grpc.your-server.com:443',   // gRPC
});
```

## Authentication

All protected endpoints require `Authorization: Bearer <token>` header.
Token can be either:
- **API Key**: `sk_live_...` or `sk_test_...`
- **JWT Access Token**: obtained via `POST /api/v1/auth/login`

WebSocket endpoint requires JWT token in query string: `/api/v1/ws?token=<jwt>`.

---

## Health (Public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe |
| GET | `/metrics` | Prometheus metrics (optional auth) |

---

## Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Exchange API key for JWT tokens |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Invalidate token (protected) |
| GET | `/api/v1/auth/me` | Get current user info |
| POST | `/api/v1/auth/validate` | Validate a token |

### POST /api/v1/auth/login

**Request:**
```typescript
{
  api_key: string; // min 10 chars
}
```

**Response:**
```typescript
{
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds
  refresh_expires_in: number; // seconds
}
```

### POST /api/v1/auth/refresh

**Request:**
```typescript
{
  refresh_token: string;
}
```

**Response:**
```typescript
{
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
```

### GET /api/v1/auth/me

**Response:**
```typescript
{
  organization_id: string;
  api_key_id: string;
  queues: string[];
  issued_at: string; // ISO8601
  expires_at: string; // ISO8601
}
```

---

## Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/jobs` | List jobs |
| POST | `/api/v1/jobs` | Create job |
| GET | `/api/v1/jobs/{id}` | Get job |
| DELETE | `/api/v1/jobs/{id}` | Cancel job |
| POST | `/api/v1/jobs/{id}/retry` | Retry failed job |
| PUT | `/api/v1/jobs/{id}/priority` | Boost priority |
| GET | `/api/v1/jobs/stats` | Job statistics |
| GET | `/api/v1/jobs/status` | Batch status lookup |
| POST | `/api/v1/jobs/bulk` | Bulk enqueue |
| POST | `/api/v1/jobs/claim` | Claim jobs for worker |
| POST | `/api/v1/jobs/{id}/complete` | Complete job |
| POST | `/api/v1/jobs/{id}/fail` | Fail job |
| POST | `/api/v1/jobs/{id}/heartbeat` | Extend job lease |
| GET | `/api/v1/jobs/dlq` | List dead-letter queue |
| POST | `/api/v1/jobs/dlq/retry` | Retry DLQ jobs |
| POST | `/api/v1/jobs/dlq/purge` | Purge DLQ |

### POST /api/v1/jobs

**Request:**
```typescript
{
  queue_name: string; // 1-100 chars, alphanumeric/-/_/.
  payload: object;
  priority?: number; // -100 to 100, default 0
  max_retries?: number; // 0-100, default 3
  timeout_seconds?: number; // 1-86400, default 300
  scheduled_at?: string; // ISO8601
  expires_at?: string; // ISO8601
  idempotency_key?: string; // max 255 chars
  tags?: object;
  parent_job_id?: string;
  completion_webhook?: string; // HTTPS URL
}
```

**Response:**
```typescript
{
  id: string;
  created: boolean; // false if idempotent hit
}
```

### GET /api/v1/jobs

**Query params:**
- `queue_name?: string`
- `status?: 'pending' | 'scheduled' | 'processing' | 'completed' | 'failed' | 'deadletter' | 'cancelled'`
- `limit?: number` (default 50, max 100)
- `offset?: number`
- `order_by?: string`
- `order_dir?: 'asc' | 'desc'`

**Response:** `JobSummary[]`

### Job Model

```typescript
interface Job {
  id: string;
  organization_id: string;
  queue_name: string;
  status: string;
  payload: object;
  result?: object;
  retry_count: number;
  max_retries: number;
  last_error?: string;
  created_at: string;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
  priority: number;
  tags?: object;
  timeout_seconds: number;
  parent_job_id?: string;
  completion_webhook?: string;
  assigned_worker_id?: string;
  lease_id?: string;
  lease_expires_at?: string;
  idempotency_key?: string;
  updated_at: string;
  workflow_id?: string;
  dependency_mode?: string;
  dependencies_met?: boolean;
}

interface JobSummary {
  id: string;
  queue_name: string;
  status: string;
  priority: number;
  retry_count: number;
  created_at: string;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
}

interface JobStats {
  pending: number;
  scheduled: number;
  processing: number;
  completed: number;
  failed: number;
  deadletter: number;
  cancelled: number;
  total: number;
}
```

### POST /api/v1/jobs/claim

**Request:**
```typescript
{
  queue_name: string;
  worker_id: string;
  limit?: number; // 1-100, default 1
  lease_duration_secs?: number; // 5-3600, default 30
}
```

**Response:**
```typescript
{
  jobs: ClaimedJob[];
}

interface ClaimedJob {
  id: string;
  queue_name: string;
  payload: object;
  retry_count: number;
  max_retries: number;
  timeout_seconds: number;
  lease_expires_at?: string;
}
```

### POST /api/v1/jobs/{id}/complete

**Request:**
```typescript
{
  worker_id: string;
  result?: object;
}
```

**Response:** `{ success: true }`

### POST /api/v1/jobs/{id}/fail

**Request:**
```typescript
{
  worker_id: string;
  error: string; // 1-2048 chars
}
```

**Response:** `{ success: true }` or `{ success: false, error: string }`

### POST /api/v1/jobs/{id}/heartbeat

**Request:**
```typescript
{
  worker_id: string;
  lease_duration_secs: number; // 5-3600
}
```

**Response:** `{ success: true }`

### POST /api/v1/jobs/bulk

**Request:**
```typescript
{
  queue_name: string;
  jobs: BulkJobItem[]; // max 100
  default_priority?: number;
  default_max_retries?: number;
  default_timeout_seconds?: number;
}

interface BulkJobItem {
  payload: object;
  priority?: number;
  idempotency_key?: string;
  scheduled_at?: string;
}
```

**Response:**
```typescript
{
  succeeded: { index: number; job_id: string; created: boolean }[];
  failed: { index: number; error: string }[];
  total: number;
  success_count: number;
  failure_count: number;
}
```

---

## Queues

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/queues` | List queues |
| GET | `/api/v1/queues/{name}` | Get queue config |
| PUT | `/api/v1/queues/{name}/config` | Update queue config |
| GET | `/api/v1/queues/{name}/stats` | Get queue stats |
| POST | `/api/v1/queues/{name}/pause` | Pause queue |
| POST | `/api/v1/queues/{name}/resume` | Resume queue |
| DELETE | `/api/v1/queues/{name}` | Delete queue |

### Queue Models

```typescript
interface QueueConfig {
  id: string;
  organization_id: string;
  queue_name: string;
  max_retries: number;
  default_timeout: number;
  rate_limit?: number;
  enabled: boolean;
  settings: object;
  created_at: string;
  updated_at: string;
}

interface QueueConfigSummary {
  queue_name: string;
  max_retries: number;
  default_timeout: number;
  rate_limit?: number;
  enabled: boolean;
}

interface QueueStats {
  queue_name: string;
  pending_jobs: number;
  processing_jobs: number;
  completed_jobs_24h: number;
  failed_jobs_24h: number;
  avg_processing_time_ms?: number;
  max_job_age_seconds?: number;
  active_workers: number;
}

interface PauseQueueResponse {
  queue_name: string;
  paused: boolean;
  paused_at: string;
  reason?: string;
}

interface ResumeQueueResponse {
  queue_name: string;
  resumed: boolean;
  paused_duration_secs: number;
}
```

---

## Workers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/workers` | List workers |
| POST | `/api/v1/workers/register` | Register worker |
| GET | `/api/v1/workers/{id}` | Get worker |
| POST | `/api/v1/workers/{id}/heartbeat` | Worker heartbeat |
| POST | `/api/v1/workers/{id}/deregister` | Deregister worker |

### Worker Models

```typescript
interface Worker {
  id: string;
  organization_id: string;
  queue_name: string;
  hostname: string;
  worker_type?: string;
  max_concurrency: number;
  current_jobs: number;
  status: 'healthy' | 'degraded' | 'offline' | 'draining';
  last_heartbeat: string;
  metadata: object;
  version?: string;
  registered_at: string;
}

interface WorkerSummary {
  id: string;
  queue_name: string;
  hostname: string;
  status: string;
  current_jobs: number;
  max_concurrency: number;
  last_heartbeat: string;
}

interface RegisterWorkerRequest {
  queue_name: string;
  hostname: string;
  worker_type?: string;
  max_concurrency?: number; // 1-100, default 5
  metadata?: object;
  version?: string;
}

interface RegisterWorkerResponse {
  id: string;
  queue_name: string;
  lease_duration_secs: number;
  heartbeat_interval_secs: number;
}

interface WorkerHeartbeatRequest {
  current_jobs: number;
  status?: string;
  metadata?: object;
}
```

---

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/schedules` | List schedules |
| POST | `/api/v1/schedules` | Create schedule |
| GET | `/api/v1/schedules/{id}` | Get schedule |
| PUT | `/api/v1/schedules/{id}` | Update schedule |
| DELETE | `/api/v1/schedules/{id}` | Delete schedule |
| POST | `/api/v1/schedules/{id}/pause` | Pause schedule |
| POST | `/api/v1/schedules/{id}/resume` | Resume schedule |
| POST | `/api/v1/schedules/{id}/trigger` | Manual trigger |
| GET | `/api/v1/schedules/{id}/history` | Execution history |

### Schedule Models

```typescript
interface Schedule {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  cron_expression: string;
  timezone: string;
  queue_name: string;
  payload_template: object;
  priority: number;
  max_retries: number;
  timeout_seconds: number;
  is_active: boolean;
  last_run_at?: string;
  next_run_at?: string;
  run_count: number;
  tags?: object;
  metadata?: object;
  created_at: string;
  updated_at: string;
}

interface CreateScheduleRequest {
  name: string;
  description?: string;
  cron_expression: string;
  timezone?: string; // default 'UTC'
  queue_name: string;
  payload_template: object;
  priority?: number;
  max_retries?: number;
  timeout_seconds?: number;
  tags?: object;
  metadata?: object;
}

interface CreateScheduleResponse {
  id: string;
  name: string;
  cron_expression: string;
  next_run_at?: string;
}

interface ScheduleRun {
  id: string;
  schedule_id: string;
  job_id?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_message?: string;
  started_at: string;
  completed_at?: string;
}
```

---

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/workflows` | List workflows |
| POST | `/api/v1/workflows` | Create workflow |
| GET | `/api/v1/workflows/{id}` | Get workflow |
| POST | `/api/v1/workflows/{id}/cancel` | Cancel workflow |
| POST | `/api/v1/workflows/{id}/retry` | Retry failed workflow |
| GET | `/api/v1/jobs/{id}/dependencies` | Get job dependencies |
| POST | `/api/v1/jobs/{id}/dependencies` | Add job dependencies |

### Workflow Models

```typescript
interface Workflow {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  metadata?: object;
}

interface WorkflowResponse {
  id: string;
  name: string;
  status: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  progress_percent: number;
  created_at: string;
  completed_at?: string;
}

interface CreateWorkflowRequest {
  name: string;
  description?: string;
  jobs: WorkflowJobDefinition[];
  metadata?: object;
}

interface WorkflowJobDefinition {
  key: string;
  queue_name: string;
  payload: object;
  depends_on?: string[];
  dependency_mode?: 'all' | 'any';
  priority?: number;
  max_retries?: number;
  timeout_seconds?: number;
}

interface CreateWorkflowResponse {
  workflow_id: string;
  job_ids: { key: string; job_id: string }[];
}
```

---

## Outgoing Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/outgoing-webhooks` | List webhooks |
| POST | `/api/v1/outgoing-webhooks` | Create webhook |
| GET | `/api/v1/outgoing-webhooks/{id}` | Get webhook |
| PUT | `/api/v1/outgoing-webhooks/{id}` | Update webhook |
| DELETE | `/api/v1/outgoing-webhooks/{id}` | Delete webhook |
| POST | `/api/v1/outgoing-webhooks/{id}/test` | Test webhook |
| GET | `/api/v1/outgoing-webhooks/{id}/deliveries` | Delivery history |

### Webhook Events

Valid event types:
- `job.created`
- `job.started`
- `job.completed`
- `job.failed`
- `job.cancelled`
- `queue.paused`
- `queue.resumed`
- `worker.registered`
- `worker.deregistered`
- `schedule.triggered`

### Webhook Models

```typescript
interface OutgoingWebhook {
  id: string;
  organization_id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  failure_count: number;
  last_triggered_at?: string;
  last_status?: 'success' | 'failed';
  created_at: string;
  updated_at: string;
}

interface CreateOutgoingWebhookRequest {
  name: string;
  url: string;
  events: string[];
  secret?: string;
  enabled?: boolean;
}

interface TestWebhookResponse {
  success: boolean;
  status_code?: number;
  response_time_ms: number;
  error?: string;
}

interface OutgoingWebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: object;
  status: 'pending' | 'success' | 'failed';
  status_code?: number;
  response_body?: string;
  error?: string;
  attempts: number;
  created_at: string;
  delivered_at?: string;
}
```

---

## Billing

|| Method | Path | Description |
||--------|------|-------------|
|| GET | `/api/v1/billing/status` | Get billing status for current organization |
|| POST | `/api/v1/billing/portal` | Create Stripe billing portal session |

### GET /api/v1/billing/status

**Response:**
```typescript
{
  plan_tier: string;
  stripe_subscription_id?: string | null;
  stripe_subscription_status?: string | null;
  stripe_current_period_end?: string | null; // ISO8601
  stripe_cancel_at_period_end?: boolean | null;
  has_stripe_customer: boolean;
}
```

### POST /api/v1/billing/portal

**Request:**
```typescript
{
  return_url: string;
}
```

**Response:**
```typescript
{
  url: string;
}
```

---

## API Keys

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/api-keys` | List API keys |
| POST | `/api/v1/api-keys` | Create API key |
| GET | `/api/v1/api-keys/{id}` | Get API key |
| PUT | `/api/v1/api-keys/{id}` | Update API key |
| DELETE | `/api/v1/api-keys/{id}` | Revoke API key |

### API Key Models

```typescript
interface ApiKeySummary {
  id: string;
  name: string;
  queues: string[];
  rate_limit?: number;
  is_active: boolean;
  created_at: string;
  last_used?: string;
  expires_at?: string;
}

interface CreateApiKeyRequest {
  name: string;
  queues?: string[];
  rate_limit?: number;
  expires_at?: string;
}

interface CreateApiKeyResponse {
  id: string;
  key: string; // Raw key - only shown once!
  name: string;
  created_at: string;
  expires_at?: string;
}

interface UpdateApiKeyRequest {
  name?: string;
  queues?: string[];
  rate_limit?: number;
  is_active?: boolean;
}
```

---

## Organizations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/organizations` | Create organization (public) |
| GET | `/api/v1/organizations` | List organizations |
| GET | `/api/v1/organizations/{id}` | Get organization |
| PUT | `/api/v1/organizations/{id}` | Update organization |
| DELETE | `/api/v1/organizations/{id}` | Delete organization |
| GET | `/api/v1/organizations/usage` | Get usage & limits |
| GET | `/api/v1/organizations/{id}/members` | Get members |

### Organization Models

```typescript
interface Organization {
  id: string;
  name: string;
  slug: string;
  plan_tier: 'free' | 'starter' | 'pro' | 'enterprise';
  billing_email?: string;
  settings: object;
  custom_limits?: object;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  stripe_subscription_status?: string;
  stripe_current_period_end?: string;
  stripe_cancel_at_period_end?: boolean;
  created_at: string;
  updated_at: string;
}

interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  created_at: string;
}

interface CreateOrganizationRequest {
  name: string;
  slug: string;
  billing_email?: string;
}

interface CreateOrganizationResponse {
  organization: Organization;
  api_key: {
    id: string;
    key: string;
    name: string;
    created_at: string;
  };
}

interface UsageInfo {
  plan: string; // 'free' | 'starter' | 'pro' | 'enterprise'
  plan_display_name: string;
  limits: PlanLimits;
  usage: ResourceUsage;
  warnings: UsageWarning[];
}

interface PlanLimits {
  tier: string;
  display_name: string;
  max_jobs_per_day?: number | null;
  max_active_jobs?: number | null;
  max_queues?: number | null;
  max_workers?: number | null;
  max_api_keys?: number | null;
  max_schedules?: number | null;
  max_workflows?: number | null;
  max_webhooks?: number | null;
  max_payload_size_bytes: number;
  rate_limit_requests_per_second: number;
  rate_limit_burst: number;
  job_retention_days: number;
  history_retention_days: number;
}

interface ResourceUsage {
  jobs_today: UsageItem;
  active_jobs: UsageItem;
  queues: UsageItem;
  workers: UsageItem;
  api_keys: UsageItem;
  schedules: UsageItem;
  workflows: UsageItem;
  webhooks: UsageItem;
}

interface UsageItem {
  current: number;
  limit?: number | null;
  percentage?: number | null;
  is_disabled: boolean;
}

interface UsageWarning {
  resource: string;
  message: string;
  severity: 'warning' | 'critical' | string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
  invited_by?: string;
}
```

---

## Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dashboard` | Aggregated dashboard data (protected) |

### Dashboard Models

```typescript
interface DashboardData {
  system: SystemInfo;
  jobs: JobSummaryStats;
  queues: QueueSummary[];
  workers: WorkerSummary;
  recent_activity: RecentActivity;
}

interface SystemInfo {
  version: string;
  uptime_seconds: number;
  started_at: string;
  database_status: string;
  cache_status: string;
  environment: string;
}

interface JobSummaryStats {
  total: number;
  pending: number;
  processing: number;
  completed_24h: number;
  failed_24h: number;
  deadletter: number;
  avg_wait_time_ms?: number | null;
  avg_processing_time_ms?: number | null;
}

interface QueueSummary {
  name: string;
  pending: number;
  processing: number;
  paused: boolean;
}

interface WorkerSummary {
  total: number;
  healthy: number;
  unhealthy: number;
}

interface RecentActivity {
  jobs_created_1h: number;
  jobs_completed_1h: number;
  jobs_failed_1h: number;
}
```

---

## Webhook Ingestion

Each organization gets a unique webhook URL for receiving events from external sources.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/webhooks/{org_id}/custom` | Custom webhook ingestion |

### Webhook Token Management

A webhook token is automatically generated when your organization is created.
Use these endpoints to manage it:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/organizations/webhook-token` | Get current token and URL |
| POST | `/api/v1/organizations/webhook-token/regenerate` | Generate new token |
| POST | `/api/v1/organizations/webhook-token/clear` | Remove token (not recommended) |

```typescript
// Get your webhook token and URL
const response = await fetch('/api/v1/organizations/webhook-token', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
const { webhook_token, webhook_url } = await response.json();

// Regenerate the token
await fetch('/api/v1/organizations/webhook-token/regenerate', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
```

When configured, all incoming webhooks must include the `X-Webhook-Token` header.

### Sending Webhooks to Spooled

Configure your external service to POST to your webhook URL:

```bash
curl -X POST https://api.spooled.cloud/api/v1/webhooks/{org_id}/custom \
  -H "X-Webhook-Token: your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "queue_name": "my-events",
    "event_type": "order.created",
    "payload": {"order_id": 123},
    "idempotency_key": "order-123"
  }'
```

Custom webhook request shape:

```typescript
interface CustomWebhookRequest {
  queue_name: string;
  event_type?: string;
  payload: object;
  idempotency_key?: string;
  priority?: number;
}
```

---

## Admin API

All admin endpoints require `X-Admin-Key` header authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/admin/organizations` | List organizations |
| POST | `/api/v1/admin/organizations` | Create organization |
| GET | `/api/v1/admin/organizations/{id}` | Get organization detail |
| PATCH | `/api/v1/admin/organizations/{id}` | Update organization |
| DELETE | `/api/v1/admin/organizations/{id}` | Delete organization (soft/hard) |
| POST | `/api/v1/admin/organizations/{id}/api-keys` | Create API key |
| POST | `/api/v1/admin/organizations/{id}/reset-usage` | Reset usage counters |
| GET | `/api/v1/admin/stats` | Platform-wide stats |
| GET | `/api/v1/admin/plans` | List plan tiers & limits |

## Real-time

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ws` | WebSocket connection |
| GET | `/api/v1/events` | SSE stream (all events) |
| GET | `/api/v1/events/jobs/{id}` | SSE for specific job |
| GET | `/api/v1/events/queues/{name}` | SSE for specific queue |

### WebSocket Protocol

**Connection:** `wss://api.spooled.cloud/api/v1/ws?token=<jwt>`

**Client Commands:**
```typescript
{ cmd: 'Subscribe', queue?: string, job_id?: string }
{ cmd: 'Unsubscribe', queue?: string, job_id?: string }
{ cmd: 'Ping' }
```

**Server Events:**
```typescript
{
  type: 'JobStatusChange' | 'JobCreated' | 'JobCompleted' | 'JobFailed' |
        'QueueStats' | 'WorkerHeartbeat' | 'WorkerRegistered' |
        'WorkerDeregistered' | 'SystemHealth' | 'Ping' | 'Error';
  data: object;
}
```

### Event Type Mapping

| Server enum variant | SDK event name |
|---------------------|----------------|
| JobStatusChange | `job.status` |
| JobCreated | `job.created` |
| JobCompleted | `job.completed` |
| JobFailed | `job.failed` |
| QueueStats | `queue.stats` |
| WorkerHeartbeat | `worker.heartbeat` |
| WorkerRegistered | `worker.registered` |
| WorkerDeregistered | `worker.deregistered` |
| SystemHealth | `system.health` |
| Ping | `ping` |
| Error | `error` |

---

## Error Response Format

All API errors return JSON:

```typescript
{
  code: string;
  message: string;
  details?: object;
}
```

### HTTP Status Codes

| Status | Error Class |
|--------|-------------|
| 400 | ValidationError |
| 401 | AuthenticationError |
| 403 | AuthorizationError |
| 404 | NotFoundError |
| 409 | ConflictError |
| 413 | PayloadTooLargeError |
| 429 | RateLimitError |
| 5xx | ServerError |

### Rate Limit Headers

When rate limited (429), the response may include:
- `Retry-After: <seconds>`
- `X-RateLimit-Limit: <number>`
- `X-RateLimit-Remaining: <number>`
- `X-RateLimit-Reset: <unix-timestamp>`

---

## Notes on OpenAPI Drift

The following endpoints exist in backend routes but are missing from `docs/openapi.yaml`:

1. **Worker processing endpoints:**
   - `POST /api/v1/jobs/claim`
   - `POST /api/v1/jobs/{id}/complete`
   - `POST /api/v1/jobs/{id}/fail`
   - `POST /api/v1/jobs/{id}/heartbeat`

2. **Queue delete:**
   - `DELETE /api/v1/queues/{name}`

3. **Billing endpoints:**
   - `GET /api/v1/billing/status`
   - `POST /api/v1/billing/portal`

These are implemented in the SDK based on backend behavior.
