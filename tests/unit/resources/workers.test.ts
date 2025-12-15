/**
 * Workers Resource tests
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

describe('WorkersResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('list', () => {
    it('should list workers', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/workers', () => {
          return HttpResponse.json([
            {
              id: 'worker_1',
              queue_name: 'queue-1',
              hostname: 'host-1',
              status: 'healthy',
              current_jobs: 3,
              max_concurrency: 10,
              last_heartbeat: '2024-01-01T12:00:00Z',
            },
            {
              id: 'worker_2',
              queue_name: 'queue-2',
              hostname: 'host-2',
              status: 'degraded',
              current_jobs: 5,
              max_concurrency: 5,
              last_heartbeat: '2024-01-01T11:55:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const workers = await client.workers.list();

      expect(workers).toHaveLength(2);
      expect(workers[0].id).toBe('worker_1');
      expect(workers[0].status).toBe('healthy');
      expect(workers[1].status).toBe('degraded');
    });
  });

  describe('get', () => {
    it('should get a worker', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/workers/worker_123', () => {
          return HttpResponse.json({
            id: 'worker_123',
            organization_id: 'org_123',
            queue_name: 'my-queue',
            hostname: 'my-host',
            worker_type: 'nodejs',
            max_concurrency: 10,
            current_jobs: 5,
            status: 'healthy',
            last_heartbeat: '2024-01-01T12:00:00Z',
            metadata: { version: '1.0.9' },
            version: '1.0.9',
            registered_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const worker = await client.workers.get('worker_123');

      expect(worker.id).toBe('worker_123');
      expect(worker.queueName).toBe('my-queue');
      expect(worker.maxConcurrency).toBe(10);
      expect(worker.metadata).toEqual({ version: '1.0.9' });
    });
  });

  describe('register', () => {
    it('should register a worker', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/workers/register', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'worker_123',
            queue_name: 'my-queue',
            lease_duration_secs: 30,
            heartbeat_interval_secs: 10,
          });
        })
      );

      const client = createClient();
      const result = await client.workers.register({
        queueName: 'my-queue',
        hostname: 'my-host',
        workerType: 'nodejs',
        maxConcurrency: 10,
        metadata: { custom: 'data' },
        version: '1.0.9',
      });

      expect(receivedBody.queue_name).toBe('my-queue');
      expect(receivedBody.hostname).toBe('my-host');
      expect(receivedBody.max_concurrency).toBe(10);
      expect(receivedBody.metadata).toEqual({ custom: 'data' });

      expect(result.id).toBe('worker_123');
      expect(result.leaseDurationSecs).toBe(30);
      expect(result.heartbeatIntervalSecs).toBe(10);
    });
  });

  describe('heartbeat', () => {
    it('should send worker heartbeat', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/workers/worker_123/heartbeat', async ({ request }) => {
          receivedBody = await request.json();
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await client.workers.heartbeat('worker_123', {
        currentJobs: 5,
        status: 'healthy',
        metadata: { load: 0.5 },
      });

      expect(receivedBody.current_jobs).toBe(5);
      expect(receivedBody.status).toBe('healthy');
      expect(receivedBody.metadata).toEqual({ load: 0.5 });
    });
  });

  describe('deregister', () => {
    it('should deregister a worker', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/workers/worker_123/deregister', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.workers.deregister('worker_123')).resolves.toBeUndefined();
    });
  });
});
