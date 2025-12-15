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
import { SpooledGrpcClient } from './grpc/index.js';

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
  private readonly grpcHttp: HttpClient;

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

  /** gRPC (HTTP gateway) endpoints */
  readonly grpc: SpooledGrpcClient;

  /** Token refresh state */
  private refreshPromise: Promise<string> | null = null;
  private tokenExpiresAt: number | null = null;

  constructor(options: SpooledClientConfig) {
    // Resolve and validate configuration
    this.config = resolveConfig(options);
    validateConfig(this.config);

    // Create circuit breaker
    this.circuitBreaker = createCircuitBreaker(this.config.circuitBreaker);

    // Create HTTP client
    this.http = createHttpClient(this.config, this.circuitBreaker);

    // Create gRPC HTTP client (separate circuit breaker)
    const grpcCircuitBreaker = createCircuitBreaker(this.config.circuitBreaker);
    const grpcBaseUrl = this.resolveGrpcBaseUrl();
    this.grpcHttp = createHttpClient({ ...this.config, baseUrl: grpcBaseUrl }, grpcCircuitBreaker);

    // Set up token refresh if using JWT
    if (this.config.accessToken && this.config.refreshToken && this.config.autoRefreshToken) {
      this.http.setRefreshTokenFn(this.refreshAccessToken.bind(this));
    }

    // Create resource instances
    this.auth = new AuthResource(this.http);
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
    this.grpc = new SpooledGrpcClient(this.grpcHttp);

    this.config.debug?.('SpooledClient initialized', {
      baseUrl: this.config.baseUrl,
      hasApiKey: !!this.config.apiKey,
      hasAccessToken: !!this.config.accessToken,
    });
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
    // Get JWT token for WebSocket auth
    const token = await this.getJwtToken();

    return new SpooledRealtime({
      baseUrl: this.config.baseUrl,
      token,
      ...options,
      debug: this.config.debug ?? undefined,
    });
  }

  /**
   * Get or acquire a JWT token for realtime connections
   */
  private async getJwtToken(): Promise<string> {
    // If we have an access token, use it
    if (this.config.accessToken) {
      // Check if token needs refresh
      if (this.shouldRefreshToken()) {
        return this.refreshAccessToken();
      }
      return this.config.accessToken;
    }

    // If we only have an API key, we need to exchange it for a JWT
    if (this.config.apiKey) {
      const response = await this.auth.login({ apiKey: this.config.apiKey });

      // Update internal state
      this.http.setAuthToken(response.accessToken);
      this.tokenExpiresAt = Date.now() + response.expiresIn * 1000;

      // Store refresh token for future use
      (this.config as ResolvedConfig).refreshToken = response.refreshToken;

      return response.accessToken;
    }

    throw new AuthenticationError('No authentication method available for realtime connection');
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
      grpcBaseUrl: this.config.grpcBaseUrl,
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

  private resolveGrpcBaseUrl(): string {
    if (this.config.grpcBaseUrl) {
      return this.config.grpcBaseUrl;
    }
    // Derive from API base URL by using port 50051 on same host.
    const u = new URL(this.config.baseUrl);
    u.port = '50051';
    // Ensure no trailing slash
    return u.toString().replace(/\/$/, '');
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
