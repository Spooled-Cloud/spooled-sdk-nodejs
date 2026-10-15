/**
 * Common Types
 *
 * Shared types used across the SDK.
 */

/** JSON primitive types */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON value type.
 *
 * Inside user-owned JSON (`payload`, `result`, `tags`, and the other
 * free-form fields) an integer whose magnitude is greater than 2^53 is
 * returned as a decimal string, so the digits survive decoding. A float64
 * cannot hold those integers, and a string is already a `JsonValue`. Every
 * smaller number, and every number outside those fields, stays a `number`.
 * gRPC payloads cannot do this: `google.protobuf.Struct` has already stored
 * the value as a float64.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/** JSON object type */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JSON array type */
export type JsonArray = JsonValue[];

/** Job status enum values */
export type JobStatus =
  | "pending"
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "deadletter"
  | "cancelled";

/** Worker status enum values */
export type WorkerStatus = "healthy" | "degraded" | "offline" | "draining";

/** Workflow status enum values */
export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Plan tier enum values */
export type PlanTier = "free" | "starter" | "pro" | "enterprise";

/** Schedule run status */
export type ScheduleRunStatus = "pending" | "running" | "completed" | "failed";

/** Webhook delivery status */
export type WebhookDeliveryStatus = "pending" | "success" | "failed";

/**
 * Webhook event types.
 *
 * `job.deadlettered`, `job.retried`, `workflow.completed` and
 * `workflow.failed` need API 0.1.122 or later. The SDK does not check event
 * names in responses: a name newer than this list is passed through as a
 * string, so give a `switch` over it a `default` branch.
 */
export type WebhookEventType =
  | "job.created"
  | "job.started"
  | "job.completed"
  | "job.failed"
  | "job.cancelled"
  | "queue.paused"
  | "queue.resumed"
  | "worker.registered"
  | "worker.deregistered"
  | "schedule.triggered"
  /** Sent next to every `job.failed` whose `data.status` is `deadletter`. */
  | "job.deadlettered"
  /** A manual retry (job, DLQ or workflow retry) put the job back to pending. */
  | "job.retried"
  /** A workflow finished; announced at most once, up to ~10 s late. */
  | "workflow.completed"
  /** A workflow failed; announced at most once, up to ~10 s late. */
  | "workflow.failed";

/**
 * Body format of an outgoing webhook (API 0.1.122+).
 *
 * `json` (the default) is the signed JSON envelope. `slack`, `discord` and
 * `teams` send one short chat message built from the event, so a chat
 * service's incoming-webhook URL can be used as it is (`teams` is the legacy
 * Office 365 connector `MessageCard`; Teams Workflows URLs reject it).
 */
export type WebhookFormat = "json" | "slack" | "discord" | "teams";

/** Dependency mode for workflows */
export type DependencyMode = "all" | "any";

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
  orderDir?: "asc" | "desc";
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
 * One page of a list endpoint that reports `X-Has-More` (API 0.1.122+):
 * `GET /jobs`, `GET /jobs/dlq` and `GET /jobs/{id}/history`.
 *
 * The response body stays a bare array; `hasMore` comes from the header.
 */
export interface ListPage<T> {
  /** Items of this page, in the server's order */
  data: T[];
  /**
   * `true` when another page follows: ask again with
   * `offset + data.length`. From the `X-Has-More` header; an older server
   * without it gets a guess from the page size (a full page means "maybe").
   */
  hasMore: boolean;
}

/**
 * Helper to create a paginated response from an array
 */
export function createPaginatedResponse<T>(
  items: T[],
  limit: number,
  offset: number = 0,
  total?: number,
): PaginatedResponse<T> {
  return {
    data: items,
    total,
    offset,
    limit,
    hasMore: items.length === limit,
  };
}
