/**
 * API Key Types
 *
 * Types for API key operations.
 */

/** API key summary (without sensitive data) */
export interface ApiKeySummary {
  id: string;
  name: string;
  queues: string[];
  rateLimit?: number;
  isActive: boolean;
  createdAt: string;
  lastUsed?: string;
  expiresAt?: string;
}

/** Parameters for creating an API key */
export interface CreateApiKeyParams {
  /** Key name (1-100 chars) */
  name: string;
  /** Allowed queues (empty = all) */
  queues?: string[];
  /** Rate limit override (1-10000) */
  rateLimit?: number;
  /** Expiration date */
  expiresAt?: Date | string;
}

/** Response for creating an API key */
export interface CreateApiKeyResponse {
  id: string;
  /** The raw API key - only shown once! */
  key: string;
  name: string;
  createdAt: string;
  expiresAt?: string;
}

/** Parameters for updating an API key */
export interface UpdateApiKeyParams {
  name?: string;
  queues?: string[];
  rateLimit?: number;
  isActive?: boolean;
}
