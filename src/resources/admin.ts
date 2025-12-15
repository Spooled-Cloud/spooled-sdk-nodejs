/**
 * Admin Resource
 *
 * Platform administration endpoints.
 * All endpoints require `X-Admin-Key` header.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  AdminListOrganizationsParams,
  AdminOrganizationList,
  AdminOrganizationDetail,
  AdminUpdateOrganizationParams,
  AdminCreateOrganizationParams,
  AdminCreateOrganizationResponse,
  AdminCreateApiKeyParams,
  AdminApiKeyResponse,
  AdminDeleteOrganizationParams,
  AdminPlatformStats,
  AdminPlanLimits,
} from '../types/admin.js';
import type { Organization } from '../types/organizations.js';
import { AuthenticationError } from '../errors.js';

export class AdminResource {
  constructor(
    private readonly http: HttpClient,
    private readonly adminKey: string | undefined
  ) {}

  private headers(): Record<string, string> {
    if (!this.adminKey) {
      throw new AuthenticationError('Admin key is required for admin endpoints. Provide `adminKey` in SpooledClient config.');
    }
    return { 'X-Admin-Key': this.adminKey };
  }

  /** GET /api/v1/admin/organizations */
  async listOrganizations(params?: AdminListOrganizationsParams): Promise<AdminOrganizationList> {
    const qp: Record<string, string | number | boolean | undefined> | undefined = params
      ? {
          planTier: params.planTier,
          search: params.search,
          limit: params.limit,
          offset: params.offset,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
        }
      : undefined;
    return this.http.get<AdminOrganizationList>('/admin/organizations', {
      params: qp,
      headers: this.headers(),
    });
  }

  /** POST /api/v1/admin/organizations */
  async createOrganization(params: AdminCreateOrganizationParams): Promise<AdminCreateOrganizationResponse> {
    return this.http.post<AdminCreateOrganizationResponse>('/admin/organizations', params, {
      headers: this.headers(),
    });
  }

  /** GET /api/v1/admin/organizations/{id} */
  async getOrganization(id: string): Promise<AdminOrganizationDetail> {
    return this.http.get<AdminOrganizationDetail>(`/admin/organizations/${id}`, {
      headers: this.headers(),
    });
  }

  /** PATCH /api/v1/admin/organizations/{id} */
  async updateOrganization(id: string, params: AdminUpdateOrganizationParams): Promise<Organization> {
    return this.http.patch<Organization>(`/admin/organizations/${id}`, params, {
      headers: this.headers(),
    });
  }

  /** DELETE /api/v1/admin/organizations/{id}?hard_delete=true */
  async deleteOrganization(id: string, params?: AdminDeleteOrganizationParams): Promise<void> {
    const qp: Record<string, string | number | boolean | undefined> | undefined = params
      ? { hardDelete: params.hardDelete }
      : undefined;
    await this.http.delete(`/admin/organizations/${id}`, {
      headers: this.headers(),
      params: qp,
    });
  }

  /** POST /api/v1/admin/organizations/{id}/api-keys */
  async createApiKey(orgId: string, params: AdminCreateApiKeyParams): Promise<AdminApiKeyResponse> {
    return this.http.post<AdminApiKeyResponse>(`/admin/organizations/${orgId}/api-keys`, params, {
      headers: this.headers(),
    });
  }

  /** POST /api/v1/admin/organizations/{id}/reset-usage */
  async resetUsage(orgId: string): Promise<void> {
    await this.http.post<void>(`/admin/organizations/${orgId}/reset-usage`, undefined, {
      headers: this.headers(),
    });
  }

  /** GET /api/v1/admin/stats */
  async getStats(): Promise<AdminPlatformStats> {
    return this.http.get<AdminPlatformStats>('/admin/stats', {
      headers: this.headers(),
    });
  }

  /** GET /api/v1/admin/plans */
  async listPlans(): Promise<AdminPlanLimits[]> {
    return this.http.get<AdminPlanLimits[]>('/admin/plans', {
      headers: this.headers(),
    });
  }
}
