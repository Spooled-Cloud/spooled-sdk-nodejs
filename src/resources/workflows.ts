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
} from '../types/workflows.js';

/** Job dependency operations */
export interface JobDependencyOperations {
  /** Get job dependencies */
  getDependencies(jobId: string): Promise<JobWithDependencies>;
  /** Add dependencies to a job */
  addDependencies(jobId: string, params: AddDependenciesParams): Promise<AddDependenciesResponse>;
}

export class WorkflowsResource {
  /** Job dependency operations */
  readonly jobs: JobDependencyOperations;

  constructor(private readonly http: HttpClient) {
    this.jobs = {
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

  // Job dependency operations (private implementations)

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
