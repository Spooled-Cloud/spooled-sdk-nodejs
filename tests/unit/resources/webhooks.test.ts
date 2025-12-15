/**
 * Webhooks Resource tests
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

describe('WebhooksResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('list', () => {
    it('should list webhooks', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/outgoing-webhooks', () => {
          return HttpResponse.json([
            {
              id: 'webhook_1',
              organization_id: 'org_123',
              name: 'Slack Webhook',
              url: 'https://hooks.slack.com/...',
              events: ['job.completed', 'job.failed'],
              enabled: true,
              failure_count: 0,
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const webhooks = await client.webhooks.list();

      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].name).toBe('Slack Webhook');
      expect(webhooks[0].events).toContain('job.completed');
    });
  });

  describe('create', () => {
    it('should create a webhook', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/outgoing-webhooks', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: 'webhook_123',
            organization_id: 'org_123',
            name: 'My Webhook',
            url: 'https://example.com/webhook',
            events: ['job.completed'],
            enabled: true,
            failure_count: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const webhook = await client.webhooks.create({
        name: 'My Webhook',
        url: 'https://example.com/webhook',
        events: ['job.completed'],
        secret: 'my-secret',
      });

      expect(receivedBody.name).toBe('My Webhook');
      expect(receivedBody.url).toBe('https://example.com/webhook');
      expect(receivedBody.secret).toBe('my-secret');
      expect(webhook.id).toBe('webhook_123');
    });
  });

  describe('get', () => {
    it('should get a webhook', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123', () => {
          return HttpResponse.json({
            id: 'webhook_123',
            organization_id: 'org_123',
            name: 'My Webhook',
            url: 'https://example.com/webhook',
            events: ['job.completed', 'job.failed'],
            enabled: true,
            failure_count: 2,
            last_triggered_at: '2024-01-01T12:00:00Z',
            last_status: 'success',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const webhook = await client.webhooks.get('webhook_123');

      expect(webhook.id).toBe('webhook_123');
      expect(webhook.failureCount).toBe(2);
      expect(webhook.lastStatus).toBe('success');
    });
  });

  describe('update', () => {
    it('should update a webhook', async () => {
      server.use(
        http.put('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123', () => {
          return HttpResponse.json({
            id: 'webhook_123',
            organization_id: 'org_123',
            name: 'Updated Webhook',
            url: 'https://example.com/webhook',
            events: ['job.completed'],
            enabled: false,
            failure_count: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T12:00:00Z',
          });
        })
      );

      const client = createClient();
      const webhook = await client.webhooks.update('webhook_123', {
        name: 'Updated Webhook',
        enabled: false,
      });

      expect(webhook.name).toBe('Updated Webhook');
      expect(webhook.enabled).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a webhook', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.webhooks.delete('webhook_123')).resolves.toBeUndefined();
    });
  });

  describe('test', () => {
    it('should test a webhook', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123/test', () => {
          return HttpResponse.json({
            success: true,
            status_code: 200,
            response_time_ms: 150,
          });
        })
      );

      const client = createClient();
      const result = await client.webhooks.test('webhook_123');

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.responseTimeMs).toBe(150);
    });

    it('should handle webhook test failure', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123/test', () => {
          return HttpResponse.json({
            success: false,
            status_code: 500,
            response_time_ms: 5000,
            error: 'Connection timeout',
          });
        })
      );

      const client = createClient();
      const result = await client.webhooks.test('webhook_123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('getDeliveries', () => {
    it('should get webhook deliveries', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/outgoing-webhooks/webhook_123/deliveries', () => {
          return HttpResponse.json([
            {
              id: 'delivery_1',
              webhook_id: 'webhook_123',
              event: 'job.completed',
              payload: { job_id: 'job_1' },
              status: 'success',
              status_code: 200,
              attempts: 1,
              created_at: '2024-01-01T12:00:00Z',
              delivered_at: '2024-01-01T12:00:01Z',
            },
            {
              id: 'delivery_2',
              webhook_id: 'webhook_123',
              event: 'job.failed',
              payload: { job_id: 'job_2' },
              status: 'failed',
              status_code: 500,
              error: 'Server error',
              attempts: 3,
              created_at: '2024-01-01T13:00:00Z',
            },
          ]);
        })
      );

      const client = createClient();
      const deliveries = await client.webhooks.getDeliveries('webhook_123');

      expect(deliveries).toHaveLength(2);
      expect(deliveries[0].status).toBe('success');
      expect(deliveries[1].status).toBe('failed');
      expect(deliveries[1].error).toBe('Server error');
    });
  });
});
