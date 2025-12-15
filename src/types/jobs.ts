/**
 * Job Types
 *
 * Types for job-related operations.
 */

import type { JobStatus, JsonObject, ListParams } from './common.js';

/** Full job model */
export interface Job {
  id: string;
  organizationId: string;
  queueName: string;
  status: JobStatus;
  payload: JsonObject;
  result?: JsonObject;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  priority: number;
  tags?: JsonObject;
  timeoutSeconds: number;
  parentJobId?: string;
  completionWebhook?: string;
  assignedWorkerId?: string;
  leaseId?: string;
  leaseExpiresAt?: string;
  idempotencyKey?: string;
  updatedAt: string;
  workflowId?: string;
  dependencyMode?: string;
  dependenciesMet?: boolean;
}

/** Job summary for list responses */
export interface JobSummary {
  id: string;
  queueName: string;
  status: JobStatus;
  priority: number;
  retryCount: number;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Parameters for creating a job */
export interface CreateJobParams {
  /** Queue name (1-100 chars, alphanumeric/-/_/.) */
  queueName: string;
  /** Job payload */
  payload: JsonObject;
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
  /** Tags for filtering */
  tags?: JsonObject;
  /** Parent job ID for DAG workflows */
  parentJobId?: string;
  /** Webhook URL for completion notification */
  completionWebhook?: string;
}

/** Result of creating a job */
export interface CreateJobResult {
  id: string;
  created: boolean;
}

/** Parameters for listing jobs */
export interface ListJobsParams extends ListParams {
  /** Filter by queue name */
  queueName?: string;
  /** Filter by status */
  status?: JobStatus;
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
  payload: JsonObject;
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number;
  leaseExpiresAt?: string;
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
  /** Optional result payload */
  result?: JsonObject;
}

/** Parameters for failing a job */
export interface FailJobParams {
  /** Worker ID that owns the job */
  workerId: string;
  /** Error message (1-2048 chars) */
  error: string;
}

/** Parameters for job heartbeat */
export interface HeartbeatJobParams {
  /** Worker ID that owns the job */
  workerId: string;
  /** Lease duration in seconds (5-3600) */
  leaseDurationSecs: number;
}

/** Response for priority boost */
export interface BoostPriorityResponse {
  jobId: string;
  oldPriority: number;
  newPriority: number;
}

/** Item for bulk enqueue */
export interface BulkJobItem {
  payload: JsonObject;
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
export interface ListDlqParams extends ListParams {
  /** Filter by queue name */
  queueName?: string;
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
