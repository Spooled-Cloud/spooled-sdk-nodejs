/**
 * Health and Metrics Types
 */

export interface HealthResponse {
  status: string;
  /** Version is omitted from unauthenticated /health responses */
  version?: string | null;
  database: boolean;
  cache: boolean;
}
