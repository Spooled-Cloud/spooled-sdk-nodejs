/**
 * SDK Configuration
 *
 * Defines configuration types and defaults for the Spooled SDK.
 */

/** Retry configuration options */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelay: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelay: number;
  /** Exponential backoff factor (default: 2) */
  factor: number;
  /** Whether to add jitter to delays (default: true) */
  jitter: boolean;
  /** Custom function to determine if an error is retryable */
  retryOn?: (error: Error, attempt: number) => boolean;
}

/** Circuit breaker configuration options */
export interface CircuitBreakerConfig {
  /** Whether circuit breaker is enabled (default: true) */
  enabled: boolean;
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Number of successes in half-open state to close circuit (default: 3) */
  successThreshold: number;
  /** Time in milliseconds to wait before trying again after opening (default: 30000) */
  timeout: number;
}

/** Debug logging function type */
export type DebugFn = (message: string, meta?: unknown) => void;

/** Main SDK configuration options */
export interface SpooledClientConfig {
  /** API key for authentication (starts with sk_live_ or sk_test_) */
  apiKey?: string;
  /** JWT access token (alternative to API key) */
  accessToken?: string;
  /** JWT refresh token for automatic token renewal */
  refreshToken?: string;
  /** Admin API key (for /api/v1/admin/* endpoints; uses X-Admin-Key header) */
  adminKey?: string;
  /** gRPC server address (default: grpc.spooled.cloud:443) */
  grpcAddress?: string;
  /** Base URL for the API (default: https://api.spooled.cloud) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts (shorthand for retry.maxRetries) */
  retries?: number;
  /** Base retry delay in milliseconds (shorthand for retry.baseDelay) */
  retryDelay?: number;
  /** Full retry configuration */
  retry?: Partial<RetryConfig>;
  /** Circuit breaker configuration */
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  /** Additional headers to include in all requests */
  headers?: Record<string, string>;
  /** Custom fetch implementation (for testing or special runtimes) */
  fetch?: typeof fetch;
  /** Custom user agent string */
  userAgent?: string;
  /** Enable debug logging */
  debug?: boolean | DebugFn;
  /** Whether to automatically refresh tokens when they expire (default: true) */
  autoRefreshToken?: boolean;
}

/** Resolved configuration with all defaults applied */
export interface ResolvedConfig {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  adminKey?: string;
  grpcAddress: string;
  baseUrl: string;
  timeout: number;
  retry: RetryConfig;
  circuitBreaker: CircuitBreakerConfig;
  headers: Record<string, string>;
  fetch: typeof fetch;
  userAgent: string;
  debug: DebugFn | null;
  autoRefreshToken: boolean;
}

/** Default configuration values */
export const DEFAULT_CONFIG = {
  baseUrl: 'https://api.spooled.cloud',
  grpcAddress: 'grpc.spooled.cloud:443',
  timeout: 30000,
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    jitter: true,
  } satisfies RetryConfig,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 30000,
  } satisfies CircuitBreakerConfig,
  userAgent: '@spooled/sdk-nodejs/1.0.6',
  autoRefreshToken: true,
} as const;

/** SDK version */
export const SDK_VERSION = '1.0.6';

/** API version prefix */
export const API_VERSION = 'v1';

/** API base path */
export const API_BASE_PATH = `/api/${API_VERSION}`;

/**
 * Resolve configuration by merging user options with defaults
 */
export function resolveConfig(options: SpooledClientConfig): ResolvedConfig {
  // Create debug function
  let debugFn: DebugFn | null = null;
  if (options.debug === true) {
    debugFn = (message: string, meta?: unknown) => {
      // eslint-disable-next-line no-console
      console.log(`[spooled-sdk] ${message}`, meta !== undefined ? meta : '');
    };
  } else if (typeof options.debug === 'function') {
    debugFn = options.debug;
  }

  // Merge retry config
  const retry: RetryConfig = {
    ...DEFAULT_CONFIG.retry,
    ...options.retry,
    // Allow shorthand overrides
    ...(options.retries !== undefined && { maxRetries: options.retries }),
    ...(options.retryDelay !== undefined && { baseDelay: options.retryDelay }),
  };

  // Merge circuit breaker config
  const circuitBreaker: CircuitBreakerConfig = {
    ...DEFAULT_CONFIG.circuitBreaker,
    ...options.circuitBreaker,
  };

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };

  return {
    apiKey: options.apiKey,
    accessToken: options.accessToken,
    refreshToken: options.refreshToken,
    adminKey: options.adminKey,
    grpcAddress: options.grpcAddress ?? DEFAULT_CONFIG.grpcAddress,
    baseUrl: options.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    timeout: options.timeout ?? DEFAULT_CONFIG.timeout,
    retry,
    circuitBreaker,
    headers,
    fetch: options.fetch ?? globalThis.fetch,
    userAgent: options.userAgent ?? DEFAULT_CONFIG.userAgent,
    debug: debugFn,
    autoRefreshToken: options.autoRefreshToken ?? DEFAULT_CONFIG.autoRefreshToken,
  };
}

/**
 * Validate configuration options
 * @throws Error if configuration is invalid
 */
export function validateConfig(config: ResolvedConfig): void {
  // Must have at least one auth method
  if (!config.apiKey && !config.accessToken) {
    throw new Error(
      'SpooledClient requires either apiKey or accessToken for authentication'
    );
  }

  // Validate API key format if provided
  if (config.apiKey && !config.apiKey.startsWith('sk_')) {
    throw new Error(
      'Invalid API key format. API keys should start with sk_live_ or sk_test_'
    );
  }

  // Validate baseUrl
  if (!config.baseUrl.startsWith('http://') && !config.baseUrl.startsWith('https://')) {
    throw new Error('baseUrl must start with http:// or https://');
  }

  // Validate timeout
  if (config.timeout <= 0) {
    throw new Error('timeout must be a positive number');
  }

  // Validate retry config
  if (config.retry.maxRetries < 0) {
    throw new Error('retry.maxRetries must be non-negative');
  }
  if (config.retry.baseDelay <= 0) {
    throw new Error('retry.baseDelay must be positive');
  }
  if (config.retry.maxDelay < config.retry.baseDelay) {
    throw new Error('retry.maxDelay must be >= retry.baseDelay');
  }
  if (config.retry.factor < 1) {
    throw new Error('retry.factor must be >= 1');
  }

  // Validate circuit breaker config
  if (config.circuitBreaker.enabled) {
    if (config.circuitBreaker.failureThreshold <= 0) {
      throw new Error('circuitBreaker.failureThreshold must be positive');
    }
    if (config.circuitBreaker.successThreshold <= 0) {
      throw new Error('circuitBreaker.successThreshold must be positive');
    }
    if (config.circuitBreaker.timeout <= 0) {
      throw new Error('circuitBreaker.timeout must be positive');
    }
  }
}
