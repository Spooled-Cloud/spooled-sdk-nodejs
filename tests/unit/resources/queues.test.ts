/**
 * Queues Resource tests
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

describe('QueuesResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('list', () => {
    it('should list queues', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/queues', () => {
          return HttpResponse.json([
            { queue_name: 'queue-1', max_retries: 3, default_timeout: 300, enabled: true },
            { queue_name: 'queue-2', max_retries: 5, default_timeout: 600, enabled: false },
          ]);
        })
      );

      const client = createClient();
      const queues = await client.queues.list();

      expect(queues).toHaveLength(2);
      expect(queues[0].queueName).toBe('queue-1');
      expect(queues[1].enabled).toBe(false);
    });
  });

  describe('get', () => {
    it('should get queue config', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/queues/my-queue', () => {
          return HttpResponse.json({
            id: 'config_123',
            organization_id: 'org_123',
            queue_name: 'my-queue',
            max_retries: 3,
            default_timeout: 300,
            rate_limit: 100,
            enabled: true,
            settings: { custom: 'value' },
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const config = await client.queues.get('my-queue');

      expect(config.queueName).toBe('my-queue');
      expect(config.maxRetries).toBe(3);
      expect(config.rateLimit).toBe(100);
      expect(config.settings).toEqual({ custom: 'value' });
    });

    it('should URL-encode queue name', async () => {
      let requestUrl: string | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/queues/my%2Fqueue', ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({
            id: 'config_123',
            organization_id: 'org_123',
            queue_name: 'my/queue',
            max_retries: 3,
            default_timeout: 300,
            enabled: true,
            settings: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      await client.queues.get('my/queue');

      expect(requestUrl).toContain('my%2Fqueue');
    });
  });

  describe('updateConfig', () => {
    it('should update queue config', async () => {
      let receivedBody: any;
      server.use(
        http.put('https://api.spooled.cloud/api/v1/queues/my-queue/config', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'config_123',
            organization_id: 'org_123',
            queue_name: 'my-queue',
            max_retries: 5,
            default_timeout: 600,
            rate_limit: 200,
            enabled: true,
            settings: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const config = await client.queues.updateConfig('my-queue', {
        queueName: 'my-queue',
        maxRetries: 5,
        defaultTimeout: 600,
        rateLimit: 200,
      });

      expect(receivedBody.max_retries).toBe(5);
      expect(receivedBody.default_timeout).toBe(600);
      expect(config.maxRetries).toBe(5);
    });
  });

  describe('getStats', () => {
    it('should get queue stats', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/queues/my-queue/stats', () => {
          return HttpResponse.json({
            queue_name: 'my-queue',
            pending_jobs: 100,
            processing_jobs: 10,
            completed_jobs_24h: 1000,
            failed_jobs_24h: 50,
            avg_processing_time_ms: 1500,
            max_job_age_seconds: 3600,
            active_workers: 5,
          });
        })
      );

      const client = createClient();
      const stats = await client.queues.getStats('my-queue');

      expect(stats.queueName).toBe('my-queue');
      expect(stats.pendingJobs).toBe(100);
      expect(stats.activeWorkers).toBe(5);
    });
  });

  describe('pause', () => {
    it('should pause a queue', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/queues/my-queue/pause', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            queue_name: 'my-queue',
            paused: true,
            paused_at: '2024-01-01T00:00:00Z',
            reason: 'Maintenance',
          });
        })
      );

      const client = createClient();
      const result = await client.queues.pause('my-queue', 'Maintenance');

      expect(receivedBody.reason).toBe('Maintenance');
      expect(result.paused).toBe(true);
      expect(result.reason).toBe('Maintenance');
    });

    it('should pause without reason', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/queues/my-queue/pause', () => {
          return HttpResponse.json({
            queue_name: 'my-queue',
            paused: true,
            paused_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const result = await client.queues.pause('my-queue');

      expect(result.paused).toBe(true);
    });
  });

  describe('resume', () => {
    it('should resume a queue', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/queues/my-queue/resume', () => {
          return HttpResponse.json({
            queue_name: 'my-queue',
            resumed: true,
            paused_duration_secs: 3600,
          });
        })
      );

      const client = createClient();
      const result = await client.queues.resume('my-queue');

      expect(result.resumed).toBe(true);
      expect(result.pausedDurationSecs).toBe(3600);
    });
  });

  describe('delete', () => {
    it('should delete a queue', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/queues/my-queue', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.queues.delete('my-queue')).resolves.toBeUndefined();
    });
  });
});
