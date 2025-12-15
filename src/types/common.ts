/**
 * Common Types
 *
 * Shared types used across the SDK.
 */

/** JSON primitive types */
export type JsonPrimitive = string | number | boolean | null;

/** JSON value type */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** JSON object type */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON array type */
export type JsonArray = JsonValue[];

/** Job status enum values */
export type JobStatus =
  | 'pending'
  | 'scheduled'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'deadletter'
  | 'cancelled';

/** Worker status enum values */
export type WorkerStatus = 'healthy' | 'degraded' | 'offline' | 'draining';

/** Workflow status enum values */
export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Plan tier enum values */
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';

/** Schedule run status */
export type ScheduleRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Webhook delivery status */
export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/** Webhook event types */
export type WebhookEventType =
  | 'job.created'
  | 'job.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'queue.paused'
  | 'queue.resumed'
  | 'worker.registered'
  | 'worker.deregistered'
  | 'schedule.triggered';

/** Dependency mode for workflows */
export type DependencyMode = 'all' | 'any';

/** Pagination parameters */
export interface PaginationParams {
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** List parameters with optional sorting */
export interface ListParams extends PaginationParams {
  /** Field to order by */
  orderBy?: string;
  /** Sort direction */
  orderDir?: 'asc' | 'desc';
}

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  /** Items in current page */
  data: T[];
  /** Total count (if available) */
  total?: number;
  /** Current page offset */
  offset: number;
  /** Page size limit */
  limit: number;
  /** Whether there are more results */
  hasMore: boolean;
}

/**
 * Helper to create a paginated response from an array
 */
export function createPaginatedResponse<T>(
  items: T[],
  limit: number,
  offset: number = 0,
  total?: number
): PaginatedResponse<T> {
  return {
    data: items,
    total,
    offset,
    limit,
    hasMore: items.length === limit,
  };
}
