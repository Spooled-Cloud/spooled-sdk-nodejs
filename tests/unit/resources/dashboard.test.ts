/**
 * Dashboard Resource tests
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

describe('DashboardResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  it('should fetch dashboard data', async () => {
    server.use(
      http.get('https://api.spooled.cloud/api/v1/dashboard', () => {
        return HttpResponse.json({
          system: {
            version: '1.0.0',
            uptime_seconds: 123,
            started_at: '2025-01-01T00:00:00Z',
            database_status: 'healthy',
            cache_status: 'healthy',
            environment: 'production',
          },
          jobs: {
            total: 1000,
            pending: 10,
            processing: 2,
            completed_24h: 900,
            failed_24h: 5,
            deadletter: 1,
            avg_wait_time_ms: 12.5,
            avg_processing_time_ms: 150.0,
          },
          queues: [{ name: 'emails', pending: 10, processing: 2, paused: false }],
          workers: { total: 3, healthy: 2, unhealthy: 1 },
          recent_activity: { jobs_created_1h: 50, jobs_completed_1h: 40, jobs_failed_1h: 2 },
        });
      })
    );

    const client = createClient();
    const data = await client.dashboard.get();

    expect(data.system.uptimeSeconds).toBe(123);
    expect(data.jobs.completed24h).toBe(900);
    expect(data.queues[0].name).toBe('emails');
    expect(data.recentActivity.jobsCreated1h).toBe(50);
  });
});
