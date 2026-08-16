/**
 * Webhook Types
 *
 * Types for outgoing webhook operations.
 */

import type {
  WebhookEventType,
  WebhookDeliveryStatus,
  JsonObject,
} from "./common.js";

/** Outgoing webhook configuration */
export interface OutgoingWebhook {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  /**
   * Consecutive failed deliveries.
   *
   * Counted once per DELIVERY, not once per retry attempt, so for the same
   * real-world failures this is roughly 5x smaller than a per-attempt count.
   * A successful delivery resets it to 0, including a successful manual retry
   * via `retryDelivery()`. At 20 the webhook is disabled automatically.
   */
  failureCount: number;
  lastTriggeredAt?: string;
  /**
   * Outcome of the most recent delivery.
   *
   * `"auto_disabled"` means 20 consecutive failed deliveries disabled the
   * webhook: `enabled` is now false and no further events are delivered until
   * it is re-enabled with `update(id, { enabled: true })`.
   */
  lastStatus?: "success" | "failed" | "auto_disabled";
  createdAt: string;
  updatedAt: string;
}

/** Parameters for creating an outgoing webhook */
export interface CreateOutgoingWebhookParams {
  /** Webhook name (1-255 chars) */
  name: string;
  /** Target URL */
  url: string;
  /** Event types to subscribe to */
  events: WebhookEventType[];
  /** Optional HMAC secret for signing */
  secret?: string;
  /** Whether enabled (default: true) */
  enabled?: boolean;
}

/**
 * Parameters for updating an outgoing webhook.
 *
 * Every field is optional and only the fields you send are changed.
 */
export interface UpdateOutgoingWebhookParams {
  name?: string;
  url?: string;
  events?: WebhookEventType[];
  /**
   * HMAC secret used to sign deliveries.
   *
   * Omit the field to keep the current secret, pass a string to replace it, or
   * pass `null` to CLEAR it. Clearing is destructive: deliveries then go out
   * unsigned, with no `X-Spooled-Signature` header, and the old secret cannot
   * be recovered. Client code that reserialises an unchanged webhook must send
   * `undefined` (or drop the key) rather than `null`, or it will wipe a live
   * secret.
   */
  secret?: string | null;
  /**
   * Whether the webhook receives events.
   *
   * Setting this to `true` is the recovery path for a webhook that was
   * auto-disabled after 20 consecutive failed deliveries. Re-enabling is
   * charged against the plan webhook cap, so it can fail with HTTP 429
   * `QUOTA_EXCEEDED` even though no webhook is being created.
   */
  enabled?: boolean;
}

/** Response for webhook test */
export interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  responseTimeMs: number;
  error?: string;
}

/**
 * Webhook delivery record.
 *
 * Delivery history is retained, not permanent: rows are removed by the
 * per-organization retention sweep using the plan's history retention window
 * (free 1 day, starter 7, pro 30, enterprise 90). Only the newest 100
 * deliveries per webhook are readable through the API in any case, so copy
 * anything you need as a durable audit record into your own store.
 */
export interface OutgoingWebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEventType;
  payload: JsonObject;
  status: WebhookDeliveryStatus;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  deliveredAt?: string;
}
