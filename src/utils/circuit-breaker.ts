/**
 * Circuit Breaker Utility
 *
 * Implements the circuit breaker pattern to prevent cascading failures.
 * States: CLOSED (normal) -> OPEN (failing) -> HALF_OPEN (testing) -> CLOSED
 */

import type { CircuitBreakerConfig } from "../config.js";
import {
  CircuitBreakerOpenError,
  RateLimitError,
  isRetryableError,
} from "../errors.js";

/** Circuit breaker states */
export enum CircuitState {
  /** Normal operation - requests flow through */
  CLOSED = "CLOSED",
  /** Circuit is open - requests are rejected immediately */
  OPEN = "OPEN",
  /** Testing state - limited requests allowed to test recovery */
  HALF_OPEN = "HALF_OPEN",
}

/** Circuit breaker state change event */
export interface CircuitStateChange {
  from: CircuitState;
  to: CircuitState;
  timestamp: Date;
  failureCount: number;
}

/** Circuit breaker options */
export interface CircuitBreakerOptions extends CircuitBreakerConfig {
  /** Callback when state changes */
  onStateChange?: (event: CircuitStateChange) => void;
  /**
   * Custom function to determine if an error should count as a failure.
   * Defaults to {@link isCircuitBreakerFailure}.
   */
  isFailure?: (error: Error) => boolean;
}

/**
 * Default circuit breaker failure predicate.
 *
 * Counts the errors that say the API or the network is unhealthy: the
 * retryable ones (network errors, timeouts, 5xx, 408). A 429 never counts. A
 * rate-limit 429 is the API working as designed and telling this client to
 * slow down for `Retry-After` seconds; counting it let a burst above the plan
 * limit open the breaker and fail every call on the client for the breaker
 * timeout (30 s by default), including the retries that `Retry-After` had
 * already scheduled. The retry layer handles rate limiting on its own. A quota
 * 429 (`RateLimitError.isQuota`) was already excluded.
 */
export function isCircuitBreakerFailure(error: Error): boolean {
  if (error instanceof RateLimitError) {
    return false;
  }
  return isRetryableError(error);
}

/**
 * Circuit Breaker implementation
 *
 * Tracks failures and prevents requests when the failure threshold is reached.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number = 0;
  private readonly config: CircuitBreakerOptions;

  constructor(config: CircuitBreakerOptions) {
    this.config = config;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.config.timeout) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }
    return this.state;
  }

  /**
   * Check if circuit breaker is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if requests are currently allowed
   */
  isAllowed(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const state = this.getState();
    return state === CircuitState.CLOSED || state === CircuitState.HALF_OPEN;
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(error: Error): void {
    if (!this.config.enabled) {
      return;
    }

    // Check if this error should count as a failure
    const shouldCount = (this.config.isFailure ?? isCircuitBreakerFailure)(
      error,
    );

    if (!shouldCount) {
      return;
    }

    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open state reopens the circuit
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount++;

      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) {
      return;
    }

    const oldState = this.state;
    this.state = newState;

    // Reset counters on state change
    if (newState === CircuitState.CLOSED) {
      this.failureCount = 0;
      this.successCount = 0;
    } else if (newState === CircuitState.HALF_OPEN) {
      this.successCount = 0;
    } else if (newState === CircuitState.OPEN) {
      this.successCount = 0;
    }

    // Notify listener
    this.config.onStateChange?.({
      from: oldState,
      to: newState,
      timestamp: new Date(),
      failureCount: this.failureCount,
    });
  }

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn - Async function to execute
   * @returns Promise resolving to the function result
   * @throws CircuitBreakerOpenError if circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAllowed()) {
      throw new CircuitBreakerOpenError(
        `Circuit breaker is open. Will retry after ${this.config.timeout}ms`,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.recordFailure(err);
      throw error;
    }
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: Date | null;
    config: CircuitBreakerConfig;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime)
        : null,
      config: {
        enabled: this.config.enabled,
        failureThreshold: this.config.failureThreshold,
        successThreshold: this.config.successThreshold,
        timeout: this.config.timeout,
      },
    };
  }
}

/**
 * Create a circuit breaker instance from configuration.
 *
 * Rate-limit 429s do not count as failures (see
 * {@link isCircuitBreakerFailure}).
 */
export function createCircuitBreaker(
  config: CircuitBreakerConfig,
): CircuitBreaker {
  return new CircuitBreaker({ ...config, isFailure: isCircuitBreakerFailure });
}

/**
 * Create a disabled circuit breaker (pass-through)
 */
export function createDisabledCircuitBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    enabled: false,
    failureThreshold: 0,
    successThreshold: 0,
    timeout: 0,
  });
}
