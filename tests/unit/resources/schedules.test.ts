/**
 * Schedules Resource tests
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

describe('SchedulesResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('create', () => {
    it('should create a schedule', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/schedules', () => {
          return HttpResponse.json({
            id: 'schedule_123',
            name: 'Daily Report',
            cron_expression: '0 0 9 * * *',
            next_run_at: '2024-01-02T09:00:00Z',
          });
        })
      );

      const client = createClient();
      const result = await client.schedules.create({
        name: 'Daily Report',
        cronExpression: '0 0 9 * * *',
        timezone: 'UTC',
        queueName: 'reports',
        payloadTemplate: { type: 'daily' },
      });

      expect(result.id).toBe('schedule_123');
      expect(result.name).toBe('Daily Report');
    });

    it('should send correct request body', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/schedules', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'schedule_123',
            name: 'Test',
            cron_expression: '* * * * * *',
          });
        })
      );

      const client = createClient();
      await client.schedules.create({
        name: 'Test',
        cronExpression: '* * * * * *',
        queueName: 'queue',
        payloadTemplate: { custom_key: 'preserved' },
        priority: 5,
        maxRetries: 3,
        timeoutSeconds: 600,
      });

      expect(receivedBody.name).toBe('Test');
      expect(receivedBody.cron_expression).toBe('* * * * * *');
      expect(receivedBody.queue_name).toBe('queue');
      expect(receivedBody.payload_template).toEqual({ custom_key: 'preserved' });
      expect(receivedBody.priority).toBe(5);
    });
  });

  describe('list', () => {
    it('should list schedules', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/schedules', () => {
          return HttpResponse.json([
            {
              id: 'schedule_1',
              organization_id: 'org_123',
              name: 'Schedule 1',
              cron_expression: '0 * * * * *',
              timezone: 'UTC',
              queue_name: 'q1',
              payload_template: {},
              priority: 0,
              max_retries: 3,
              timeout_seconds: 300,
              is_active: true,
              run_count: 100,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const schedules = await client.schedules.list();

      expect(schedules).toHaveLength(1);
      expect(schedules[0].name).toBe('Schedule 1');
      expect(schedules[0].isActive).toBe(true);
    });
  });

  describe('get', () => {
    it('should get a schedule', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/schedules/schedule_123', () => {
          return HttpResponse.json({
            id: 'schedule_123',
            organization_id: 'org_123',
            name: 'Daily Report',
            cron_expression: '0 0 9 * * *',
            timezone: 'America/New_York',
            queue_name: 'reports',
            payload_template: { type: 'daily' },
            priority: 5,
            max_retries: 3,
            timeout_seconds: 600,
            is_active: true,
            last_run_at: '2024-01-01T09:00:00Z',
            next_run_at: '2024-01-02T09:00:00Z',
            run_count: 50,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const schedule = await client.schedules.get('schedule_123');

      expect(schedule.id).toBe('schedule_123');
      expect(schedule.cronExpression).toBe('0 0 9 * * *');
      expect(schedule.timezone).toBe('America/New_York');
      expect(schedule.runCount).toBe(50);
    });
  });

  describe('update', () => {
    it('should update a schedule', async () => {
      server.use(
        http.put('https://api.spooled.cloud/api/v1/schedules/schedule_123', () => {
          return HttpResponse.json({
            id: 'schedule_123',
            organization_id: 'org_123',
            name: 'Updated Name',
            cron_expression: '0 0 8 * * *',
            timezone: 'UTC',
            queue_name: 'reports',
            payload_template: {},
            priority: 0,
            max_retries: 3,
            timeout_seconds: 300,
            is_active: true,
            run_count: 50,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T12:00:00Z',
          });
        })
      );

      const client = createClient();
      const schedule = await client.schedules.update('schedule_123', {
        name: 'Updated Name',
        cronExpression: '0 0 8 * * *',
      });

      expect(schedule.name).toBe('Updated Name');
    });
  });

  describe('delete', () => {
    it('should delete a schedule', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/schedules/schedule_123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.schedules.delete('schedule_123')).resolves.toBeUndefined();
    });
  });

  describe('pause', () => {
    it('should pause a schedule', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/schedules/schedule_123/pause', () => {
          return HttpResponse.json({
            id: 'schedule_123',
            organization_id: 'org_123',
            name: 'Test',
            cron_expression: '* * * * * *',
            timezone: 'UTC',
            queue_name: 'q',
            payload_template: {},
            priority: 0,
            max_retries: 3,
            timeout_seconds: 300,
            is_active: false,
            run_count: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const schedule = await client.schedules.pause('schedule_123');

      expect(schedule.isActive).toBe(false);
    });
  });

  describe('resume', () => {
    it('should resume a schedule', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/schedules/schedule_123/resume', () => {
          return HttpResponse.json({
            id: 'schedule_123',
            organization_id: 'org_123',
            name: 'Test',
            cron_expression: '* * * * * *',
            timezone: 'UTC',
            queue_name: 'q',
            payload_template: {},
            priority: 0,
            max_retries: 3,
            timeout_seconds: 300,
            is_active: true,
            run_count: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const schedule = await client.schedules.resume('schedule_123');

      expect(schedule.isActive).toBe(true);
    });
  });

  describe('trigger', () => {
    it('should trigger a schedule', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/schedules/schedule_123/trigger', () => {
          return HttpResponse.json({
            job_id: 'job_456',
            scheduled_at: '2024-01-01T12:00:00Z',
          });
        })
      );

      const client = createClient();
      const result = await client.schedules.trigger('schedule_123');

      expect(result.jobId).toBe('job_456');
      expect(result.scheduledAt).toBe('2024-01-01T12:00:00Z');
    });
  });

  describe('getHistory', () => {
    it('should get schedule history', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/schedules/schedule_123/history', () => {
          return HttpResponse.json([
            {
              id: 'run_1',
              schedule_id: 'schedule_123',
              job_id: 'job_1',
              status: 'completed',
              started_at: '2024-01-01T09:00:00Z',
              completed_at: '2024-01-01T09:01:00Z',
            },
            {
              id: 'run_2',
              schedule_id: 'schedule_123',
              job_id: 'job_2',
              status: 'failed',
              error_message: 'Timeout',
              started_at: '2024-01-02T09:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const history = await client.schedules.getHistory('schedule_123');

      expect(history).toHaveLength(2);
      expect(history[0].status).toBe('completed');
      expect(history[1].status).toBe('failed');
    });

    it('should pass limit parameter', async () => {
      let url: URL | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/schedules/schedule_123/history', ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json([]);
        })
      );

      const client = createClient();
      await client.schedules.getHistory('schedule_123', 5);

      expect(url?.searchParams.get('limit')).toBe('5');
    });
  });
});
