/**
 * Webhook Ingestion Resource
 *
 * The Spooled API ingests webhooks on one route:
 * `POST /api/v1/webhooks/{org_id}/custom`, authenticated by the org's webhook
 * token. The GitHub and Stripe routes were removed from the API.
 */

import type { HttpClient } from "../utils/http.js";
import type {
  IngestCustomWebhookParams,
  IngestCustomWebhookResponse,
  IngestGitHubWebhookOptions,
  IngestStripeWebhookOptions,
} from "../types/webhook-ingestion.js";
import { UnsupportedOperationError } from "../errors.js";

export class WebhookIngestionResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Ingest a GitHub webhook.
   *
   * @deprecated The API has no `/webhooks/{org_id}/github` route (it always
   * answered 404). This method now throws {@link UnsupportedOperationError}
   * without a network call; point the GitHub webhook at `ingest.custom` /
   * `POST /api/v1/webhooks/{org_id}/custom` instead. It will be removed in the
   * next major release.
   */
  async github(
    _orgId: string,
    _body: string | Uint8Array | ArrayBuffer,
    _options: IngestGitHubWebhookOptions,
  ): Promise<void> {
    throw new UnsupportedOperationError(
      "ingest.github",
      "the API has no GitHub webhook route; use ingest.custom (POST /webhooks/{org_id}/custom)",
    );
  }

  /**
   * Ingest a Stripe webhook.
   *
   * @deprecated The API has no `/webhooks/{org_id}/stripe` route (it always
   * answered 404). This method now throws {@link UnsupportedOperationError}
   * without a network call; point the Stripe webhook at `ingest.custom` /
   * `POST /api/v1/webhooks/{org_id}/custom` instead. It will be removed in the
   * next major release.
   */
  async stripe(
    _orgId: string,
    _body: string | Uint8Array | ArrayBuffer,
    _options: IngestStripeWebhookOptions = {},
  ): Promise<void> {
    throw new UnsupportedOperationError(
      "ingest.stripe",
      "the API has no Stripe webhook route; use ingest.custom (POST /webhooks/{org_id}/custom)",
    );
  }

  /**
   * Ingest a custom webhook.
   *
   * POST /api/v1/webhooks/{org_id}/custom returns `{ jobId, queueName, status }`.
   * An older empty 200 maps to an empty object rather than throwing.
   */
  async custom(
    orgId: string,
    params: IngestCustomWebhookParams,
    opts?: { webhookToken?: string; forwardedProto?: string },
  ): Promise<IngestCustomWebhookResponse> {
    const headers: Record<string, string> = {
      ...(opts?.webhookToken ? { "X-Webhook-Token": opts.webhookToken } : {}),
      ...(opts?.forwardedProto
        ? { "X-Forwarded-Proto": opts.forwardedProto }
        : {}),
    };

    const raw = await this.http.post<IngestCustomWebhookResponse | string>(
      `/webhooks/${orgId}/custom`,
      params,
      { headers },
    );
    if (!raw || typeof raw === "string") {
      return {};
    }
    return {
      jobId: raw.jobId,
      queueName: raw.queueName,
      status: raw.status,
    };
  }
}
