/**
 * Webhook Ingestion Resource
 *
 * These endpoints are intended for webhook providers (GitHub/Stripe/custom) to enqueue jobs.
 * They are authenticated via signatures (not API keys).
 */

import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { HttpClient } from '../utils/http.js';
import type {
  IngestCustomWebhookParams,
  IngestGitHubWebhookOptions,
  IngestStripeWebhookOptions,
} from '../types/webhook-ingestion.js';
import { ValidationError } from '../errors.js';

function toBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  return new Uint8Array(body);
}

function githubSignature(secret: string, body: Uint8Array): string {
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

function stripeSignature(secret: string, body: Uint8Array, timestamp: number): string {
  // Stripe signs: `${timestamp}.${rawBodyUtf8}`
  const payload = `${timestamp}.${Buffer.from(body).toString('utf8')}`;
  const hex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

export class WebhookIngestionResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Ingest a GitHub webhook.
   *
   * POST /api/v1/webhooks/{org_id}/github
   */
  async github(orgId: string, body: string | Uint8Array | ArrayBuffer, options: IngestGitHubWebhookOptions): Promise<void> {
    const bytes = toBytes(body);

    const signature = options.signature ?? (options.secret ? githubSignature(options.secret, bytes) : undefined);
    if (!signature) {
      throw new ValidationError('GitHub webhook signature is required (provide `signature` or `secret`)');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-GitHub-Event': options.githubEvent,
      'X-Hub-Signature-256': signature,
    };

    if (options.webhookToken) {
      headers['X-Webhook-Token'] = options.webhookToken;
    }
    if (options.forwardedProto) {
      headers['X-Forwarded-Proto'] = options.forwardedProto;
    }

    await this.http.request<void>(`/webhooks/${orgId}/github`, {
      method: 'POST',
      rawBody: bytes,
      headers,
      skipRequestConversion: true,
      skipResponseConversion: true,
    });
  }

  /**
   * Ingest a Stripe webhook.
   *
   * POST /api/v1/webhooks/{org_id}/stripe
   */
  async stripe(orgId: string, body: string | Uint8Array | ArrayBuffer, options: IngestStripeWebhookOptions = {}): Promise<void> {
    const bytes = toBytes(body);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);

    const signature = options.signature ?? (options.secret ? stripeSignature(options.secret, bytes, timestamp) : undefined);
    if (!signature) {
      throw new ValidationError('Stripe webhook signature is required (provide `signature` or `secret`)');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    };

    if (options.webhookToken) {
      headers['X-Webhook-Token'] = options.webhookToken;
    }
    if (options.forwardedProto) {
      headers['X-Forwarded-Proto'] = options.forwardedProto;
    }

    await this.http.request<void>(`/webhooks/${orgId}/stripe`, {
      method: 'POST',
      rawBody: bytes,
      headers,
      skipRequestConversion: true,
      skipResponseConversion: true,
    });
  }

  /**
   * Ingest a custom webhook.
   *
   * POST /api/v1/webhooks/{org_id}/custom
   */
  async custom(orgId: string, params: IngestCustomWebhookParams, opts?: { webhookToken?: string; forwardedProto?: string }): Promise<void> {
    const headers: Record<string, string> = {
      ...(opts?.webhookToken ? { 'X-Webhook-Token': opts.webhookToken } : {}),
      ...(opts?.forwardedProto ? { 'X-Forwarded-Proto': opts.forwardedProto } : {}),
    };

    await this.http.post<void>(`/webhooks/${orgId}/custom`, params, {
      headers,
    });
  }
}
