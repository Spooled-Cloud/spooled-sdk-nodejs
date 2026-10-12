/**
 * Webhook Ingestion Types
 *
 * The custom endpoint is called by external webhook providers and is
 * authenticated by the org webhook token (not an API key). The GitHub and
 * Stripe option types are kept only so existing code still compiles.
 */

import type { JsonValue, PaginationParams } from "./common.js";

export interface IngestCustomWebhookParams {
  queueName: string;
  eventType?: string;
  payload: JsonValue;
  idempotencyKey?: string;
  priority?: number;
}

/** POST /webhooks/{org_id}/custom — OpenAPI WebhookResponse after camelCase. */
export interface IngestCustomWebhookResponse {
  jobId?: string;
  queueName?: string;
  status?: string;
}

/** `status` of an inbound webhook log entry */
export type InboundDeliveryStatus = "created" | "duplicate";

/** Parameters for `ingest.listDeliveries()` (`GET /webhooks/deliveries`) */
export interface ListInboundDeliveriesParams extends PaginationParams {
  /** `created` (a new job) or `duplicate` (an idempotent replay) */
  status?: InboundDeliveryStatus;
  /**
   * Only entries received at or after this instant. A `Date` is sent as an
   * ISO 8601 UTC string; a string must be RFC 3339.
   */
  since?: Date | string;
  /** Only entries whose job went to this queue (exact match) */
  queueName?: string;
}

/**
 * One accepted request to `POST /webhooks/{org_id}/custom`, from the inbound
 * webhook log (API 0.1.122+). The log never holds the payload or a signature.
 */
export interface InboundWebhookDelivery {
  id: string;
  /** `custom` today */
  provider: string;
  /** The request's event type, `custom` when it had none */
  eventType: string;
  /** Queue of the job the request resolved to */
  matchedQueue: string | null;
  /** Job the request created or matched (`null` for entries before 0.1.122) */
  jobId: string | null;
  /** `created` or `duplicate` (`null` for entries before 0.1.122) */
  status: InboundDeliveryStatus | (string & {}) | null;
  createdAt: string;
}

/** @deprecated The API has no GitHub webhook route; `ingest.github` throws. */
export interface IngestGitHubWebhookOptions {
  /** Value for X-GitHub-Event header (e.g. "pull_request") */
  githubEvent: string;
  /** Optional org-scoped webhook token (X-Webhook-Token) */
  webhookToken?: string;
  /** Optional X-Forwarded-Proto override (production servers may require https) */
  forwardedProto?: "https" | "http" | string;
  /** Provide a precomputed X-Hub-Signature-256 header value (sha256=<hex>) */
  signature?: string;
  /** If provided, the SDK will compute the signature for you */
  secret?: string;
}

/** @deprecated The API has no Stripe webhook route; `ingest.stripe` throws. */
export interface IngestStripeWebhookOptions {
  /** Optional org-scoped webhook token (X-Webhook-Token) */
  webhookToken?: string;
  /** Optional X-Forwarded-Proto override */
  forwardedProto?: "https" | "http" | string;
  /** Provide a precomputed Stripe-Signature header */
  signature?: string;
  /** If provided, the SDK will compute the signature for you */
  secret?: string;
  /** Timestamp (seconds) to use when computing the signature (defaults to now) */
  timestamp?: number;
}
