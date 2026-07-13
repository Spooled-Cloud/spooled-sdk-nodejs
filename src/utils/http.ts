/**
 * HTTP Client Utility
 *
 * Provides a fetch wrapper with:
 * - URL building and query string encoding
 * - JSON request/response handling
 * - Timeout support via AbortController
 * - Automatic retry with exponential backoff
 * - Circuit breaker protection
 * - Case conversion (camelCase <-> snake_case)
 */

import type { ResolvedConfig, DebugFn } from '../config.js';
import { API_BASE_PATH } from '../config.js';
import type { RetryConfig } from '../config.js';
import {
  createErrorFromResponse,
  NetworkError,
  RateLimitError,
  TimeoutError,
  SpooledError,
} from '../errors.js';
import { convertRequest, convertResponse, convertQueryParams } from './casing.js';
import { withRetry } from './retry.js';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * HTTP methods considered idempotent per HTTP semantics.
 * Automatic retry on ambiguous failures (network/timeout/5xx) is only safe
 * for these; non-idempotent methods (POST/PATCH) may cause duplicate side
 * effects if retried after the request already reached the server.
 */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'PUT', 'DELETE']);

/** HTTP methods */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Query parameters type */
export type QueryParams = Record<string, string | number | boolean | undefined>;

/** Request options for HTTP client */
export interface HttpRequestOptions {
  /** HTTP method (default: GET) */
  method?: HttpMethod;
  /** Request body (will be JSON stringified) */
  body?: unknown;
  /**
   * Raw request body (sent as-is, not JSON stringified).
   * Use this for endpoints that require an exact byte payload (e.g. webhook signature verification).
   */
  rawBody?: string | Uint8Array | ArrayBuffer;
  /** Query parameters */
  params?: QueryParams;
  /**
   * Skip automatically prefixing the path with `/api/v1`.
   * Use this for top-level endpoints like `/health` or `/metrics`.
   */
  skipApiPrefix?: boolean;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (overrides client default) */
  timeout?: number;
  /** Whether to skip case conversion for request body */
  skipRequestConversion?: boolean;
  /** Whether to skip case conversion for response body */
  skipResponseConversion?: boolean;
  /** Whether to skip retry logic */
  skipRetry?: boolean;
  /** Optional abort signal */
  signal?: AbortSignal;
}

/** HTTP response wrapper */
export interface HttpResponse<T> {
  /** Response status code */
  status: number;
  /** Response headers */
  headers: Headers;
  /** Parsed response body */
  data: T;
}

/**
 * HTTP Client class
 *
 * Handles all HTTP communication with the Spooled API.
 */
export class HttpClient {
  private readonly config: ResolvedConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly debug: DebugFn | null;

  /** Current authentication token (API key or JWT) */
  private authToken: string | undefined;

  /** Optional function to mint a fresh access token (set when auto-refresh is enabled) */
  private refreshTokenFn: (() => Promise<string>) | null = null;

  /** Guard to prevent a refresh request from recursively triggering another refresh */
  private isRefreshing = false;

  constructor(
    config: ResolvedConfig,
    circuitBreaker: CircuitBreaker
  ) {
    this.config = config;
    this.circuitBreaker = circuitBreaker;
    this.debug = config.debug;

    // Set initial auth token
    this.authToken = config.accessToken ?? config.apiKey;
  }

  /**
   * Set the authentication token
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Set the token refresh function.
   *
   * When set, an expired-token 401 on the data plane triggers a single
   * refresh + retry of the original request with the new token.
   */
  setRefreshTokenFn(fn: () => Promise<string>): void {
    this.refreshTokenFn = fn;
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    skipApiPrefix?: boolean
  ): string {
    // Ensure path starts with /api/v1 unless explicitly skipped
    const fullPath = skipApiPrefix ? path : (path.startsWith('/api/') ? path : `${API_BASE_PATH}${path}`);
    const url = new URL(fullPath, this.config.baseUrl);

    if (params) {
      const convertedParams = convertQueryParams(params);
      for (const [key, value] of Object.entries(convertedParams)) {
        url.searchParams.append(key, value);
      }
    }

    return url.toString();
  }

  /**
   * Build request headers
   */
  private buildHeaders(customHeaders?: Record<string, string>): Headers {
    const headers = new Headers();

    // Add default headers
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    // Add user agent
    headers.set('User-Agent', this.config.userAgent);

    // Add auth token if available
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    // Add custom headers
    if (customHeaders) {
      for (const [key, value] of Object.entries(customHeaders)) {
        headers.set(key, value);
      }
    }

    return headers;
  }

