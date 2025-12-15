/**
 * Webhook Ingestion Types
 *
 * These endpoints are primarily intended to be called by external webhook providers (GitHub/Stripe)
 * and are authenticated via signatures (not API keys).
 */

import type { JsonValue } from './common.js';

export interface IngestCustomWebhookParams {
  queueName: string;
  eventType?: string;
  payload: JsonValue;
  idempotencyKey?: string;
  priority?: number;
}

export interface IngestGitHubWebhookOptions {
  /** Value for X-GitHub-Event header (e.g. "pull_request") */
  githubEvent: string;
  /** Optional org-scoped webhook token (X-Webhook-Token) */
  webhookToken?: string;
  /** Optional X-Forwarded-Proto override (production servers may require https) */
  forwardedProto?: 'https' | 'http' | string;
  /** Provide a precomputed X-Hub-Signature-256 header value (sha256=<hex>) */
  signature?: string;
  /** If provided, the SDK will compute the signature for you */
  secret?: string;
}

export interface IngestStripeWebhookOptions {
  /** Optional org-scoped webhook token (X-Webhook-Token) */
  webhookToken?: string;
  /** Optional X-Forwarded-Proto override */
  forwardedProto?: 'https' | 'http' | string;
  /** Provide a precomputed Stripe-Signature header */
  signature?: string;
  /** If provided, the SDK will compute the signature for you */
  secret?: string;
  /** Timestamp (seconds) to use when computing the signature (defaults to now) */
  timestamp?: number;
}
