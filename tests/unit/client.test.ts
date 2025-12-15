/**
 * Client tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient, createClient } from '../../src/client.js';

// MSW server setup
const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('SpooledClient', () => {
  describe('constructor', () => {
    it('should create client with API key', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      expect(client).toBeInstanceOf(SpooledClient);
    });

    it('should create client with access token', () => {
      const client = new SpooledClient({ accessToken: 'jwt_token' });
      expect(client).toBeInstanceOf(SpooledClient);
    });

    it('should throw without auth', () => {
      expect(() => new SpooledClient({} as any)).toThrow('requires either apiKey or accessToken');
    });

    it('should throw with invalid API key format', () => {
      expect(() => new SpooledClient({ apiKey: 'invalid' })).toThrow('Invalid API key format');
    });
  });

  describe('resources', () => {
    it('should have all resource instances', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });

      expect(client.auth).toBeDefined();
      expect(client.jobs).toBeDefined();
      expect(client.queues).toBeDefined();
      expect(client.workers).toBeDefined();
      expect(client.schedules).toBeDefined();
      expect(client.workflows).toBeDefined();
      expect(client.webhooks).toBeDefined();
      expect(client.apiKeys).toBeDefined();
      expect(client.organizations).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return readonly config', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123', timeout: 60000 });
      const config = client.getConfig();

      expect(config.apiKey).toBe('sk_test_123');
      expect(config.timeout).toBe(60000);
    });
  });

  describe('circuit breaker', () => {
    it('should expose circuit breaker stats', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const stats = client.getCircuitBreakerStats();

      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('failureCount');
    });

    it('should allow resetting circuit breaker', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      expect(() => client.resetCircuitBreaker()).not.toThrow();
    });
  });

  describe('withOptions', () => {
    it('should create new client with merged options', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123', timeout: 30000 });
      const newClient = client.withOptions({ timeout: 60000 });

      expect(newClient.getConfig().timeout).toBe(60000);
      expect(client.getConfig().timeout).toBe(30000); // Original unchanged
    });
  });

  describe('API calls', () => {
    it('should make authenticated requests', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', ({ request }) => {
          const auth = request.headers.get('Authorization');
          if (auth !== 'Bearer sk_test_123') {
            return HttpResponse.json({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 });
          }
          return HttpResponse.json([]);
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const jobs = await client.jobs.list();
      expect(jobs).toEqual([]);
    });

    it('should convert response from snake_case to camelCase', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/job_123', () => {
          return HttpResponse.json({
            id: 'job_123',
            queue_name: 'my-queue',
            created_at: '2024-01-01T00:00:00Z',
            max_retries: 3,
            retry_count: 0,
            payload: { some_key: 'value' },
          });
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const job = await client.jobs.get('job_123');

      expect(job.queueName).toBe('my-queue');
      expect(job.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(job.maxRetries).toBe(3);
      // Payload should NOT be converted
      expect(job.payload).toEqual({ some_key: 'value' });
    });

    it('should convert request from camelCase to snake_case', async () => {
      let receivedBody: any;

      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ id: 'job_123', created: true });
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      await client.jobs.create({
        queueName: 'my-queue',
        maxRetries: 5,
        payload: { myData: 'value' },
      });

      expect(receivedBody.queue_name).toBe('my-queue');
      expect(receivedBody.max_retries).toBe(5);
      // Payload should NOT be converted
      expect(receivedBody.payload).toEqual({ myData: 'value' });
    });

    it('should handle errors', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/nonexistent', () => {
          return HttpResponse.json(
            { code: 'NOT_FOUND', message: 'Job not found' },
            { status: 404 }
          );
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      await expect(client.jobs.get('nonexistent')).rejects.toThrow('Job not found');
    });
  });
});

describe('createClient', () => {
  it('should be a factory function for SpooledClient', () => {
    const client = createClient({ apiKey: 'sk_test_123' });
    expect(client).toBeInstanceOf(SpooledClient);
  });
});
