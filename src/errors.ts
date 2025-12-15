/**
 * Custom Error Classes
 *
 * Provides a hierarchy of error types for the Spooled SDK.
 */

/** Error response body from the API */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Rate limit information parsed from headers */
export interface RateLimitInfo {
  /** Maximum requests per window */
  limit?: number;
  /** Remaining requests in current window */
  remaining?: number;
  /** Unix timestamp when the window resets */
  reset?: Date;
  /** Seconds to wait before retrying */
  retryAfter?: number;
}

/**
 * Base error class for all Spooled SDK errors
 */
export class SpooledError extends Error {
  /** HTTP status code (if applicable) */
  readonly statusCode: number;
  /** Error code from API response */
  readonly code: string;
  /** Additional error details */
  readonly details?: Record<string, unknown>;
  /** Request ID for debugging */
  readonly requestId?: string;
  /** Original cause of the error */
  readonly cause?: Error;

  constructor(
    message: string,
    statusCode: number = 0,
    code: string = 'UNKNOWN_ERROR',
    details?: Record<string, unknown>,
    requestId?: string,
    cause?: Error
  ) {
    super(message);
    this.name = 'SpooledError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.cause = cause;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /** Whether this error is retryable */
  isRetryable(): boolean {
    return false;
  }

  /** Convert to plain object for logging */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      details: this.details,
      requestId: this.requestId,
    };
  }
}

/**
 * Authentication error (401)
 * Thrown when authentication fails (invalid/expired token or API key)
 */
export class AuthenticationError extends SpooledError {
  constructor(
    message: string = 'Authentication failed',
    code: string = 'AUTHENTICATION_FAILED',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 401, code, details, requestId);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error (403)
 * Thrown when the authenticated user lacks permission
 */
export class AuthorizationError extends SpooledError {
  constructor(
    message: string = 'Access denied',
    code: string = 'ACCESS_DENIED',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 403, code, details, requestId);
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error (404)
 * Thrown when a requested resource doesn't exist
 */
export class NotFoundError extends SpooledError {
  constructor(
    message: string = 'Resource not found',
    code: string = 'NOT_FOUND',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 404, code, details, requestId);
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error (409)
 * Thrown when there's a conflict (e.g., duplicate resource)
 */
export class ConflictError extends SpooledError {
  constructor(
    message: string = 'Conflict',
    code: string = 'CONFLICT',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 409, code, details, requestId);
    this.name = 'ConflictError';
  }
}

/**
 * Validation error (400)
 * Thrown when request validation fails
 */
export class ValidationError extends SpooledError {
  constructor(
    message: string = 'Validation failed',
    code: string = 'VALIDATION_ERROR',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 400, code, details, requestId);
    this.name = 'ValidationError';
  }
}

/**
 * Payload too large error (413)
 * Thrown when request body exceeds size limit
 */
export class PayloadTooLargeError extends SpooledError {
  constructor(
    message: string = 'Request payload too large',
    code: string = 'PAYLOAD_TOO_LARGE',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 413, code, details, requestId);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Rate limit error (429)
 * Thrown when rate limit is exceeded
 */
export class RateLimitError extends SpooledError {
  /** Rate limit information */
  readonly rateLimitInfo: RateLimitInfo;

  constructor(
    message: string = 'Rate limit exceeded',
    code: string = 'RATE_LIMIT_EXCEEDED',
    rateLimitInfo: RateLimitInfo = {},
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, 429, code, details, requestId);
    this.name = 'RateLimitError';
    this.rateLimitInfo = rateLimitInfo;
  }

  override isRetryable(): boolean {
    return true;
  }

  /** Get the number of seconds to wait before retrying */
  getRetryAfter(): number {
    if (this.rateLimitInfo.retryAfter !== undefined) {
      return this.rateLimitInfo.retryAfter;
    }
    if (this.rateLimitInfo.reset) {
      const now = Date.now();
      const resetTime = this.rateLimitInfo.reset.getTime();
      return Math.max(0, Math.ceil((resetTime - now) / 1000));
    }
    return 60; // Default to 60 seconds
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      rateLimitInfo: this.rateLimitInfo,
    };
  }
}

