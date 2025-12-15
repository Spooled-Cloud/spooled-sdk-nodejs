/**
 * Retry utility tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateDelay, shouldRetry, sleep, withRetry } from '../../src/utils/retry.js';
import { RateLimitError, ServerError, ValidationError } from '../../src/errors.js';
import type { RetryConfig } from '../../src/config.js';

describe('Retry', () => {
  const defaultConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    factor: 2,
    jitter: false,
  };

  describe('calculateDelay', () => {
    it('should calculate exponential delay', () => {
      const config = { ...defaultConfig };
      expect(calculateDelay(1, config)).toBe(1000); // 1000 * 2^0
      expect(calculateDelay(2, config)).toBe(2000); // 1000 * 2^1
      expect(calculateDelay(3, config)).toBe(4000); // 1000 * 2^2
      expect(calculateDelay(4, config)).toBe(8000); // 1000 * 2^3
    });

    it('should cap at maxDelay', () => {
      const config = { ...defaultConfig, maxDelay: 5000 };
      expect(calculateDelay(4, config)).toBe(5000);
      expect(calculateDelay(10, config)).toBe(5000);
    });

    it('should use retryAfterSeconds when provided', () => {
      const config = { ...defaultConfig };
      expect(calculateDelay(1, config, 60)).toBe(30000); // Capped at maxDelay
      expect(calculateDelay(1, config, 5)).toBe(5000);
    });

    it('should add jitter when enabled', () => {
      const config = { ...defaultConfig, jitter: true };
      const delays = new Set<number>();
      
      // Run multiple times to ensure randomness
      for (let i = 0; i < 100; i++) {
        delays.add(calculateDelay(1, config));
      }

      // With jitter, we should see variation
      expect(delays.size).toBeGreaterThan(1);

      // All delays should be within expected range
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThanOrEqual(1250); // 1000 + 25% jitter
      });
    });
  });

  describe('shouldRetry', () => {
    it('should return false when attempts exhausted', () => {
      const config = { ...defaultConfig, maxRetries: 3 };
      // After 3 retries (attempts 1, 2, 3, then checking if we should retry again)
      // At attempt 4, we've exhausted all retries
      expect(shouldRetry(new ServerError('error'), 3, config)).toBe(true); // Can still retry once more
      expect(shouldRetry(new ServerError('error'), 4, config)).toBe(false);
      expect(shouldRetry(new ServerError('error'), 5, config)).toBe(false);
    });

    it('should return true for retryable errors', () => {
      const config = { ...defaultConfig };
      expect(shouldRetry(new ServerError('error'), 1, config)).toBe(true);
      expect(shouldRetry(new RateLimitError('error'), 1, config)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const config = { ...defaultConfig };
      expect(shouldRetry(new ValidationError('error'), 1, config)).toBe(false);
    });

    it('should use custom retryOn function', () => {
      const config = {
        ...defaultConfig,
        retryOn: (error: Error) => error.message.includes('retry-me'),
      };

      expect(shouldRetry(new Error('retry-me please'), 1, config)).toBe(true);
      expect(shouldRetry(new Error('do not retry'), 1, config)).toBe(false);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after specified time', async () => {
      const sleepPromise = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(sleepPromise).resolves.toBeUndefined();
    });

    it('should reject when aborted', async () => {
      const controller = new AbortController();
      const sleepPromise = sleep(1000, controller.signal);
      controller.abort();
      await expect(sleepPromise).rejects.toThrow('Aborted');
    });

    it('should reject immediately if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(sleep(1000, controller.signal)).rejects.toThrow('Aborted');
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const resultPromise = withRetry(fn, { config: defaultConfig });
      
      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new ServerError('error'))
        .mockRejectedValueOnce(new ServerError('error'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, { config: defaultConfig });

      // First attempt fails
      await vi.runAllTimersAsync();
      
      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new ValidationError('error'));
      const resultPromise = withRetry(fn, { config: defaultConfig });

      await expect(resultPromise).rejects.toThrow(ValidationError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      vi.useRealTimers(); // Use real timers for this test
      
      const fn = vi.fn().mockRejectedValue(new ServerError('error'));
      const config = { ...defaultConfig, maxRetries: 2, baseDelay: 1, maxDelay: 10 }; // Very short delays

      await expect(withRetry(fn, { config })).rejects.toThrow(ServerError);
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      
      vi.useFakeTimers(); // Restore for other tests
    });

    it('should call onRetry callback', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new ServerError('error'))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      const resultPromise = withRetry(fn, { config: defaultConfig, onRetry });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(ServerError), expect.any(Number));
    });

    it('should respect abort signal', async () => {
      const fn = vi.fn().mockRejectedValue(new ServerError('error'));
      const controller = new AbortController();
      const resultPromise = withRetry(fn, { config: defaultConfig, signal: controller.signal });

      controller.abort();

      await expect(resultPromise).rejects.toThrow('Aborted');
    });

    it('should use Retry-After from RateLimitError', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new RateLimitError('rate limited', 'RATE_LIMIT', { retryAfter: 5 }))
        .mockResolvedValue('success');
      const onRetry = vi.fn();

      const resultPromise = withRetry(fn, { config: defaultConfig, onRetry });
      await vi.runAllTimersAsync();
      await resultPromise;

      // Should have used 5 seconds (5000ms) as delay
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(RateLimitError), 5000);
    });
  });
});
