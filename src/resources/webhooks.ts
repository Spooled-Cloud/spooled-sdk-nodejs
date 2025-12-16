/**
 * Webhooks Resource
 *
 * Handles outgoing webhook operations.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  OutgoingWebhook,
  CreateOutgoingWebhookParams,
  UpdateOutgoingWebhookParams,
  TestWebhookResponse,
  OutgoingWebhookDelivery,
} from '../types/webhooks.js';

export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all outgoing webhooks
   */
  async list(): Promise<OutgoingWebhook[]> {
    return this.http.get<OutgoingWebhook[]>('/outgoing-webhooks');
  }

  /**
   * Create a new outgoing webhook
   */
  async create(params: CreateOutgoingWebhookParams): Promise<OutgoingWebhook> {
    return this.http.post<OutgoingWebhook>('/outgoing-webhooks', params);
  }

  /**
   * Get an outgoing webhook by ID
   */
  async get(id: string): Promise<OutgoingWebhook> {
    return this.http.get<OutgoingWebhook>(`/outgoing-webhooks/${id}`);
  }

  /**
   * Update an outgoing webhook
   */
  async update(id: string, params: UpdateOutgoingWebhookParams): Promise<OutgoingWebhook> {
    return this.http.put<OutgoingWebhook>(`/outgoing-webhooks/${id}`, params);
  }

  /**
   * Delete an outgoing webhook
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/outgoing-webhooks/${id}`);
  }

  /**
   * Test an outgoing webhook
   */
  async test(id: string): Promise<TestWebhookResponse> {
    return this.http.post<TestWebhookResponse>(`/outgoing-webhooks/${id}/test`);
  }

  /**
   * Get webhook delivery history
   */
  async getDeliveries(id: string): Promise<OutgoingWebhookDelivery[]> {
    return this.http.get<OutgoingWebhookDelivery[]>(`/outgoing-webhooks/${id}/deliveries`);
  }

  /**
   * Retry a specific webhook delivery
   */
  async retryDelivery(webhookId: string, deliveryId: string): Promise<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `/outgoing-webhooks/${webhookId}/retry/${deliveryId}`
    );
  }
}
