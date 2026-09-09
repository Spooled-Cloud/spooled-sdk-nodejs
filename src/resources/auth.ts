/**
 * Auth Resource
 *
 * Handles authentication operations.
 */

import type { HttpClient } from "../utils/http.js";
import type {
  LoginParams,
  LoginResponse,
  RefreshTokenParams,
  RefreshTokenResponse,
  CurrentUserResponse,
  ValidateTokenParams,
  ValidateTokenResponse,
  StartEmailLoginResponse,
  CheckEmailResponse,
} from "../types/auth.js";

export class AuthResource {
  constructor(
    private readonly http: HttpClient,
    /** Optional accessor for the client's current refresh token (used by logout) */
    private readonly getRefreshToken?: () => string | undefined,
  ) {}

  /**
   * Exchange API key for JWT tokens
   */
  async login(params: LoginParams): Promise<LoginResponse> {
    return this.http.post<LoginResponse>("/auth/login", params);
  }

  /**
   * Refresh access token using refresh token
   */
  async refresh(params: RefreshTokenParams): Promise<RefreshTokenResponse> {
    return this.http.post<RefreshTokenResponse>("/auth/refresh", params);
  }

  /**
   * Logout and revoke the refresh token server-side.
   *
   * The backend requires the refresh token in the body to invalidate the
   * session. When omitted, the client's current refresh token (if any) is
   * used automatically.
   */
  async logout(refreshToken?: string): Promise<void> {
    const token = refreshToken ?? this.getRefreshToken?.();
    await this.http.post<void>(
      "/auth/logout",
      token ? { refreshToken: token } : undefined,
    );
  }

  /**
   * Get current user/session info
   */
  async me(): Promise<CurrentUserResponse> {
    return this.http.get<CurrentUserResponse>("/auth/me");
  }

  /**
   * Validate a token
   *
   * POST /auth/validate is `{ valid, error?, claims? }`. Claims use `org_id`
   * (camelCased `orgId`), not `organizationId`. Invalid tokens send `error`,
   * not `message`.
   */
  async validate(params: ValidateTokenParams): Promise<ValidateTokenResponse> {
    const raw = await this.http.post<RawValidateTokenResponse>(
      "/auth/validate",
      params,
    );
    return mapValidate(raw);
  }

  /**
   * Start email-based login flow (sends a 6-digit code)
   */
  async startEmailLogin(email: string): Promise<StartEmailLoginResponse> {
    return this.http.post<StartEmailLoginResponse>("/auth/email/start", {
      email,
    });
  }

  /**
   * Check whether an email is registered (GET /auth/check-email)
   */
  async checkEmail(email: string): Promise<CheckEmailResponse> {
    return this.http.get<CheckEmailResponse>("/auth/check-email", {
      params: { email },
    });
  }
}

interface RawValidateTokenResponse {
  valid: boolean;
  message?: string;
  error?: string;
  claims?: {
    organizationId?: string;
    orgId?: string;
    apiKeyId?: string;
    queues?: string[];
    exp?: number;
    iat?: number;
  };
}

function mapValidate(raw: RawValidateTokenResponse): ValidateTokenResponse {
  const claims = raw.claims;
  const organizationId = claims?.organizationId ?? claims?.orgId;
  return {
    valid: raw.valid,
    message: raw.message ?? raw.error,
    error: raw.error ?? raw.message,
    claims: claims
      ? {
          organizationId: organizationId ?? "",
          orgId: claims.orgId ?? organizationId,
          apiKeyId: claims.apiKeyId ?? "",
          queues: claims.queues ?? [],
          exp: claims.exp ?? 0,
          iat: claims.iat ?? 0,
        }
      : undefined,
  };
}
