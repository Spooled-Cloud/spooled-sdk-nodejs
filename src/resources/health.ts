/**
 * Health Resource
 */

import type { HttpClient } from '../utils/http.js';
import type { HealthResponse } from '../types/health.js';

export class HealthResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Basic health check (public).
   *
   * GET /health
   */
  async get(): Promise<HealthResponse> {
    return this.http.get<HealthResponse>('/health', { skipApiPrefix: true });
  }

  /**
   * Kubernetes liveness probe (public).
   *
   * GET /health/live
   */
  async liveness(): Promise<boolean> {
    try {
      await this.http.request<string>('/health/live', {
        method: 'GET',
        skipApiPrefix: true,
        skipRetry: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kubernetes readiness probe (public).
   *
   * GET /health/ready
   */
  async readiness(): Promise<boolean> {
    try {
      await this.http.request<string>('/health/ready', {
        method: 'GET',
        skipApiPrefix: true,
        skipRetry: true,
      });
      return true;
    } catch {
      return false;
    }
  }
}
