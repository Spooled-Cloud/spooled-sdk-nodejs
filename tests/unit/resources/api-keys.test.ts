/**
 * API Keys Resource tests
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

describe('ApiKeysResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('list', () => {
    it('should list API keys', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/api-keys', () => {
          return HttpResponse.json([
            {
              id: 'key_1',
              name: 'Production Key',
              queues: [],
              is_active: true,
              created_at: '2024-01-01T00:00:00Z',
              last_used: '2024-01-01T12:00:00Z',
            },
            {
              id: 'key_2',
              name: 'Test Key',
              queues: ['test-queue'],
              rate_limit: 100,
              is_active: true,
              created_at: '2024-01-01T00:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const keys = await client.apiKeys.list();

      expect(keys).toHaveLength(2);
      expect(keys[0].name).toBe('Production Key');
      expect(keys[1].queues).toContain('test-queue');
    });
  });

  describe('create', () => {
    it('should create an API key', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/api-keys', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'key_123',
            key: 'sp_test_new_key_abc123',
            name: 'New Key',
            created_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const result = await client.apiKeys.create({
        name: 'New Key',
        queues: ['queue-1', 'queue-2'],
        rateLimit: 500,
      });

      expect(receivedBody.name).toBe('New Key');
      expect(receivedBody.queues).toEqual(['queue-1', 'queue-2']);
      expect(receivedBody.rate_limit).toBe(500);

      expect(result.id).toBe('key_123');
      expect(result.key).toBe('sp_test_new_key_abc123');
    });
  });

  describe('get', () => {
    it('should get an API key', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/api-keys/key_123', () => {
          return HttpResponse.json({
            id: 'key_123',
            name: 'My Key',
            queues: ['queue-1'],
            rate_limit: 1000,
            is_active: true,
            created_at: '2024-01-01T00:00:00Z',
            last_used: '2024-01-01T12:00:00Z',
            expires_at: '2025-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const key = await client.apiKeys.get('key_123');

      expect(key.id).toBe('key_123');
      expect(key.name).toBe('My Key');
      expect(key.rateLimit).toBe(1000);
      expect(key.expiresAt).toBe('2025-01-01T00:00:00Z');
    });
  });

  describe('update', () => {
    it('should update an API key', async () => {
      let receivedBody: any;
      server.use(
        http.put('https://api.spooled.cloud/api/v1/api-keys/key_123', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'key_123',
            name: 'Updated Key',
            queues: ['new-queue'],
            is_active: false,
            created_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const key = await client.apiKeys.update('key_123', {
        name: 'Updated Key',
        queues: ['new-queue'],
        isActive: false,
      });

      expect(receivedBody.name).toBe('Updated Key');
      expect(receivedBody.is_active).toBe(false);
      expect(key.name).toBe('Updated Key');
      expect(key.isActive).toBe(false);
    });
  });

  describe('revoke', () => {
    it('should revoke an API key', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/api-keys/key_123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.apiKeys.revoke('key_123')).resolves.toBeUndefined();
    });
  });
});
