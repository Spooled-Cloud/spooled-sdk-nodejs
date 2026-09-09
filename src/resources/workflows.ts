/**
 * Workflows Resource
 *
 * Handles workflow operations including job dependencies.
 */

import type { HttpClient } from "../utils/http.js";
import { NotFoundError } from "../errors.js";
import type { JsonObject } from "../types/common.js";
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
} from "../types/workflows.js";

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
  addDependencies(
    jobId: string,
    params: AddDependenciesParams,
  ): Promise<AddDependenciesResponse>;
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
    return this.http.get<WorkflowResponse[]>("/workflows", {
      params: params as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Create a new workflow
   */
  async create(params: CreateWorkflowParams): Promise<CreateWorkflowResponse> {
    return this.http.post<CreateWorkflowResponse>("/workflows", params);
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
  //
  // The backend has no /workflows/{id}/jobs routes. Job rows and dependency
  // edges are on GET /workflows/{id} (WorkflowDetailResponse).

  private async listWorkflowJobs(workflowId: string): Promise<WorkflowJob[]> {
    const detail = await this.http.get<WorkflowDetailPayload>(
      `/workflows/${workflowId}`,
    );
    return mapWorkflowDetailJobs(detail);
  }

  private async getWorkflowJob(
    workflowId: string,
    jobId: string,
  ): Promise<WorkflowJob> {
    const jobs = await this.listWorkflowJobs(workflowId);
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      throw new NotFoundError(
        `Job ${jobId} not found in workflow ${workflowId}`,
      );
    }
    return job;
  }

  private async getWorkflowJobsStatus(
    workflowId: string,
  ): Promise<WorkflowJobStatus[]> {
    const jobs = await this.listWorkflowJobs(workflowId);
    return jobs.map((job) => ({
      jobId: job.id,
      key: job.key,
      status: job.status,
    }));
  }

  private async getJobDependencies(
    jobId: string,
  ): Promise<JobWithDependencies> {
    return this.http.get<JobWithDependencies>(`/jobs/${jobId}/dependencies`);
  }

  private async addJobDependencies(
    jobId: string,
    params: AddDependenciesParams,
  ): Promise<AddDependenciesResponse> {
    const dependsOn = params.dependsOn ?? params.dependsOnJobIds ?? [];
    const mode =
      params.dependencyMode ??
      (params.dependencyType === "any" || params.dependencyType === "all"
        ? params.dependencyType
        : undefined);
    const raw = await this.http.post<{
      dependenciesAdded?: number;
      dependenciesMet?: boolean;
    }>(
      `/jobs/${jobId}/dependencies`,
      {
        depends_on: dependsOn,
        ...(mode ? { dependency_mode: mode } : {}),
      },
      { skipRequestConversion: true },
    );
    return {
      added: raw.dependenciesAdded ?? 0,
      dependenciesMet: raw.dependenciesMet ?? false,
      dependencies: [],
    };
  }
}

interface WorkflowDetailPayload {
  id?: string;
  jobs?: Array<Record<string, unknown>>;
  dependencies?: Array<{
    parentJobId?: string;
    childJobId?: string;
  }>;
}

function mapWorkflowDetailJobs(detail: WorkflowDetailPayload): WorkflowJob[] {
  const workflowId = String(detail.id ?? "");
  const deps = detail.dependencies ?? [];
  return (detail.jobs ?? []).map((job) => {
    const id = String(job.id ?? "");
    const timeoutMs =
      typeof job.timeoutMs === "number" ? job.timeoutMs : undefined;
    const errorObj = job.error;
    let error: string | undefined;
    if (typeof errorObj === "string") {
      error = errorObj;
    } else if (
      errorObj &&
      typeof errorObj === "object" &&
      "message" in errorObj
    ) {
      error = String((errorObj as { message: unknown }).message);
    }
    return {
      id,
      workflowId: String(job.workflowId ?? workflowId),
      key: String(job.key ?? ""),
      queueName: String(job.queueName ?? job.queue ?? ""),
      status: job.status as WorkflowJob["status"],
      payload: (job.payload as JsonObject) ?? {},
      result: (job.result as JsonObject | undefined) ?? undefined,
      error,
      dependsOn: deps
        .filter((dep) => dep.childJobId === id)
        .map((dep) => String(dep.parentJobId ?? "")),
      priority: Number(job.priority ?? 0),
      maxRetries: Number(job.maxRetries ?? 0),
      attempt: Number(job.attempt ?? 0),
      timeoutSeconds:
        timeoutMs != null
          ? Math.max(1, Math.floor(timeoutMs / 1000))
          : undefined,
      createdAt: String(job.createdAt ?? ""),
      startedAt: (job.startedAt as string | undefined) ?? undefined,
      completedAt: (job.completedAt as string | undefined) ?? undefined,
    };
  });
}
