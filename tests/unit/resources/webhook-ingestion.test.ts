/**
 * Webhook Ingestion Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createHmac } from 'node:crypto';
import { SpooledClient } from '../../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('WebhookIngestionResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  it('should send raw body and computed GitHub signature', async () => {
    const orgId = 'org_123';
    const secret = 'github_secret';
    const payload = JSON.stringify({ action: 'opened', pull_request: { id: 1 } });

    let receivedBody = '';
    let signatureHeader: string | null = null;
    let eventHeader: string | null = null;

    server.use(
      http.post(`https://api.spooled.cloud/api/v1/webhooks/${orgId}/github`, async ({ request }) => {
        receivedBody = await request.text();
        signatureHeader = request.headers.get('X-Hub-Signature-256');
        eventHeader = request.headers.get('X-GitHub-Event');
        return new HttpResponse(null, { status: 200 });
      })
    );

    const expectedHex = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

    const client = createClient();
    await client.ingest.github(orgId, payload, {
      githubEvent: 'pull_request',
      secret,
    });

    expect(receivedBody).toBe(payload);
    expect(eventHeader).toBe('pull_request');
    expect(signatureHeader).toBe(`sha256=${expectedHex}`);
  });

  it('should send custom webhook JSON with case conversion and preserve payload', async () => {
    const orgId = 'org_123';

    let receivedBody: any;
    let tokenHeader: string | null = null;

    server.use(
      http.post(`https://api.spooled.cloud/api/v1/webhooks/${orgId}/custom`, async ({ request }) => {
        tokenHeader = request.headers.get('X-Webhook-Token');
        receivedBody = await request.json();
        return new HttpResponse(null, { status: 200 });
      })
    );

    const client = createClient();
    await client.ingest.custom(
      orgId,
      {
        queueName: 'custom_events',
        eventType: 'custom.event',
        idempotencyKey: 'evt_123',
        priority: 10,
        payload: { custom_key: 'preserved' },
      },
      { webhookToken: 'org_webhook_token' }
    );

    expect(tokenHeader).toBe('org_webhook_token');
    expect(receivedBody.queue_name).toBe('custom_events');
    expect(receivedBody.event_type).toBe('custom.event');
    expect(receivedBody.idempotency_key).toBe('evt_123');
    expect(receivedBody.priority).toBe(10);
    // payload is preserved (no deep conversion)
    expect(receivedBody.payload).toEqual({ custom_key: 'preserved' });
  });
});
