/**
 * Spooled Client
 *
 * Main entry point for the Spooled SDK.
 */

import {
  type SpooledClientConfig,
  type ResolvedConfig,
  resolveConfig,
  validateConfig,
} from './config.js';
import { AuthenticationError } from './errors.js';
import { HttpClient, createHttpClient } from './utils/http.js';
import { CircuitBreaker, createCircuitBreaker } from './utils/circuit-breaker.js';
import {
  AuthResource,
  JobsResource,
  QueuesResource,
  WorkersResource,
  SchedulesResource,
  WorkflowsResource,
  WebhooksResource,
  ApiKeysResource,
  OrganizationsResource,
  BillingResource,
  DashboardResource,
  HealthResource,
  MetricsResource,
  AdminResource,
  WebhookIngestionResource,
} from './resources/index.js';
import { SpooledRealtime } from './realtime/index.js';
import type { SpooledRealtimeOptions } from './realtime/index.js';
import { SpooledGrpcClient } from './grpc/client.js';

/**
 * Spooled Cloud SDK Client
 *
 * @example
 * ```typescript
 * const client = new SpooledClient({
 *   apiKey: 'sk_live_...'
 * });
 *
 * // Create a job
 * const result = await client.jobs.create({
 *   queueName: 'my-queue',
 *   payload: { message: 'Hello, World!' }
 * });
 *
 * // List queues
 * const queues = await client.queues.list();
 * ```
 */
export class SpooledClient {
  private readonly config: ResolvedConfig;
  private readonly http: HttpClient;
  private readonly circuitBreaker: CircuitBreaker;
  private _grpc: SpooledGrpcClient | null = null;

  /** Authentication operations */
  readonly auth: AuthResource;

  /** Job operations */
  readonly jobs: JobsResource;

  /** Queue operations */
  readonly queues: QueuesResource;

  /** Worker operations */
  readonly workers: WorkersResource;

  /** Schedule operations */
  readonly schedules: SchedulesResource;

  /** Workflow operations */
  readonly workflows: WorkflowsResource;

  /** Outgoing webhook operations */
  readonly webhooks: WebhooksResource;

  /** API key operations */
  readonly apiKeys: ApiKeysResource;

  /** Organization operations */
  readonly organizations: OrganizationsResource;

  /** Billing operations */
  readonly billing: BillingResource;

  /** Dashboard operations */
  readonly dashboard: DashboardResource;

  /** Health endpoints (public) */
  readonly health: HealthResource;

  /** Metrics endpoint (public) */
  readonly metrics: MetricsResource;

  /** Admin endpoints (requires adminKey) */
  readonly admin: AdminResource;

  /** Webhook ingestion endpoints (signature-based) */
  readonly ingest: WebhookIngestionResource;

  /** Token refresh state */
  private refreshPromise: Promise<string> | null = null;
  private tokenExpiresAt: number | null = null;

  /**
   * Cached JWT for realtime connections (API-key auth path).
   *
   * The realtime layer requests a token on every (re)connect. Minting a brand
   * new JWT via POST /auth/login each time trips the login rate limit (429)
   * under a reconnect storm, after which realtime can never recover. We cache
   * the token here — at the client level, shared across reconnects — and reuse
   * it until it nears expiry.
   */
  private cachedJwt: string | null = null;
  /** Deduplicates concurrent logins (e.g. WS + SSE reconnecting together). */
  private jwtLoginPromise: Promise<string> | null = null;

  constructor(options: SpooledClientConfig) {
    // Resolve and validate configuration
    this.config = resolveConfig(options);
    validateConfig(this.config);

    // Create circuit breaker
    this.circuitBreaker = createCircuitBreaker(this.config.circuitBreaker);

    // Create HTTP client
    this.http = createHttpClient(this.config, this.circuitBreaker);

    // Set up token refresh if using JWT
    if (this.config.accessToken && this.config.refreshToken && this.config.autoRefreshToken) {
      this.http.setRefreshTokenFn(this.refreshAccessToken.bind(this));
    }

    // Create resource instances
    this.auth = new AuthResource(this.http, () => this.config.refreshToken);
    this.jobs = new JobsResource(this.http);
    this.queues = new QueuesResource(this.http);
    this.workers = new WorkersResource(this.http);
    this.schedules = new SchedulesResource(this.http);
    this.workflows = new WorkflowsResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.apiKeys = new ApiKeysResource(this.http);
    this.organizations = new OrganizationsResource(this.http);
    this.billing = new BillingResource(this.http);
    this.dashboard = new DashboardResource(this.http);
    this.health = new HealthResource(this.http);
    this.metrics = new MetricsResource(this.http);
    this.admin = new AdminResource(this.http, this.config.adminKey);
    this.ingest = new WebhookIngestionResource(this.http);

    this.config.debug?.('SpooledClient initialized', {
      baseUrl: this.config.baseUrl,
      hasApiKey: !!this.config.apiKey,
      hasAccessToken: !!this.config.accessToken,
    });
  }

