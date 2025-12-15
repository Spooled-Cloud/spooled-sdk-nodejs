/**
 * Auth Resource
 *
 * Handles authentication operations.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  LoginParams,
  LoginResponse,
  RefreshTokenParams,
  RefreshTokenResponse,
  CurrentUserResponse,
  ValidateTokenParams,
  ValidateTokenResponse,
} from '../types/auth.js';

export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Exchange API key for JWT tokens
   */
  async login(params: LoginParams): Promise<LoginResponse> {
    return this.http.post<LoginResponse>('/auth/login', params);
  }

  /**
   * Refresh access token using refresh token
   */
  async refresh(params: RefreshTokenParams): Promise<RefreshTokenResponse> {
    return this.http.post<RefreshTokenResponse>('/auth/refresh', params);
  }

  /**
   * Logout and invalidate current token
   */
  async logout(): Promise<void> {
    await this.http.post<void>('/auth/logout');
  }

  /**
   * Get current user/session info
   */
  async me(): Promise<CurrentUserResponse> {
    return this.http.get<CurrentUserResponse>('/auth/me');
  }

  /**
   * Validate a token
   */
  async validate(params: ValidateTokenParams): Promise<ValidateTokenResponse> {
    return this.http.post<ValidateTokenResponse>('/auth/validate', params);
  }
}
