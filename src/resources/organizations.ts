/**
 * Organizations Resource
 *
 * Handles organization operations including webhook token management.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  Organization,
  OrganizationSummary,
  CreateOrganizationParams,
  CreateOrganizationResponse,
  UpdateOrganizationParams,
  OrganizationUsage,
  OrganizationMember,
  CheckSlugResponse,
  WebhookTokenResponse,
} from '../types/organizations.js';

export class OrganizationsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new organization (public endpoint, no auth required)
   */
  async create(params: CreateOrganizationParams): Promise<CreateOrganizationResponse> {
    return this.http.post<CreateOrganizationResponse>('/organizations', params);
  }

  /**
   * List organizations
   */
  async list(): Promise<OrganizationSummary[]> {
    return this.http.get<OrganizationSummary[]>('/organizations');
  }

  /**
   * Get an organization by ID
   */
  async get(id: string): Promise<Organization> {
    return this.http.get<Organization>(`/organizations/${id}`);
  }

  /**
   * Update an organization
   */
  async update(id: string, params: UpdateOrganizationParams): Promise<Organization> {
    return this.http.put<Organization>(`/organizations/${id}`, params);
  }

  /**
   * Delete an organization
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/organizations/${id}`);
  }

  /**
   * Get organization usage and limits
   */
  async getUsage(): Promise<OrganizationUsage> {
    return this.http.get<OrganizationUsage>('/organizations/usage');
  }

  /**
   * Get organization members
   */
  async getMembers(id: string): Promise<OrganizationMember[]> {
    return this.http.get<OrganizationMember[]>(`/organizations/${id}/members`);
  }

  /**
   * Check slug availability
   */
  async checkSlug(slug: string): Promise<CheckSlugResponse> {
    return this.http.get<CheckSlugResponse>('/organizations/check-slug', {
      params: { slug },
    });
  }

  /**
   * Generate a unique slug from an organization name
   */
  async generateSlug(name: string): Promise<{ slug: string }> {
    return this.http.post<{ slug: string }>('/organizations/generate-slug', { name });
  }

  /**
   * Get the webhook token for the current organization.
   *
   * This token is used to verify incoming webhook payloads from Spooled.
   * Use this token to validate webhook signatures.
   *
   * @example
   * ```typescript
   * const { token } = await client.organizations.getWebhookToken();
   * console.log('Webhook token:', token);
   * ```
   */
  async getWebhookToken(): Promise<WebhookTokenResponse> {
    return this.http.get<WebhookTokenResponse>('/organizations/webhook-token');
  }

  /**
   * Regenerate the webhook token for the current organization.
   *
   * This invalidates the old token immediately. All webhook signature
   * verification using the old token will fail after regeneration.
   *
   * @example
   * ```typescript
   * const { token: newToken } = await client.organizations.regenerateWebhookToken();
   * console.log('New webhook token:', newToken);
   * ```
   */
  async regenerateWebhookToken(): Promise<WebhookTokenResponse> {
    return this.http.post<WebhookTokenResponse>('/organizations/webhook-token/regenerate');
  }

  /**
   * Clear/delete the webhook token for the current organization.
   *
   * After this, webhook signature verification will fail until a new
   * token is generated via regenerateWebhookToken().
   *
   * @example
   * ```typescript
   * await client.organizations.clearWebhookToken();
   * ```
   */
  async clearWebhookToken(): Promise<void> {
    await this.http.post('/organizations/webhook-token/clear');
  }
}
