/**
 * Circuit breaker tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  createCircuitBreaker,
  createDisabledCircuitBreaker,
} from '../../src/utils/circuit-breaker.js';
import { ServerError, ValidationError, CircuitBreakerOpenError } from '../../src/errors.js';

describe('CircuitBreaker', () => {
  const defaultConfig = {
    enabled: true,
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000,
  };

  describe('initial state', () => {
    it('should start in closed state', () => {
      const cb = new CircuitBreaker(defaultConfig);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should allow requests in closed state', () => {
      const cb = new CircuitBreaker(defaultConfig);
      expect(cb.isAllowed()).toBe(true);
    });
  });

  describe('failure tracking', () => {
    it('should track failures and open circuit', () => {
      const cb = new CircuitBreaker(defaultConfig);

      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));
      expect(cb.getState()).toBe(CircuitState.CLOSED);

      cb.recordFailure(new ServerError('error'));
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('should reset failure count on success', () => {
      const cb = new CircuitBreaker(defaultConfig);

      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));
      cb.recordSuccess();

      // Failure count should be reset
      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should not count non-retryable errors as failures', () => {
      const cb = new CircuitBreaker(defaultConfig);

      cb.recordFailure(new ValidationError('error'));
      cb.recordFailure(new ValidationError('error'));
      cb.recordFailure(new ValidationError('error'));

      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('open state', () => {
    it('should reject requests in open state', () => {
      const cb = new CircuitBreaker(defaultConfig);

      // Trigger open state
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);
      expect(cb.isAllowed()).toBe(false);
    });

    it('should transition to half-open after timeout', () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker(defaultConfig);

      // Trigger open state
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      // Advance time past timeout
      vi.advanceTimersByTime(5000);

      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
      expect(cb.isAllowed()).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('half-open state', () => {
    let cb: CircuitBreaker;

    beforeEach(() => {
      vi.useFakeTimers();
      cb = new CircuitBreaker(defaultConfig);

      // Trigger open state
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      // Advance to half-open
      vi.advanceTimersByTime(5000);
      cb.getState(); // Trigger state check
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should close after success threshold', () => {
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      cb.recordSuccess();
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      cb.recordSuccess();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reopen on failure', () => {
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

      cb.recordFailure(new ServerError('error'));
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('execute', () => {
    it('should execute function and record success', async () => {
      const cb = new CircuitBreaker(defaultConfig);
      const fn = vi.fn().mockResolvedValue('result');

      const result = await cb.execute(fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
    });

    it('should record failure and rethrow error', async () => {
      const cb = new CircuitBreaker(defaultConfig);
      const error = new ServerError('error');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(cb.execute(fn)).rejects.toThrow(error);
      expect(cb.getStats().failureCount).toBe(1);
    });

    it('should throw CircuitBreakerOpenError when open', async () => {
      const cb = new CircuitBreaker(defaultConfig);

      // Trigger open state
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      const fn = vi.fn().mockResolvedValue('result');
      await expect(cb.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('state change callback', () => {
    it('should call onStateChange when state changes', () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker({ ...defaultConfig, onStateChange });

      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));

      expect(onStateChange).toHaveBeenCalledWith({
        from: CircuitState.CLOSED,
        to: CircuitState.OPEN,
        timestamp: expect.any(Date),
        failureCount: 3,
      });
    });
  });

  describe('reset', () => {
    it('should reset to closed state', () => {
      const cb = new CircuitBreaker(defaultConfig);

      // Trigger open state
      for (let i = 0; i < 3; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      expect(cb.getState()).toBe(CircuitState.OPEN);

      cb.reset();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      expect(cb.getStats().failureCount).toBe(0);
    });
  });

  describe('disabled circuit breaker', () => {
    it('should always allow requests when disabled', async () => {
      const cb = createDisabledCircuitBreaker();

      // Try to trigger failures - should have no effect
      for (let i = 0; i < 10; i++) {
        cb.recordFailure(new ServerError('error'));
      }

      expect(cb.isAllowed()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      const cb = new CircuitBreaker(defaultConfig);

      cb.recordFailure(new ServerError('error'));
      cb.recordFailure(new ServerError('error'));

      const stats = cb.getStats();
      expect(stats).toEqual({
        state: CircuitState.CLOSED,
        failureCount: 2,
        successCount: 0,
        lastFailureTime: expect.any(Date),
        config: defaultConfig,
      });
    });
  });

  describe('factory functions', () => {
    it('createCircuitBreaker should create enabled breaker', () => {
      const cb = createCircuitBreaker(defaultConfig);
      expect(cb.isEnabled()).toBe(true);
    });

    it('createDisabledCircuitBreaker should create disabled breaker', () => {
      const cb = createDisabledCircuitBreaker();
      expect(cb.isEnabled()).toBe(false);
    });
  });
});
