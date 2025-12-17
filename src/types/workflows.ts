/**
 * Workflow Types
 *
 * Types for workflow-related operations.
 */

import type { WorkflowStatus, DependencyMode, JsonObject, ListParams } from './common.js';

/** Full workflow model */
export interface Workflow {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  metadata?: JsonObject;
}

/** Workflow response with progress */
export interface WorkflowResponse {
  id: string;
  name: string;
  status: WorkflowStatus;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  progressPercent: number;
  createdAt: string;
  completedAt?: string;
}

/** Job definition within a workflow */
export interface WorkflowJobDefinition {
  /** Unique key for this job within the workflow */
  key: string;
  /** Queue to enqueue the job to */
  queueName: string;
  /** Job payload */
  payload: JsonObject;
  /** Dependencies (keys of other jobs) */
  dependsOn?: string[];
  /** Dependency mode (default: 'all') */
  dependencyMode?: DependencyMode;
  /** Job priority */
  priority?: number;
  /** Maximum retries */
  maxRetries?: number;
  /** Timeout in seconds */
  timeoutSeconds?: number;
}

/** Parameters for creating a workflow */
export interface CreateWorkflowParams {
  /** Workflow name (1-255 chars) */
  name: string;
  /** Optional description (max 1000 chars) */
  description?: string;
  /** Jobs to create (1-100) */
  jobs: WorkflowJobDefinition[];
  /** Additional metadata */
  metadata?: JsonObject;
}

/** Response for creating a workflow */
export interface CreateWorkflowResponse {
  workflowId: string;
  jobIds: Array<{ key: string; jobId: string }>;
}

/** Parameters for listing workflows */
export interface ListWorkflowsParams extends ListParams {
  /** Filter by status */
  status?: WorkflowStatus;
}

/** Job with dependencies */
export interface JobWithDependencies {
  jobId: string;
  status: string;
  dependencies: Array<{
    jobId: string;
    status: string;
    dependencyType: string;
  }>;
  dependents: Array<{
    jobId: string;
    status: string;
    dependencyType: string;
  }>;
}

/** Parameters for adding dependencies */
export interface AddDependenciesParams {
  /** Job IDs that this job depends on */
  dependsOnJobIds: string[];
  /** Dependency type (default: 'completion') */
  dependencyType?: string;
}

/** Response for adding dependencies */
export interface AddDependenciesResponse {
  added: number;
  dependencies: Array<{
    jobId: string;
    dependsOnJobId: string;
    dependencyType: string;
  }>;
}

/** Job within a workflow */
export interface WorkflowJob {
  /** Job ID */
  id: string;
  /** Workflow ID this job belongs to */
  workflowId: string;
  /** Job key within the workflow */
  key: string;
  /** Queue name */
  queueName: string;
  /** Current job status */
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'deadletter';
  /** Job payload */
  payload: JsonObject;
  /** Job result (if completed) */
  result?: JsonObject;
  /** Error message (if failed) */
  error?: string;
  /** Job IDs this job depends on */
  dependsOn: string[];
  /** Job priority */
  priority: number;
  /** Maximum retries */
  maxRetries: number;
  /** Current attempt number */
  attempt: number;
  /** Timeout in seconds */
  timeoutSeconds?: number;
  /** When the job was created */
  createdAt: string;
  /** When the job started running */
  startedAt?: string;
  /** When the job completed */
  completedAt?: string;
}

/** Workflow job status summary */
export interface WorkflowJobStatus {
  /** Job ID */
  jobId: string;
  /** Job key within the workflow */
  key: string;
  /** Current status */
  status: string;
  /** Progress percentage (0-100) */
  progress?: number;
}
