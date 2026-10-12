/**
 * Job Types
 *
 * Types for job-related operations.
 */

import type {
  JobStatus,
  JsonValue,
  ListParams,
  PaginationParams,
} from "./common.js";

/** Full job model */
export interface Job {
  id: string;
  organizationId: string;
  queueName: string;
  status: JobStatus;
  payload: JsonValue;
  result?: JsonValue;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  priority: number;
  tags?: JsonValue;
  timeoutSeconds: number;
  parentJobId?: string;
  completionWebhook?: string;
  assignedWorkerId?: string;
  leaseId?: string | null;
  leaseExpiresAt?: string;
  idempotencyKey?: string;
  updatedAt: string;
  workflowId?: string;
  dependencyMode?: string;
  dependenciesMet?: boolean;
  /** From payload.job_type on GET; list summaries send it top-level. */
  jobType?: string;
}

/** Job summary for list responses */
export interface JobSummary {
  id: string;
  queueName: string;
  status: JobStatus;
  priority: number;
  attempt: number;
  maxRetries: number;
  /** From payload.job_type (empty string when absent). */
  jobType?: string;
  /** From list/DLQ `last_error` (null/absent when none). */
  lastError?: string | null;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Parameters for creating a job */
export interface CreateJobParams {
  /** Queue name (1-100 chars, alphanumeric/-/_/.) */
  queueName: string;
  /** Job payload (any JSON) */
  payload: JsonValue;
  /** Priority (-100 to 100, default 0) */
  priority?: number;
  /** Maximum retries (0-100, default 3) */
  maxRetries?: number;
  /** Timeout in seconds (1-86400, default 300) */
  timeoutSeconds?: number;
  /** Scheduled execution time (ISO8601) */
  scheduledAt?: Date | string;
  /** Job expiration time (ISO8601) */
  expiresAt?: Date | string;
  /** Idempotency key for deduplication (max 255 chars) */
  idempotencyKey?: string;
  /** Tags for filtering (object or string array) */
  tags?: JsonValue;
  /** Parent job ID for DAG workflows */
  parentJobId?: string;
  /** Webhook URL for completion notification */
  completionWebhook?: string;
  /** HMAC secret used to sign the `completionWebhook` request (never returned by the API) */
  completionWebhookSecret?: string;
}

/** Result of creating a job */
export interface CreateJobResult {
  id: string;
  created: boolean;
}

/**
 * Server-side job search filters (API 0.1.122+), shared by `GET /jobs` and
 * `GET /jobs/dlq`. All filters combine with AND. An invalid value is a 400
 * `ValidationError`; an older server ignores them.
 */
export interface JobSearchParams {
  /**
   * Search text, case-insensitive: matches a job whose id starts with it, or
   * whose queue name or `payload.job_type` contains it (at most 255 bytes).
   */
  q?: string;
  /** Exact `payload.job_type` (at most 255 bytes) */
  jobType?: string;
  /**
   * Only jobs created at or after this instant. A `Date` is sent as an
   * ISO 8601 UTC string; a string must be RFC 3339.
   */
  createdAfter?: Date | string;
  /** Only jobs created before this instant (exclusive); see `createdAfter` */
  createdBefore?: Date | string;
}

/** Parameters for listing jobs */
export interface ListJobsParams extends ListParams, JobSearchParams {
  /** Filter by queue name */
  queueName?: string;
  /**
   * Filter by status: one status, or several (sent as the comma list
   * `status=failed,deadletter`, which needs API 0.1.122+).
   */
  status?: JobStatus | readonly JobStatus[];
  /** Filter by a single tag (matches Postgres `tags ? tag` semantics) */
  tag?: string;
}

/** Job statistics */
export interface JobStats {
  pending: number;
  scheduled: number;
  processing: number;
  completed: number;
  failed: number;
  deadletter: number;
  cancelled: number;
  total: number;
}

/** Batch job status */
export interface BatchJobStatus {
  id: string;
  status: JobStatus;
  queueName: string;
  retryCount: number;
  createdAt: string;
  completedAt?: string;
}

/** Claimed job for worker processing */
export interface ClaimedJob {
  id: string;
  queueName: string;
  payload: JsonValue;
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number;
  leaseExpiresAt?: string;
  /**
   * Lease fencing token for this claim. Send it back on
   * complete/fail/heartbeat: the API requires it (a call without it is a 422
   * `ValidationError`, since 2026-07) and rejects a stale lease with 409.
   */
  leaseId?: string | null;
}

/** Parameters for claiming jobs */
export interface ClaimJobsParams {
  /** Queue name to claim from */
  queueName: string;
  /** Worker ID */
  workerId: string;
  /** Maximum jobs to claim (1-100, default 1) */
  limit?: number;
  /** Lease duration in seconds (5-3600, default 30) */
  leaseDurationSecs?: number;
}

/** Result of claiming jobs */
export interface ClaimJobsResult {
  jobs: ClaimedJob[];
}

/** Parameters for completing a job */
export interface CompleteJobParams {
  /** Worker ID that owns the job */
  workerId: string;
  /** Optional result payload (any JSON) */
  result?: JsonValue;
  /**
   * Lease fencing token from the claimed job (`ClaimedJob.leaseId`). The API
   * requires it: without it the call is a 422 `ValidationError`.
   */
  leaseId?: string;
}

/** Parameters for failing a job */
export interface FailJobParams {
  /** Worker ID that owns the job */
  workerId: string;
  /** Error message (1-2048 chars) */
  error: string;
  /**
   * Lease fencing token from the claimed job (`ClaimedJob.leaseId`). The API
   * requires it: without it the call is a 422 `ValidationError`.
   */
  leaseId?: string;
}

/** Parameters for job heartbeat */
export interface HeartbeatJobParams {
  /** Worker ID that owns the job */
  workerId: string;
  /** Lease duration in seconds (5-3600) */
  leaseDurationSecs: number;
  /**
   * Lease fencing token from the claimed job (`ClaimedJob.leaseId`). The API
   * requires it: without it the call is a 422 `ValidationError`.
   */
  leaseId?: string;
}

/** Response for priority boost */
export interface BoostPriorityResponse {
  jobId: string;
  oldPriority: number;
  newPriority: number;
}

/** Item for bulk enqueue */
export interface BulkJobItem {
  payload: JsonValue;
  priority?: number;
  idempotencyKey?: string;
  scheduledAt?: Date | string;
}

/** Parameters for bulk enqueue */
export interface BulkEnqueueParams {
  /** Queue name */
  queueName: string;
  /** Jobs to enqueue (max 100) */
  jobs: BulkJobItem[];
  /** Default priority for jobs */
  defaultPriority?: number;
  /** Default max retries */
  defaultMaxRetries?: number;
  /** Default timeout in seconds */
  defaultTimeoutSeconds?: number;
}

/** Result of bulk enqueue */
export interface BulkEnqueueResponse {
  succeeded: Array<{ index: number; jobId: string; created: boolean }>;
  failed: Array<{ index: number; error: string }>;
  total: number;
  successCount: number;
  failureCount: number;
}

/** Parameters for listing DLQ */
export interface ListDlqParams extends ListParams, JobSearchParams {
  /** Filter by queue name */
  queueName?: string;
}

/**
 * Event types of `GET /jobs/{id}/history`. The server records `processing`
 * (REST claim), `completed` (REST complete), `retry_scheduled` and
 * `deadlettered` (REST fail, scheduler sweeps); `created` is defined but not
 * written today, and jobs settled over gRPC have sparse history. Any other
 * string the server sends is passed through.
 */
export type JobHistoryEventType =
  | "created"
  | "processing"
  | "completed"
  | "retry_scheduled"
  | "deadlettered"
  | (string & {});

/** One recorded lifecycle event of a job (`GET /jobs/{id}/history`) */
export interface JobHistoryEvent {
  id: string;
  jobId: string;
  eventType: JobHistoryEventType;
  /** The worker that caused the event, when known */
  workerId?: string | null;
  /**
   * Event details as stored (any JSON, keys left in snake_case as the server
   * wrote them).
   */
  details: JsonValue;
  createdAt: string;
}

/** Parameters for `jobs.history()` (API 0.1.122+) */
export interface JobHistoryParams extends PaginationParams {
  /** `asc` (default, oldest first) or `desc` (newest first) */
  order?: "asc" | "desc";
}

/** Parameters for retrying DLQ jobs */
export interface RetryDlqParams {
  /** Specific job IDs to retry */
  jobIds?: string[];
  /** Queue name to retry from */
  queueName?: string;
  /** Maximum jobs to retry */
  limit?: number;
}

/** Response for DLQ retry */
export interface RetryDlqResponse {
  retriedCount: number;
  retriedJobs: string[];
}

/** Parameters for purging DLQ */
export interface PurgeDlqParams {
  /** Queue name to purge */
  queueName?: string;
  /** Only purge jobs older than this date */
  olderThan?: Date | string;
  /** Must be true to confirm purge */
  confirm: boolean;
}

/** Response for DLQ purge */
export interface PurgeDlqResponse {
  purgedCount: number;
}
