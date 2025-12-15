/**
 * Health and Metrics tests
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

describe('HealthResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123', baseUrl: 'https://api.spooled.cloud' });

  it('should fetch /health without /api/v1 prefix', async () => {
    server.use(
      http.get('https://api.spooled.cloud/health', () => {
        return HttpResponse.json({ status: 'healthy', database: true, cache: true });
      })
    );

    const client = createClient();
    const res = await client.health.get();
    expect(res.status).toBe('healthy');
    expect(res.database).toBe(true);
  });

  it('should return true for liveness 200', async () => {
    server.use(http.get('https://api.spooled.cloud/health/live', () => new HttpResponse('', { status: 200 })));

    const client = createClient();
    await expect(client.health.liveness()).resolves.toBe(true);
  });

  it('should return false for readiness 503', async () => {
    server.use(http.get('https://api.spooled.cloud/health/ready', () => new HttpResponse('', { status: 503 })));

    const client = createClient();
    await expect(client.health.readiness()).resolves.toBe(false);
  });
});

describe('MetricsResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123', baseUrl: 'https://api.spooled.cloud' });

  it('should fetch /metrics as text', async () => {
    server.use(
      http.get('https://api.spooled.cloud/metrics', () => {
        return new HttpResponse('# HELP x\n# TYPE x counter\nx 1\n', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; version=0.0.4' },
        });
      })
    );

    const client = createClient();
    const text = await client.metrics.get();
    expect(text).toContain('# HELP');
    expect(text).toContain('x 1');
  });
});
