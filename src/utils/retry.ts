/**
 * Retry Utility
 *
 * Implements exponential backoff with jitter for retrying failed requests.
 */

import type { RetryConfig } from '../config.js';
import { RateLimitError, isRetryableError } from '../errors.js';

/** Options for a single retry operation */
export interface RetryOptions {
  /** Retry configuration */
  config: RetryConfig;
  /** Optional abort signal to cancel retries */
  signal?: AbortSignal;
  /** Callback for retry events (for logging/debugging) */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

/**
 * Calculate delay for a given attempt using exponential backoff with optional jitter
 *
 * @param attempt - Current attempt number (1-based)
 * @param config - Retry configuration
 * @param retryAfterSeconds - Optional Retry-After header value
 * @returns Delay in milliseconds
 */
export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterSeconds?: number
): number {
  // If we have a Retry-After value, use it (but respect maxDelay)
  if (retryAfterSeconds !== undefined && retryAfterSeconds > 0) {
    const retryAfterMs = retryAfterSeconds * 1000;
    return Math.min(retryAfterMs, config.maxDelay);
  }

  // Calculate exponential delay: baseDelay * factor^(attempt-1)
  const exponentialDelay = config.baseDelay * Math.pow(config.factor, attempt - 1);

  // Cap at maxDelay
  let delay = Math.min(exponentialDelay, config.maxDelay);

  // Add jitter if enabled (random value between 0 and 25% of delay)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    const jitter = Math.random() * jitterRange;
    delay = delay + jitter;
  }

  return Math.floor(delay);
}

/**
 * Check if an error should be retried
 *
 * @param error - The error to check
 * @param attempt - Current attempt number
 * @param config - Retry configuration
 * @returns Whether the error is retryable
 */
export function shouldRetry(error: Error, attempt: number, config: RetryConfig): boolean {
  // Don't retry if we've exhausted attempts
  // attempt is 1-based, so with maxRetries=2, we allow attempts 1, 2, 3 (initial + 2 retries)
  if (attempt > config.maxRetries) {
    return false;
  }

  // Use custom retry function if provided
  if (config.retryOn) {
    return config.retryOn(error, attempt);
  }

  // Default: retry on retryable errors
  return isRetryableError(error);
}

/**
 * Sleep for the specified duration
 *
 * @param ms - Duration in milliseconds
 * @param signal - Optional abort signal
 * @returns Promise that resolves after the delay or rejects if aborted
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Execute a function with retry logic
 *
 * @param fn - Async function to execute
 * @param options - Retry options
 * @returns Promise resolving to the function result
 * @throws Last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { config, signal, onRetry } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    // Check if aborted before each attempt
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      return await fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;

      // Check if we should retry
      if (!shouldRetry(err, attempt, config)) {
        throw err;
      }

      // Calculate delay
      let retryAfter: number | undefined;
      if (err instanceof RateLimitError) {
        retryAfter = err.getRetryAfter();
      }
      const delayMs = calculateDelay(attempt, config, retryAfter);

      // Notify about retry
      onRetry?.(attempt, err, delayMs);

      // Wait before retrying
      await sleep(delayMs, signal);
    }
  }

  // Should not reach here, but throw last error just in case
  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Create a retry wrapper with pre-configured options
 *
 * @param config - Retry configuration
 * @returns Function to wrap async operations with retry logic
 */
export function createRetryWrapper(config: RetryConfig) {
  return function retry<T>(
    fn: () => Promise<T>,
    options?: Partial<Omit<RetryOptions, 'config'>>
  ): Promise<T> {
    return withRetry(fn, {
      config,
      ...options,
    });
  };
}
