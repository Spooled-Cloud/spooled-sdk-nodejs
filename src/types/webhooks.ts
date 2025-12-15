/**
 * Webhook Types
 *
 * Types for outgoing webhook operations.
 */

import type { WebhookEventType, WebhookDeliveryStatus, JsonObject } from './common.js';

/** Outgoing webhook configuration */
export interface OutgoingWebhook {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  failureCount: number;
  lastTriggeredAt?: string;
  lastStatus?: 'success' | 'failed';
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

/** Parameters for updating an outgoing webhook */
export interface UpdateOutgoingWebhookParams {
  name?: string;
  url?: string;
  events?: WebhookEventType[];
  secret?: string;
  enabled?: boolean;
}

/** Response for webhook test */
export interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  responseTimeMs: number;
  error?: string;
}

/** Webhook delivery record */
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