  /**
   * Real gRPC client for high-performance operations (HTTP/2 + Protobuf)
   *
   * The gRPC client is created lazily on first access to avoid
   * loading the proto file unless it's actually needed.
   *
   * @example
   * ```typescript
   * // Enqueue via gRPC
   * const { jobId } = await client.grpc.queue.enqueue({
   *   queueName: 'my-queue',
   *   payload: { message: 'Hello!' },
   * });
   *
   * // Stream jobs
   * for await (const job of client.grpc.queue.streamJobs({
   *   queueName: 'my-queue',
   *   workerId: 'worker-1',
   * })) {
   *   console.log('Job:', job);
   * }
   * ```
   */
  get grpc(): SpooledGrpcClient {
    if (!this._grpc) {
      const grpcAddress = this.resolveGrpcAddress();
      const apiKey = this.config.apiKey;

      if (!apiKey) {
        throw new AuthenticationError('gRPC client requires an API key');
      }

      this._grpc = new SpooledGrpcClient({
        address: grpcAddress,
        apiKey,
      });
    }
    return this._grpc;
  }

  /**
   * Create a realtime connection for WebSocket or SSE events
   *
   * @example
   * ```typescript
   * const realtime = await client.realtime();
   *
   * realtime.on('job.created', (event) => {
   *   console.log('New job:', event.jobId);
   * });
   *
   * await realtime.connect();
   * await realtime.subscribe({ queueName: 'my-queue' });
   * ```
   */
  async realtime(options?: SpooledRealtimeOptions): Promise<SpooledRealtime> {
    // Get an initial JWT (fails fast on auth errors at call time).
    const token = await this.getJwtToken();

    return new SpooledRealtime({
      baseUrl: this.config.baseUrl,
      wsUrl: this.config.wsUrl,
      token,
      // Provider the realtime layer calls on every (re)connect. It returns a
      // cached JWT and only re-logs-in when the token is absent, near expiry,
      // or the transport asks to force a refresh (e.g. after a 401 upgrade).
      tokenProvider: (forceRefresh) => this.getJwtToken(forceRefresh),
      ...options,
      // Only forward debug when the client actually has a logger, so we never
      // hand the realtime layer an explicit `debug: undefined`. The WS/SSE
      // constructors also guard against this, but keeping the undefined out of
      // the option object makes the intent clear at the call site.
      ...(this.config.debug ? { debug: this.config.debug } : {}),
    });
  }

  /**
   * Get or acquire a JWT token for realtime connections.
   *
   * The realtime layer calls this on every (re)connect. We cache the JWT and
   * reuse it until it nears expiry so a reconnect storm doesn't hammer
   * /auth/login and trip its rate limit. A fresh login happens only when the
   * cached token is absent, within ~60s of its `exp`, or a refresh is forced.
   *
   * @param forceRefresh Bypass the cache and mint a new token. Set by the
   *   transport when the server rejected the current token (e.g. a 401 on the
   *   WebSocket upgrade), so a stale/revoked token is replaced without waiting
   *   for it to expire.
   */
  private async getJwtToken(forceRefresh = false): Promise<string> {
    // A JWT access token supplied directly: reuse it, refreshing via the
    // refresh token when it nears expiry (or when a refresh is forced).
    if (this.config.accessToken) {
      if (forceRefresh || this.shouldRefreshToken()) {
        return this.refreshAccessToken();
      }
      return this.config.accessToken;
    }

    // API-key auth: exchange the key for a JWT once, then reuse the cached JWT
    // across (re)connects until it nears expiry. Only then log in again.
    if (this.config.apiKey) {
      if (forceRefresh) {
        this.cachedJwt = null;
      }
      if (this.cachedJwt && !isJwtNearExpiry(this.cachedJwt)) {
        return this.cachedJwt;
      }
      return this.loginForJwt();
    }

    throw new AuthenticationError('No authentication method available for realtime connection');
  }

