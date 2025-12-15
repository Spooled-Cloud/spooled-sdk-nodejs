/**
 * Organizations Resource
 *
 * Handles organization operations.
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
}
