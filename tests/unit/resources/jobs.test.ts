/**
 * Jobs Resource tests
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

describe('JobsResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('create', () => {
    it('should create a job', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs', () => {
          return HttpResponse.json({ id: 'job_123', created: true });
        })
      );

      const client = createClient();
      const result = await client.jobs.create({
        queueName: 'my-queue',
        payload: { message: 'hello' },
      });

      expect(result.id).toBe('job_123');
      expect(result.created).toBe(true);
    });

    it('should send correct request body', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ id: 'job_123', created: true });
        })
      );

      const client = createClient();
      await client.jobs.create({
        queueName: 'my-queue',
        payload: { message: 'hello' },
        priority: 5,
        maxRetries: 3,
        timeoutSeconds: 300,
        tags: { env: 'test' },
      });

      expect(receivedBody.queue_name).toBe('my-queue');
      expect(receivedBody.payload).toEqual({ message: 'hello' });
      expect(receivedBody.priority).toBe(5);
      expect(receivedBody.max_retries).toBe(3);
      expect(receivedBody.timeout_seconds).toBe(300);
      expect(receivedBody.tags).toEqual({ env: 'test' });
    });
  });

  describe('get', () => {
    it('should get a job by ID', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/job_123', () => {
          return HttpResponse.json({
            id: 'job_123',
            queue_name: 'my-queue',
            status: 'pending',
            payload: { data: 'value' },
            created_at: '2024-01-01T00:00:00Z',
            retry_count: 0,
            max_retries: 3,
            priority: 0,
            timeout_seconds: 300,
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const job = await client.jobs.get('job_123');

      expect(job.id).toBe('job_123');
      expect(job.queueName).toBe('my-queue');
      expect(job.status).toBe('pending');
      expect(job.payload).toEqual({ data: 'value' });
    });
  });

  describe('list', () => {
    it('should list jobs', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', () => {
          return HttpResponse.json([
            { id: 'job_1', queue_name: 'q1', status: 'pending', priority: 0, retry_count: 0, created_at: '2024-01-01T00:00:00Z' },
            { id: 'job_2', queue_name: 'q2', status: 'completed', priority: 5, retry_count: 1, created_at: '2024-01-01T00:00:00Z' },
          ]);
        })
      );

      const client = createClient();
      const jobs = await client.jobs.list();

      expect(jobs).toHaveLength(2);
      expect(jobs[0].id).toBe('job_1');
      expect(jobs[1].queueName).toBe('q2');
    });

    it('should pass filter parameters', async () => {
      let url: URL | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json([]);
        })
      );

      const client = createClient();
      await client.jobs.list({ queueName: 'my-queue', status: 'pending', limit: 10 });

      expect(url?.searchParams.get('queue_name')).toBe('my-queue');
      expect(url?.searchParams.get('status')).toBe('pending');
      expect(url?.searchParams.get('limit')).toBe('10');
    });
  });

  describe('cancel', () => {
    it('should cancel a job', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/jobs/job_123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.jobs.cancel('job_123')).resolves.toBeUndefined();
    });
  });

  describe('retry', () => {
    it('should retry a job', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/job_123/retry', () => {
          return HttpResponse.json({
            id: 'job_123',
            status: 'pending',
            queue_name: 'my-queue',
            retry_count: 1,
            max_retries: 3,
            payload: {},
            priority: 0,
            timeout_seconds: 300,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const job = await client.jobs.retry('job_123');

      expect(job.status).toBe('pending');
      expect(job.retryCount).toBe(1);
    });
  });

  describe('boostPriority', () => {
    it('should boost job priority', async () => {
      server.use(
        http.put('https://api.spooled.cloud/api/v1/jobs/job_123/priority', () => {
          return HttpResponse.json({
            job_id: 'job_123',
            old_priority: 0,
            new_priority: 10,
          });
        })
      );

      const client = createClient();
      const result = await client.jobs.boostPriority('job_123', 10);

      expect(result.oldPriority).toBe(0);
      expect(result.newPriority).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should get job statistics', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/stats', () => {
          return HttpResponse.json({
            pending: 100,
            scheduled: 10,
            processing: 5,
            completed: 1000,
            failed: 50,
            deadletter: 5,
            cancelled: 10,
            total: 1180,
          });
        })
      );

      const client = createClient();
      const stats = await client.jobs.getStats();

      expect(stats.pending).toBe(100);
      expect(stats.completed).toBe(1000);
      expect(stats.total).toBe(1180);
    });
  });

  describe('batchStatus', () => {
    it('should get batch status', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/status', ({ request }) => {
          const url = new URL(request.url);
          const ids = url.searchParams.get('ids');
          expect(ids).toBe('job_1,job_2,job_3');
          return HttpResponse.json([
            { id: 'job_1', status: 'pending', queue_name: 'q', retry_count: 0, created_at: '2024-01-01T00:00:00Z' },
            { id: 'job_2', status: 'completed', queue_name: 'q', retry_count: 0, created_at: '2024-01-01T00:00:00Z' },
            { id: 'job_3', status: 'failed', queue_name: 'q', retry_count: 3, created_at: '2024-01-01T00:00:00Z' },
          ]);
        })
      );

      const client = createClient();
      const statuses = await client.jobs.batchStatus(['job_1', 'job_2', 'job_3']);

      expect(statuses).toHaveLength(3);
      expect(statuses[0].status).toBe('pending');
      expect(statuses[1].status).toBe('completed');
      expect(statuses[2].status).toBe('failed');
    });

    it('should return empty for empty input', async () => {
      const client = createClient();
      const statuses = await client.jobs.batchStatus([]);
      expect(statuses).toHaveLength(0);
    });

    it('should throw for more than 100 IDs', async () => {
      const client = createClient();
      const ids = Array(101).fill('job_id');
      await expect(client.jobs.batchStatus(ids)).rejects.toThrow('Maximum 100 job IDs');
    });
  });

  describe('bulkEnqueue', () => {
    it('should bulk enqueue jobs', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/bulk', () => {
          return HttpResponse.json({
            succeeded: [
              { index: 0, job_id: 'job_1', created: true },
              { index: 1, job_id: 'job_2', created: true },
            ],
            failed: [],
            total: 2,
            success_count: 2,
            failure_count: 0,
          });
        })
      );

      const client = createClient();
      const result = await client.jobs.bulkEnqueue({
        queueName: 'my-queue',
        jobs: [{ payload: { n: 1 } }, { payload: { n: 2 } }],
      });

      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(result.succeeded).toHaveLength(2);
    });
  });

  describe('claim', () => {
    it('should claim jobs', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/claim', () => {
          return HttpResponse.json({
            jobs: [
              {
                id: 'job_123',
                queue_name: 'my-queue',
                payload: { data: 'value' },
                retry_count: 0,
                max_retries: 3,
                timeout_seconds: 300,
              },
            ],
          });
        })
      );

      const client = createClient();
      const result = await client.jobs.claim({
        queueName: 'my-queue',
        workerId: 'worker_123',
        limit: 1,
      });

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].id).toBe('job_123');
    });
  });

  describe('complete', () => {
    it('should complete a job', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/job_123/complete', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const client = createClient();
      const result = await client.jobs.complete('job_123', {
        workerId: 'worker_123',
        result: { output: 'done' },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('fail', () => {
    it('should fail a job', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/job_123/fail', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const client = createClient();
      const result = await client.jobs.fail('job_123', {
        workerId: 'worker_123',
        error: 'Something went wrong',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('heartbeat', () => {
    it('should send job heartbeat', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/job_123/heartbeat', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const client = createClient();
      const result = await client.jobs.heartbeat('job_123', {
        workerId: 'worker_123',
        leaseDurationSecs: 30,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('dlq', () => {
    it('should list DLQ jobs', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/dlq', () => {
          return HttpResponse.json([
            { id: 'job_1', queue_name: 'q', status: 'deadletter', priority: 0, retry_count: 3, created_at: '2024-01-01T00:00:00Z' },
          ]);
        })
      );

      const client = createClient();
      const jobs = await client.jobs.dlq.list();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('deadletter');
    });

    it('should retry DLQ jobs', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/dlq/retry', () => {
          return HttpResponse.json({
            retried_count: 5,
            retried_jobs: ['job_1', 'job_2', 'job_3', 'job_4', 'job_5'],
          });
        })
      );

      const client = createClient();
      const result = await client.jobs.dlq.retry({ limit: 5 });

      expect(result.retriedCount).toBe(5);
      expect(result.retriedJobs).toHaveLength(5);
    });

    it('should purge DLQ', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs/dlq/purge', () => {
          return HttpResponse.json({ purged_count: 10 });
        })
      );

      const client = createClient();
      const result = await client.jobs.dlq.purge({ confirm: true });

      expect(result.purgedCount).toBe(10);
    });
  });
});
