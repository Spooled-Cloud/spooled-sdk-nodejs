/**
 * Billing Resource
 *
 * Stripe billing integration endpoints.
 */

import type { HttpClient } from '../utils/http.js';
import type { BillingStatus, CreateBillingPortalParams, CreateBillingPortalResponse } from '../types/billing.js';

export class BillingResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get billing status for the authenticated organization.
   *
   * GET /api/v1/billing/status
   */
  async getStatus(): Promise<BillingStatus> {
    return this.http.get<BillingStatus>('/billing/status');
  }

  /**
   * Create a Stripe billing portal session.
   *
   * POST /api/v1/billing/portal
   */
  async createPortal(params: CreateBillingPortalParams): Promise<CreateBillingPortalResponse> {
    return this.http.post<CreateBillingPortalResponse>('/billing/portal', params);
  }
}
