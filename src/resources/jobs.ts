/**
 * Jobs Resource
 *
 * Handles job operations including worker processing endpoints.
 */

import type { HttpClient } from "../utils/http.js";
import { coerceFailureMessage } from "../utils/failure.js";
import type {
  Job,
  JobSummary,
  JobStats,
  CreateJobParams,
  CreateJobResult,
  ListJobsParams,
  BatchJobStatus,
  ClaimJobsParams,
  ClaimJobsResult,
  CompleteJobParams,
  FailJobParams,
  HeartbeatJobParams,
  BoostPriorityResponse,
  BulkEnqueueParams,
  BulkEnqueueResponse,
  ListDlqParams,
  RetryDlqParams,
  RetryDlqResponse,
  PurgeDlqParams,
  PurgeDlqResponse,
} from "../types/jobs.js";

/** DLQ operations */
export interface DlqOperations {
  /** List jobs in dead-letter queue */
  list(params?: ListDlqParams): Promise<JobSummary[]>;
  /** Retry jobs from DLQ */
  retry(params: RetryDlqParams): Promise<RetryDlqResponse>;
  /** Purge jobs from DLQ */
  purge(params: PurgeDlqParams): Promise<PurgeDlqResponse>;
}

export class JobsResource {
  /** Dead-letter queue operations */
  readonly dlq: DlqOperations;

  constructor(private readonly http: HttpClient) {
    this.dlq = {
      list: this.listDlq.bind(this),
      retry: this.retryDlq.bind(this),
      purge: this.purgeDlq.bind(this),
    };
  }

  /**
   * Create a new job
   */
  async create(params: CreateJobParams): Promise<CreateJobResult> {
    // With an idempotency key the server returns the existing job for a replay
    // (`created: false`), so a network error or 5xx can be retried safely.
    return this.http.post<CreateJobResult>("/jobs", params, {
      idempotent: params.idempotencyKey ? true : undefined,
    });
  }

  /**
   * Create a job and return the full job object
   */
  async createAndGet(params: CreateJobParams): Promise<Job> {
    const result = await this.create(params);
    return this.get(result.id);
  }

  /**
   * List jobs with optional filtering
   */
  async list(params?: ListJobsParams): Promise<JobSummary[]> {
    const rows = await this.http.get<JobSummary[]>("/jobs", {
      params: params as Record<string, string | number | boolean | undefined>,
    });
    return rows.map((row) => ({
      ...row,
      jobType: row.jobType ?? jobTypeFromPayload(row),
    }));
  }

  /**
   * Get a job by ID
   */
  async get(id: string): Promise<Job> {
    const job = await this.http.get<Job>(`/jobs/${id}`);
    return withJobType(job);
  }

  /**
   * Cancel a pending or scheduled job
   */
  async cancel(id: string): Promise<void> {
    await this.http.delete(`/jobs/${id}`);
  }

  /**
   * Retry a failed or dead-lettered job
   */
  async retry(id: string): Promise<Job> {
    const job = await this.http.post<Job>(`/jobs/${id}/retry`);
    return withJobType(job);
  }

  /**
   * Boost job priority
   */
  async boostPriority(
    id: string,
    priority: number,
  ): Promise<BoostPriorityResponse> {
    return this.http.put<BoostPriorityResponse>(`/jobs/${id}/priority`, {
      priority,
    });
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<JobStats> {
    return this.http.get<JobStats>("/jobs/stats");
  }

  /**
   * Get status of multiple jobs at once
   */
  async batchStatus(ids: string[]): Promise<BatchJobStatus[]> {
    if (ids.length === 0) {
      return [];
    }
    if (ids.length > 100) {
      throw new Error("Maximum 100 job IDs allowed per request");
    }
    return this.http.get<BatchJobStatus[]>("/jobs/status", {
      params: { ids: ids.join(",") },
    });
  }

  /**
   * Bulk enqueue multiple jobs
   */
  async bulkEnqueue(params: BulkEnqueueParams): Promise<BulkEnqueueResponse> {
    return this.http.post<BulkEnqueueResponse>("/jobs/bulk", params);
  }

  // Worker processing endpoints

  /**
   * Claim jobs for worker processing
   */
  async claim(params: ClaimJobsParams): Promise<ClaimJobsResult> {
    return this.http.post<ClaimJobsResult>("/jobs/claim", params);
  }

  /**
   * Complete a job (worker ack)
   *
   * Lease-fenced and idempotent on the server, so a network error, timeout or
   * 5xx is retried: a lost ack would otherwise re-run a finished job.
   */
  async complete(
    id: string,
    params: CompleteJobParams,
  ): Promise<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/jobs/${id}/complete`,
      params,
      { idempotent: true },
    );
  }

  /**
   * Fail a job (worker nack)
   *
   * `params.error` is made acceptable first: empty text becomes "Job failed"
   * and text over 2048 characters is truncated, because the API rejects both
   * with a 400 that would leave the job processing until its lease expires.
   * Retried like {@link JobsResource.complete}.
   */
  async fail(
    id: string,
    params: FailJobParams,
  ): Promise<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(
      `/jobs/${id}/fail`,
      { ...params, error: coerceFailureMessage(params.error) },
      { idempotent: true },
    );
  }

  /**
   * Extend job lease (heartbeat)
   *
   * Retried like {@link JobsResource.complete}: with the default 30 s lease and
   * 15 s heartbeat, one lost heartbeat leaves no slack.
   */
  async heartbeat(
    id: string,
    params: HeartbeatJobParams,
  ): Promise<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `/jobs/${id}/heartbeat`,
      params,
      { idempotent: true },
    );
  }

  // DLQ operations (private implementations)

  private async listDlq(params?: ListDlqParams): Promise<JobSummary[]> {
    const rows = await this.http.get<JobSummary[]>("/jobs/dlq", {
      params: params as Record<string, string | number | boolean | undefined>,
    });
    return rows.map((row) => ({
      ...row,
      jobType: row.jobType ?? jobTypeFromPayload(row),
    }));
  }

  private async retryDlq(params: RetryDlqParams): Promise<RetryDlqResponse> {
    return this.http.post<RetryDlqResponse>("/jobs/dlq/retry", params);
  }

  private async purgeDlq(params: PurgeDlqParams): Promise<PurgeDlqResponse> {
    return this.http.post<PurgeDlqResponse>("/jobs/dlq/purge", params);
  }
}

function withJobType<T extends { jobType?: string; payload?: unknown }>(
  job: T,
): T {
  return {
    ...job,
    jobType: job.jobType ?? jobTypeFromPayload(job) ?? undefined,
  };
}

function jobTypeFromPayload(row: {
  jobType?: string;
  payload?: unknown;
}): string | undefined {
  if (typeof row.jobType === "string" && row.jobType !== "") {
    return row.jobType;
  }
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const rec = payload as { jobType?: unknown; job_type?: unknown };
  for (const value of [rec.jobType, rec.job_type]) {
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}