  /**
   * Exchange the API key for a JWT via /auth/login and cache the result.
   *
   * Concurrent callers share a single in-flight login so a burst of reconnects
   * (e.g. WebSocket and SSE at once) issues just one request.
   */
  private async loginForJwt(): Promise<string> {
    if (this.jwtLoginPromise) {
      return this.jwtLoginPromise;
    }

    this.jwtLoginPromise = (async () => {
      const response = await this.auth.login({ apiKey: this.config.apiKey! });

      // Update internal state and cache the token for future (re)connects.
      this.http.setAuthToken(response.accessToken);
      this.tokenExpiresAt = Date.now() + response.expiresIn * 1000;
      (this.config as ResolvedConfig).refreshToken = response.refreshToken;
      this.cachedJwt = response.accessToken;

      return response.accessToken;
    })();

    try {
      return await this.jwtLoginPromise;
    } finally {
      this.jwtLoginPromise = null;
    }
  }

  /**
   * Check if token should be refreshed
   */
  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiresAt) {
      return false;
    }
    // Refresh 5 minutes before expiry
    const bufferMs = 5 * 60 * 1000;
    return Date.now() >= this.tokenExpiresAt - bufferMs;
  }

  /**
   * Refresh the access token
   */
  private async refreshAccessToken(): Promise<string> {
    // Deduplicate concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.config.refreshToken) {
      throw new AuthenticationError('No refresh token available');
    }

    this.refreshPromise = this.doRefreshToken();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Actually perform the token refresh
   */
  private async doRefreshToken(): Promise<string> {
    const response = await this.auth.refresh({
      refreshToken: this.config.refreshToken!,
    });

    // Update state
    this.http.setAuthToken(response.accessToken);
    this.tokenExpiresAt = Date.now() + response.expiresIn * 1000;
    (this.config as ResolvedConfig).accessToken = response.accessToken;

    this.config.debug?.('Token refreshed successfully');

    return response.accessToken;
  }

  /**
   * Get current configuration (read-only)
   */
  getConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Reset the circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Create a new client with different options
   */
  withOptions(options: Partial<SpooledClientConfig>): SpooledClient {
    return new SpooledClient({
      apiKey: this.config.apiKey,
      accessToken: this.config.accessToken,
      refreshToken: this.config.refreshToken,
      adminKey: this.config.adminKey,
      grpcAddress: this.config.grpcAddress,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
      retry: this.config.retry,
      circuitBreaker: this.config.circuitBreaker,
      headers: this.config.headers,
      fetch: this.config.fetch,
      userAgent: this.config.userAgent,
      debug: this.config.debug ?? undefined,
      autoRefreshToken: this.config.autoRefreshToken,
      ...options,
    });
  }

  /**
   * Resolve gRPC address (host:port format)
   */
  private resolveGrpcAddress(): string {
    return this.config.grpcAddress;
    }

  /**
   * Close all connections including gRPC
   */
  close(): void {
    if (this._grpc) {
      this._grpc.close();
      this._grpc = null;
    }
  }
}

/**
 * Create a new SpooledClient instance
 *
 * @example
 * ```typescript
 * const client = createClient({
 *   apiKey: process.env.SPOOLED_API_KEY
 * });
 * ```
 */
export function createClient(options: SpooledClientConfig): SpooledClient {
  return new SpooledClient(options);
}

/**
 * Decode a JWT's `exp` claim (seconds since epoch) without verifying the
 * signature — we only need the expiry to decide when to refresh, not to trust
 * the token. Returns null for a malformed token or one with no numeric `exp`.
 */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when a token is missing an `exp` we can read or is within `skewMs` of it.
 * A token whose expiry can't be decoded is treated as expiring, so we fall back
 * to a fresh login rather than reuse a token we can't reason about.
 */
export function isJwtNearExpiry(token: string, skewMs = 60_000): boolean {
  const exp = decodeJwtExp(token);
  if (exp === null) {
    return true;
  }
  return Date.now() >= exp * 1000 - skewMs;
}

/** Base64url-decode a JWT segment to a UTF-8 string, across Node and browsers. */
function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  // Prefer Node's Buffer; fall back to atob for browsers / non-Node runtimes.
  // Referenced via globalThis so neither global is a hard dependency.
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(b64, 'base64').toString('utf8');
  }
  const binary = globalThis.atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new globalThis.TextDecoder().decode(bytes);
}