  /**
   * Execute a fetch request with timeout
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const { signal } = controller;

    // Link external signal to our controller
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    // Set up timeout
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.config.fetch(url, {
        ...init,
        signal,
      });
      return response;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // Check if this was a timeout or user abort
        if (externalSignal?.aborted) {
          throw error; // User aborted
        }
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Execute a single HTTP request (no retry)
   */
  private async executeRequest<T>(
    url: string,
    options: HttpRequestOptions,
    hasRefreshed = false
  ): Promise<HttpResponse<T>> {
    const method = options.method ?? 'GET';
    const headers = this.buildHeaders(options.headers);
    const timeout = options.timeout ?? this.config.timeout;

    // Build request init
    const init: RequestInit = {
      method,
      headers,
    };

    // Add body for methods that support it
    if (method !== 'GET') {
      if (options.rawBody !== undefined) {
        init.body = options.rawBody as unknown as RequestInit['body'];
      } else if (options.body !== undefined) {
        const body = options.skipRequestConversion ? options.body : convertRequest(options.body);
        init.body = JSON.stringify(body);
      }
    }

    this.debug?.(`${method} ${url}`, { timeout, hasBody: !!options.body });

    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, init, timeout, options.signal);
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof SpooledError) {
        throw error;
      }
      // Network error (fetch failed to get a response)
      const cause = error instanceof Error ? error : undefined;
      throw new NetworkError(`Network request failed: ${cause?.message ?? 'Unknown error'}`, cause);
    }

    this.debug?.(`Response: ${response.status}`, { url });

    // Handle non-OK responses
    if (!response.ok) {
      // On an expired-token 401, try refreshing the access token once and
      // retry the original request. Guarded so the refresh request itself
      // (or a genuinely invalid credential) can't loop.
      if (
        response.status === 401 &&
        this.refreshTokenFn &&
        !hasRefreshed &&
        !this.isRefreshing
      ) {
        let refreshed = false;
        this.isRefreshing = true;
        try {
          const newToken = await this.refreshTokenFn();
          this.setAuthToken(newToken);
          refreshed = true;
        } catch (refreshError) {
          const message = refreshError instanceof Error ? refreshError.message : 'unknown';
          this.debug?.('Token refresh failed', { error: message });
        } finally {
          this.isRefreshing = false;
        }

        if (refreshed) {
          return this.executeRequest<T>(url, options, true);
        }
      }

      const apiError = await createErrorFromResponse(response);
      throw apiError;
    }

    // Parse response body
    let data: T;
    const contentType = response.headers.get('Content-Type') || '';

    if (response.status === 204) {
      data = undefined as T;
    } else if (contentType.includes('application/json')) {
      const rawData = (await response.json()) as T;
      data = options.skipResponseConversion ? rawData : convertResponse(rawData);
    } else {
      // Non-JSON response (e.g. Prometheus metrics text)
      data = (await response.text()) as unknown as T;
    }

    return {
      status: response.status,
      headers: response.headers,
      data,
    };
  }

  /**
   * Make an HTTP request with retry and circuit breaker
   */
  async request<T>(path: string, options: HttpRequestOptions = {}): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path, options.params, options.skipApiPrefix);
    const method = options.method ?? 'GET';

    // Wrap in circuit breaker
    const execute = async (): Promise<HttpResponse<T>> => {
      return this.circuitBreaker.execute(() => this.executeRequest<T>(url, options));
    };

    // Apply retry logic if not skipped
    if (options.skipRetry) {
      return execute();
    }

    return withRetry(execute, {
      config: this.resolveRetryConfig(method, options),
      signal: options.signal,
      onRetry: (attempt, error, delayMs) => {
        this.debug?.(`Retry attempt ${attempt} after ${delayMs}ms`, { error: error.message });
      },
    });
  }

  /**
   * Determine whether a request carries an idempotency key (making a
   * non-idempotent method safe to retry).
   */
  private hasIdempotencyKey(options: HttpRequestOptions): boolean {
    if (!options.headers) {
      return false;
    }
    return Object.keys(options.headers).some((key) => key.toLowerCase() === 'idempotency-key');
  }

  /**
   * Resolve the retry configuration for a request.
   *
   * Idempotent methods (GET/PUT/DELETE) and any request carrying an
   * idempotency key retry normally. Non-idempotent methods (POST/PATCH)
   * without an idempotency key must NOT be retried on ambiguous failures
   * (network/timeout/5xx) — doing so risks duplicate jobs, double claims,
   * etc. They are still retried on 429, which is rejected before the
   * server processes the request and is therefore side-effect-free.
   */
  private resolveRetryConfig(method: HttpMethod, options: HttpRequestOptions): RetryConfig {
    const base = this.config.retry;

    if (IDEMPOTENT_METHODS.has(method) || this.hasIdempotencyKey(options)) {
      return base;
    }

    return {
      ...base,
      retryOn: (error, attempt) => {
        if (error instanceof RateLimitError) {
          return base.retryOn ? base.retryOn(error, attempt) : true;
        }
        return false;
      },
    };
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'GET' });
    return response.data;
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'POST', body });
    return response.data;
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'PUT', body });
    return response.data;
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(path: string, body?: unknown, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'PATCH', body });
    return response.data;
  }

  /**
   * Make a DELETE request
   */
  async delete<T = void>(path: string, options?: Omit<HttpRequestOptions, 'method' | 'body'>): Promise<T> {
    const response = await this.request<T>(path, { ...options, method: 'DELETE' });
    return response.data;
  }
}

/**
 * Create an HTTP client instance
 */
export function createHttpClient(
  config: ResolvedConfig,
  circuitBreaker: CircuitBreaker
): HttpClient {
  return new HttpClient(config, circuitBreaker);
}
