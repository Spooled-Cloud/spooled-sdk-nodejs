/**
 * Auth Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient } from '../../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('AuthResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('login', () => {
    it('should login and get tokens', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/auth/login', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            access_token: 'jwt_access_token',
            refresh_token: 'jwt_refresh_token',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_expires_in: 86400,
          });
        })
      );

      const client = createClient();
      const result = await client.auth.login({ apiKey: 'sk_test_another' });

      expect(receivedBody.api_key).toBe('sk_test_another');
      expect(result.accessToken).toBe('jwt_access_token');
      expect(result.refreshToken).toBe('jwt_refresh_token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(3600);
    });
  });

  describe('refresh', () => {
    it('should refresh access token', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/auth/refresh', () => {
          return HttpResponse.json({
            access_token: 'new_access_token',
            token_type: 'Bearer',
            expires_in: 3600,
          });
        })
      );

      const client = createClient();
      const result = await client.auth.refresh({ refreshToken: 'old_refresh_token' });

      expect(result.accessToken).toBe('new_access_token');
      expect(result.expiresIn).toBe(3600);
    });
  });

  describe('logout', () => {
    it('should logout', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/auth/logout', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.auth.logout()).resolves.toBeUndefined();
    });
  });

  describe('me', () => {
    it('should get current user info', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/auth/me', () => {
          return HttpResponse.json({
            organization_id: 'org_123',
            api_key_id: 'key_123',
            queues: ['queue-1', 'queue-2'],
            issued_at: '2024-01-01T00:00:00Z',
            expires_at: '2024-01-01T01:00:00Z',
          });
        })
      );

      const client = createClient();
      const user = await client.auth.me();

      expect(user.organizationId).toBe('org_123');
      expect(user.apiKeyId).toBe('key_123');
      expect(user.queues).toEqual(['queue-1', 'queue-2']);
    });
  });

  describe('validate', () => {
    it('should validate a token', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/auth/validate', () => {
          return HttpResponse.json({
            valid: true,
            claims: {
              organization_id: 'org_123',
              api_key_id: 'key_123',
              queues: [],
              exp: 1704067200,
              iat: 1704063600,
            },
          });
        })
      );

      const client = createClient();
      const result = await client.auth.validate({ token: 'some_token' });

      expect(result.valid).toBe(true);
      expect(result.claims?.organizationId).toBe('org_123');
    });

    it('should handle invalid token', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/auth/validate', () => {
          return HttpResponse.json({
            valid: false,
            message: 'Token expired',
          });
        })
      );

      const client = createClient();
      const result = await client.auth.validate({ token: 'expired_token' });

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Token expired');
    });
  });
});
