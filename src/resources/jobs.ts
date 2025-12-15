/**
 * Jobs Resource
 *
 * Handles job operations including worker processing endpoints.
 */

import type { HttpClient } from '../utils/http.js';
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
} from '../types/jobs.js';

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
    return this.http.post<CreateJobResult>('/jobs', params);
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
    return this.http.get<JobSummary[]>('/jobs', { params: params as Record<string, string | number | boolean | undefined> });
  }

  /**
   * Get a job by ID
   */
  async get(id: string): Promise<Job> {
    return this.http.get<Job>(`/jobs/${id}`);
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
    return this.http.post<Job>(`/jobs/${id}/retry`);
  }

  /**
   * Boost job priority
   */
  async boostPriority(id: string, priority: number): Promise<BoostPriorityResponse> {
    return this.http.put<BoostPriorityResponse>(`/jobs/${id}/priority`, { priority });
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<JobStats> {
    return this.http.get<JobStats>('/jobs/stats');
  }

  /**
   * Get status of multiple jobs at once
   */
  async batchStatus(ids: string[]): Promise<BatchJobStatus[]> {
    if (ids.length === 0) {
      return [];
    }
    if (ids.length > 100) {
      throw new Error('Maximum 100 job IDs allowed per request');
    }
    return this.http.get<BatchJobStatus[]>('/jobs/status', {
      params: { ids: ids.join(',') },
    });
  }

  /**
   * Bulk enqueue multiple jobs
   */
  async bulkEnqueue(params: BulkEnqueueParams): Promise<BulkEnqueueResponse> {
    return this.http.post<BulkEnqueueResponse>('/jobs/bulk', params);
  }

  // Worker processing endpoints

  /**
   * Claim jobs for worker processing
   */
  async claim(params: ClaimJobsParams): Promise<ClaimJobsResult> {
    return this.http.post<ClaimJobsResult>('/jobs/claim', params);
  }

  /**
   * Complete a job (worker ack)
   */
  async complete(id: string, params: CompleteJobParams): Promise<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/jobs/${id}/complete`, params);
  }

  /**
   * Fail a job (worker nack)
   */
  async fail(id: string, params: FailJobParams): Promise<{ success: boolean; error?: string }> {
    return this.http.post<{ success: boolean; error?: string }>(`/jobs/${id}/fail`, params);
  }

  /**
   * Extend job lease (heartbeat)
   */
  async heartbeat(id: string, params: HeartbeatJobParams): Promise<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`/jobs/${id}/heartbeat`, params);
  }

  // DLQ operations (private implementations)

  private async listDlq(params?: ListDlqParams): Promise<JobSummary[]> {
    return this.http.get<JobSummary[]>('/jobs/dlq', { params: params as Record<string, string | number | boolean | undefined> });
  }

  private async retryDlq(params: RetryDlqParams): Promise<RetryDlqResponse> {
    return this.http.post<RetryDlqResponse>('/jobs/dlq/retry', params);
  }

  private async purgeDlq(params: PurgeDlqParams): Promise<PurgeDlqResponse> {
    return this.http.post<PurgeDlqResponse>('/jobs/dlq/purge', params);
  }
}
