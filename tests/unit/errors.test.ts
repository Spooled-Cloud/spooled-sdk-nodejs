/**
 * Errors tests
 */

import { describe, it, expect } from 'vitest';
import {
  SpooledError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  PayloadTooLargeError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  CircuitBreakerOpenError,
  isSpooledError,
  isRetryableError,
  parseRateLimitHeaders,
  createErrorFromResponse,
} from '../../src/errors.js';

describe('Errors', () => {
  describe('SpooledError', () => {
    it('should create error with default values', () => {
      const error = new SpooledError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(0);
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.name).toBe('SpooledError');
    });

    it('should create error with all values', () => {
      const error = new SpooledError('Test error', 400, 'TEST_CODE', { field: 'value' }, 'req_123');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ field: 'value' });
      expect(error.requestId).toBe('req_123');
    });

    it('should not be retryable by default', () => {
      const error = new SpooledError('Test error');
      expect(error.isRetryable()).toBe(false);
    });

    it('should convert to JSON', () => {
      const error = new SpooledError('Test error', 400, 'TEST_CODE');
      const json = error.toJSON();
      expect(json).toEqual({
        name: 'SpooledError',
        message: 'Test error',
        statusCode: 400,
        code: 'TEST_CODE',
        details: undefined,
        requestId: undefined,
      });
    });
  });

  describe('Error subclasses', () => {
    it('should create AuthenticationError with 401', () => {
      const error = new AuthenticationError('Invalid token');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthenticationError');
      expect(error.isRetryable()).toBe(false);
    });

    it('should create AuthorizationError with 403', () => {
      const error = new AuthorizationError('Forbidden');
      expect(error.statusCode).toBe(403);
      expect(error.name).toBe('AuthorizationError');
    });

    it('should create NotFoundError with 404', () => {
      const error = new NotFoundError('Not found');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('NotFoundError');
    });

    it('should create ConflictError with 409', () => {
      const error = new ConflictError('Conflict');
      expect(error.statusCode).toBe(409);
      expect(error.name).toBe('ConflictError');
    });

    it('should create ValidationError with 400', () => {
      const error = new ValidationError('Validation failed');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
    });

    it('should create PayloadTooLargeError with 413', () => {
      const error = new PayloadTooLargeError('Too large');
      expect(error.statusCode).toBe(413);
      expect(error.name).toBe('PayloadTooLargeError');
    });

    it('should create RateLimitError with 429 and be retryable', () => {
      const error = new RateLimitError('Rate limited');
      expect(error.statusCode).toBe(429);
      expect(error.name).toBe('RateLimitError');
      expect(error.isRetryable()).toBe(true);
    });

    it('should create ServerError with 5xx and be retryable', () => {
      const error = new ServerError('Server error', 503);
      expect(error.statusCode).toBe(503);
      expect(error.name).toBe('ServerError');
      expect(error.isRetryable()).toBe(true);
    });

    it('should create NetworkError and be retryable', () => {
      const error = new NetworkError('Network failed');
      expect(error.statusCode).toBe(0);
      expect(error.name).toBe('NetworkError');
      expect(error.isRetryable()).toBe(true);
    });

    it('should create TimeoutError and be retryable', () => {
      const error = new TimeoutError('Timed out', 30000);
      expect(error.statusCode).toBe(0);
      expect(error.timeoutMs).toBe(30000);
      expect(error.name).toBe('TimeoutError');
      expect(error.isRetryable()).toBe(true);
    });

    it('should create CircuitBreakerOpenError and not be retryable', () => {
      const error = new CircuitBreakerOpenError('Circuit open');
      expect(error.name).toBe('CircuitBreakerOpenError');
      expect(error.isRetryable()).toBe(false);
    });
  });

  describe('RateLimitError', () => {
    it('should calculate retry after from retryAfter field', () => {
      const error = new RateLimitError('Rate limited', 'RATE_LIMIT', { retryAfter: 30 });
      expect(error.getRetryAfter()).toBe(30);
    });

    it('should calculate retry after from reset time', () => {
      const reset = new Date(Date.now() + 60000);
      const error = new RateLimitError('Rate limited', 'RATE_LIMIT', { reset });
      expect(error.getRetryAfter()).toBeGreaterThanOrEqual(59);
      expect(error.getRetryAfter()).toBeLessThanOrEqual(61);
    });

    it('should return default 60 seconds if no info', () => {
      const error = new RateLimitError('Rate limited', 'RATE_LIMIT', {});
      expect(error.getRetryAfter()).toBe(60);
    });

    it('should include rate limit info in JSON', () => {
      const error = new RateLimitError('Rate limited', 'RATE_LIMIT', { limit: 100, remaining: 0 });
      const json = error.toJSON();
      expect(json.rateLimitInfo).toEqual({ limit: 100, remaining: 0 });
    });
  });

  describe('isSpooledError', () => {
    it('should return true for SpooledError instances', () => {
      expect(isSpooledError(new SpooledError('test'))).toBe(true);
      expect(isSpooledError(new AuthenticationError('test'))).toBe(true);
      expect(isSpooledError(new RateLimitError('test'))).toBe(true);
    });

    it('should return false for non-SpooledError', () => {
      expect(isSpooledError(new Error('test'))).toBe(false);
      expect(isSpooledError('string')).toBe(false);
      expect(isSpooledError(null)).toBe(false);
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable errors', () => {
      expect(isRetryableError(new RateLimitError('test'))).toBe(true);
      expect(isRetryableError(new ServerError('test'))).toBe(true);
      expect(isRetryableError(new NetworkError('test'))).toBe(true);
      expect(isRetryableError(new TimeoutError('test'))).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(isRetryableError(new AuthenticationError('test'))).toBe(false);
      expect(isRetryableError(new ValidationError('test'))).toBe(false);
      expect(isRetryableError(new CircuitBreakerOpenError('test'))).toBe(false);
    });

    it('should return true for TypeError (fetch network errors)', () => {
      expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
    });
  });

  describe('parseRateLimitHeaders', () => {
    it('should parse all rate limit headers', () => {
      const headers = new Headers({
        'Retry-After': '30',
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '5',
        'X-RateLimit-Reset': '1700000000',
      });

      const info = parseRateLimitHeaders(headers);
      expect(info.retryAfter).toBe(30);
      expect(info.limit).toBe(100);
      expect(info.remaining).toBe(5);
      expect(info.reset).toEqual(new Date(1700000000 * 1000));
    });

    it('should handle missing headers', () => {
      const headers = new Headers();
      const info = parseRateLimitHeaders(headers);
      expect(info).toEqual({});
    });

    it('should ignore invalid values', () => {
      const headers = new Headers({
        'Retry-After': 'invalid',
        'X-RateLimit-Limit': 'not-a-number',
      });

      const info = parseRateLimitHeaders(headers);
      expect(info.retryAfter).toBeUndefined();
      expect(info.limit).toBeUndefined();
    });
  });

  describe('createErrorFromResponse', () => {
    it('should create ValidationError for 400', async () => {
      const response = new Response(JSON.stringify({ code: 'INVALID_INPUT', message: 'Bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.message).toBe('Bad request');
    });

    it('should create AuthenticationError for 401', async () => {
      const response = new Response(JSON.stringify({ code: 'INVALID_TOKEN', message: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('should create AuthorizationError for 403', async () => {
      const response = new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(AuthorizationError);
    });

    it('should create NotFoundError for 404', async () => {
      const response = new Response(JSON.stringify({ message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(NotFoundError);
    });

    it('should create RateLimitError for 429 with headers', async () => {
      const response = new Response(JSON.stringify({ message: 'Too many requests' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
        },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).rateLimitInfo.retryAfter).toBe(60);
    });

    it('should create ServerError for 5xx', async () => {
      const response = new Response(JSON.stringify({ message: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(ServerError);
    });

    it('should handle non-JSON response', async () => {
      const response = new Response('Plain text error', {
        status: 500,
        statusText: 'Internal Server Error',
      });

      const error = await createErrorFromResponse(response);
      expect(error).toBeInstanceOf(ServerError);
      expect(error.message).toBe('Internal Server Error');
    });
  });
});
