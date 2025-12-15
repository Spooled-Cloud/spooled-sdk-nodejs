/**
 * Metrics Resource
 */

import type { HttpClient } from '../utils/http.js';

export class MetricsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Prometheus metrics (public; may be protected by METRICS_TOKEN on the server).
   *
   * GET /metrics
   */
  async get(): Promise<string> {
    return this.http.get<string>('/metrics', {
      skipApiPrefix: true,
      // Ensure we get the raw text response.
      headers: { Accept: 'text/plain' },
    });
  }
}
