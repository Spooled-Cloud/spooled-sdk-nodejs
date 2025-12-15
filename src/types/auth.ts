/**
 * Auth Types
 *
 * Types for authentication operations.
 */

/** Login request parameters */
export interface LoginParams {
  /** API key to exchange for JWT tokens */
  apiKey: string;
}

/** Login response */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}

/** Token refresh parameters */
export interface RefreshTokenParams {
  refreshToken: string;
}

/** Token refresh response */
export interface RefreshTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** Current user info response */
export interface CurrentUserResponse {
  organizationId: string;
  apiKeyId: string;
  queues: string[];
  issuedAt: string;
  expiresAt: string;
}

/** Token validation parameters */
export interface ValidateTokenParams {
  token: string;
}

/** Token validation response */
export interface ValidateTokenResponse {
  valid: boolean;
  message?: string;
  claims?: {
    organizationId: string;
    apiKeyId: string;
    queues: string[];
    exp: number;
    iat: number;
  };
}
