/**
 * API Keys Resource
 *
 * Handles API key operations.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  ApiKeySummary,
  CreateApiKeyParams,
  CreateApiKeyResponse,
  UpdateApiKeyParams,
} from '../types/api-keys.js';

export class ApiKeysResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all API keys (without sensitive data)
   */
  async list(): Promise<ApiKeySummary[]> {
    return this.http.get<ApiKeySummary[]>('/api-keys');
  }

  /**
   * Create a new API key
   */
  async create(params: CreateApiKeyParams): Promise<CreateApiKeyResponse> {
    return this.http.post<CreateApiKeyResponse>('/api-keys', params);
  }

  /**
   * Get an API key by ID (without sensitive data)
   */
  async get(id: string): Promise<ApiKeySummary> {
    return this.http.get<ApiKeySummary>(`/api-keys/${id}`);
  }

  /**
   * Update an API key
   */
  async update(id: string, params: UpdateApiKeyParams): Promise<ApiKeySummary> {
    return this.http.put<ApiKeySummary>(`/api-keys/${id}`, params);
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string): Promise<void> {
    await this.http.delete(`/api-keys/${id}`);
  }
}
