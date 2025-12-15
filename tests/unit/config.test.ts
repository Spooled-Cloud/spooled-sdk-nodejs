/**
 * Config tests
 */

import { describe, it, expect } from 'vitest';
import { resolveConfig, validateConfig, DEFAULT_CONFIG } from '../../src/config.js';

describe('Config', () => {
  describe('resolveConfig', () => {
    it('should merge defaults with provided options', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
      });

      expect(config.apiKey).toBe('sk_test_123');
      expect(config.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
      expect(config.timeout).toBe(DEFAULT_CONFIG.timeout);
      expect(config.retry.maxRetries).toBe(DEFAULT_CONFIG.retry.maxRetries);
    });

    it('should allow overriding defaults', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        baseUrl: 'https://custom.api.com',
        timeout: 60000,
        retries: 5,
      });

      expect(config.baseUrl).toBe('https://custom.api.com');
      expect(config.timeout).toBe(60000);
      expect(config.retry.maxRetries).toBe(5);
    });

    it('should create debug function when debug is true', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        debug: true,
      });

      expect(config.debug).toBeInstanceOf(Function);
    });

    it('should use custom debug function', () => {
      const customDebug = () => {};
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        debug: customDebug,
      });

      expect(config.debug).toBe(customDebug);
    });

    it('should set debug to null when not provided', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
      });

      expect(config.debug).toBeNull();
    });
  });

  describe('validateConfig', () => {
    it('should throw if no auth method provided', () => {
      const config = resolveConfig({} as any);
      expect(() => validateConfig(config)).toThrow('requires either apiKey or accessToken');
    });

    it('should throw for invalid API key format', () => {
      const config = resolveConfig({
        apiKey: 'invalid_key',
      });
      expect(() => validateConfig(config)).toThrow('Invalid API key format');
    });

    it('should accept valid API key format', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
      });
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should accept access token', () => {
      const config = resolveConfig({
        accessToken: 'jwt_token_here',
      });
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('should throw for invalid baseUrl', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        baseUrl: 'invalid-url',
      });
      expect(() => validateConfig(config)).toThrow('baseUrl must start with http');
    });

    it('should throw for invalid timeout', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        timeout: 0,
      });
      expect(() => validateConfig(config)).toThrow('timeout must be a positive number');
    });

    it('should throw for invalid retry config', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        retry: { maxRetries: -1 },
      });
      expect(() => validateConfig(config)).toThrow('retry.maxRetries must be non-negative');
    });

    it('should throw if maxDelay < baseDelay', () => {
      const config = resolveConfig({
        apiKey: 'sk_test_123',
        retry: { baseDelay: 5000, maxDelay: 1000 },
      });
      expect(() => validateConfig(config)).toThrow('retry.maxDelay must be >= retry.baseDelay');
    });
  });
});
