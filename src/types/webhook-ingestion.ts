/**
 * Webhook Ingestion Types
 *
 * The custom endpoint is called by external webhook providers and is
 * authenticated by the org webhook token (not an API key). The GitHub and
 * Stripe option types are kept only so existing code still compiles.
 */

import type { JsonValue } from "./common.js";

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
