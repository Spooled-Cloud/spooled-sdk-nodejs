/**
 * Workflows Resource
 *
 * Handles workflow operations including job dependencies.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  WorkflowResponse,
  CreateWorkflowParams,
  CreateWorkflowResponse,
  ListWorkflowsParams,
  JobWithDependencies,
  AddDependenciesParams,
  AddDependenciesResponse,
  WorkflowJob,
  WorkflowJobStatus,
} from '../types/workflows.js';

/** Workflow job operations */
export interface WorkflowJobOperations {
  /**
   * List all jobs in a workflow.
   *
   * @param workflowId - The workflow ID
   * @example
   * ```typescript
   * const jobs = await client.workflows.jobs.list('wf_123');
   * console.log('Jobs:', jobs.map(j => j.key));
   * ```
   */
  list(workflowId: string): Promise<WorkflowJob[]>;

  /**
   * Get a specific job within a workflow.
   *
   * @param workflowId - The workflow ID
   * @param jobId - The job ID
   * @example
   * ```typescript
   * const job = await client.workflows.jobs.get('wf_123', 'job_456');
   * console.log('Job status:', job.status);
   * ```
   */
  get(workflowId: string, jobId: string): Promise<WorkflowJob>;

  /**
   * Get the status of all jobs in a workflow.
   *
   * Returns a summary of each job's status and progress.
   *
   * @param workflowId - The workflow ID
   * @example
   * ```typescript
   * const statuses = await client.workflows.jobs.getStatus('wf_123');
   * for (const s of statuses) {
   *   console.log(`${s.key}: ${s.status}`);
   * }
   * ```
   */
  getStatus(workflowId: string): Promise<WorkflowJobStatus[]>;

  /**
   * Get job dependencies.
   *
   * @param jobId - The job ID
   * @example
   * ```typescript
   * const deps = await client.workflows.jobs.getDependencies('job_456');
   * console.log('Depends on:', deps.dependencies);
   * ```
   */
  getDependencies(jobId: string): Promise<JobWithDependencies>;

  /**
   * Add dependencies to a job.
   *
   * @param jobId - The job ID
   * @param params - Dependencies to add
   * @example
   * ```typescript
   * await client.workflows.jobs.addDependencies('job_456', {
   *   dependsOnJobIds: ['job_123'],
   * });
   * ```
   */
  addDependencies(jobId: string, params: AddDependenciesParams): Promise<AddDependenciesResponse>;
}

export class WorkflowsResource {
  /** Workflow job operations */
  readonly jobs: WorkflowJobOperations;

  constructor(private readonly http: HttpClient) {
    this.jobs = {
      list: this.listWorkflowJobs.bind(this),
      get: this.getWorkflowJob.bind(this),
      getStatus: this.getWorkflowJobsStatus.bind(this),
      getDependencies: this.getJobDependencies.bind(this),
      addDependencies: this.addJobDependencies.bind(this),
    };
  }

  /**
   * List all workflows
   */
  async list(params?: ListWorkflowsParams): Promise<WorkflowResponse[]> {
    return this.http.get<WorkflowResponse[]>('/workflows', { params: params as Record<string, string | number | boolean | undefined> });
  }

  /**
   * Create a new workflow
   */
  async create(params: CreateWorkflowParams): Promise<CreateWorkflowResponse> {
    return this.http.post<CreateWorkflowResponse>('/workflows', params);
  }

  /**
   * Get a workflow by ID
   */
  async get(id: string): Promise<WorkflowResponse> {
    return this.http.get<WorkflowResponse>(`/workflows/${id}`);
  }

  /**
   * Cancel a workflow
   */
  async cancel(id: string): Promise<WorkflowResponse> {
    return this.http.post<WorkflowResponse>(`/workflows/${id}/cancel`);
  }

  /**
   * Retry a failed workflow
   *
   * Resets all failed/deadletter jobs back to pending and resumes the workflow.
   * Only workflows with status 'failed' can be retried.
   */
  async retry(id: string): Promise<WorkflowResponse> {
    return this.http.post<WorkflowResponse>(`/workflows/${id}/retry`);
  }

  // Workflow job operations (private implementations)

  private async listWorkflowJobs(workflowId: string): Promise<WorkflowJob[]> {
    return this.http.get<WorkflowJob[]>(`/workflows/${workflowId}/jobs`);
  }

  private async getWorkflowJob(workflowId: string, jobId: string): Promise<WorkflowJob> {
    return this.http.get<WorkflowJob>(`/workflows/${workflowId}/jobs/${jobId}`);
  }

  private async getWorkflowJobsStatus(workflowId: string): Promise<WorkflowJobStatus[]> {
    return this.http.get<WorkflowJobStatus[]>(`/workflows/${workflowId}/jobs/status`);
  }

  private async getJobDependencies(jobId: string): Promise<JobWithDependencies> {
    return this.http.get<JobWithDependencies>(`/jobs/${jobId}/dependencies`);
  }

  private async addJobDependencies(
    jobId: string,
    params: AddDependenciesParams
  ): Promise<AddDependenciesResponse> {
    return this.http.post<AddDependenciesResponse>(`/jobs/${jobId}/dependencies`, params);
  }
}
