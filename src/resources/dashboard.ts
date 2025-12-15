/**
 * Dashboard Resource
 *
 * Provides aggregated dashboard data (used by the Spooled dashboard UI).
 */

import type { HttpClient } from '../utils/http.js';
import type { DashboardData } from '../types/dashboard.js';

export class DashboardResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get dashboard data for the current organization.
   *
   * GET /api/v1/dashboard
   */
  async get(): Promise<DashboardData> {
    return this.http.get<DashboardData>('/dashboard');
  }
}