/**
 * Server error (5xx)
 * Thrown when the server encounters an error
 */
export class ServerError extends SpooledError {
  constructor(
    message: string = 'Server error',
    statusCode: number = 500,
    code: string = 'SERVER_ERROR',
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message, statusCode, code, details, requestId);
    this.name = 'ServerError';
  }

  override isRetryable(): boolean {
    return true;
  }
}

/**
 * Network error
 * Thrown when a network request fails (no response received)
 */
export class NetworkError extends SpooledError {
  constructor(message: string = 'Network request failed', cause?: Error) {
    super(message, 0, 'NETWORK_ERROR', undefined, undefined, cause);
    this.name = 'NetworkError';
  }

  override isRetryable(): boolean {
    return true;
  }
}

/**
 * Timeout error
 * Thrown when a request times out
 */
export class TimeoutError extends SpooledError {
  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;

  constructor(message: string = 'Request timed out', timeoutMs: number = 0) {
    super(message, 0, 'TIMEOUT', { timeoutMs });
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }

  override isRetryable(): boolean {
    return true;
  }
}

/**
 * Circuit breaker open error
 * Thrown when the circuit breaker is open and rejecting requests
 */
export class CircuitBreakerOpenError extends SpooledError {
  constructor(message: string = 'Circuit breaker is open') {
    super(message, 0, 'CIRCUIT_BREAKER_OPEN');
    this.name = 'CircuitBreakerOpenError';
  }

  override isRetryable(): boolean {
    return false; // Should wait for circuit to close
  }
}

/**
 * Parse rate limit headers from a Response
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const info: RateLimitInfo = {};

  const retryAfter = headers.get('Retry-After');
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      info.retryAfter = seconds;
    }
  }

  const limit = headers.get('X-RateLimit-Limit');
  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!isNaN(parsed)) {
      info.limit = parsed;
    }
  }

  const remaining = headers.get('X-RateLimit-Remaining');
  if (remaining) {
    const parsed = parseInt(remaining, 10);
    if (!isNaN(parsed)) {
      info.remaining = parsed;
    }
  }

  const reset = headers.get('X-RateLimit-Reset');
  if (reset) {
    const timestamp = parseInt(reset, 10);
    if (!isNaN(timestamp)) {
      info.reset = new Date(timestamp * 1000);
    }
  }

  return info;
}

/**
 * Parse an error response body
 */
async function parseErrorBody(response: Response): Promise<ApiErrorBody | null> {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body === 'object' && body !== null) {
      return {
        code: (body.code as string) || 'UNKNOWN_ERROR',
        message: (body.message as string) || response.statusText,
        details: body.details as Record<string, unknown> | undefined,
      };
    }
  } catch {
    // JSON parsing failed
  }

  return null;
}

/**
 * Create an appropriate error from an HTTP response
 */
export async function createErrorFromResponse(response: Response): Promise<SpooledError> {
  const requestId = response.headers.get('X-Request-ID') ?? undefined;
  const body = await parseErrorBody(response);

  const message = body?.message || response.statusText || `HTTP ${response.status}`;
  const code = body?.code || 'UNKNOWN_ERROR';
  const details = body?.details;

  switch (response.status) {
    case 400:
      return new ValidationError(message, code, details, requestId);

    case 401:
      return new AuthenticationError(message, code, details, requestId);

    case 403:
      return new AuthorizationError(message, code, details, requestId);

    case 404:
      return new NotFoundError(message, code, details, requestId);

    case 409:
      return new ConflictError(message, code, details, requestId);

    case 413:
      return new PayloadTooLargeError(message, code, details, requestId);

    case 429: {
      const rateLimitInfo = parseRateLimitHeaders(response.headers);
      return new RateLimitError(message, code, rateLimitInfo, details, requestId);
    }

    default:
      if (response.status >= 500) {
        return new ServerError(message, response.status, code, details, requestId);
      }
      return new SpooledError(message, response.status, code, details, requestId);
  }
}

/**
 * Check if an error is a SpooledError instance
 */
export function isSpooledError(error: unknown): error is SpooledError {
  return error instanceof SpooledError;
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof SpooledError) {
    return error.isRetryable();
  }
  // Network errors from fetch are typically retryable
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}
