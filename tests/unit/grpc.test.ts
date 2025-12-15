/**
 * gRPC (HTTP gateway) tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient } from '../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('SpooledGrpcClient (HTTP gateway)', () => {
  const createClient = () =>
    new SpooledClient({
      apiKey: 'sk_test_123',
      baseUrl: 'https://api.spooled.cloud',
      grpcBaseUrl: 'https://grpc.spooled.cloud:50051',
    });

  it('should enqueue via /spooled.v1.QueueService/Enqueue on grpcBaseUrl', async () => {
    let requestUrl: string | undefined;
    let received: any;

    server.use(
      http.post('https://grpc.spooled.cloud:50051/spooled.v1.QueueService/Enqueue', async ({ request }) => {
        requestUrl = request.url;
        received = await request.json();
        return HttpResponse.json({ job_id: 'job_1', created: true });
      })
    );

    const client = createClient();
    const res = await client.grpc.queue.enqueue({
      queueName: 'emails',
      payload: { hello: 'world' },
      maxRetries: 3,
    });

    expect(requestUrl).toBe('https://grpc.spooled.cloud:50051/spooled.v1.QueueService/Enqueue');
    expect(received.queue_name).toBe('emails');
    expect(received.payload).toBe(JSON.stringify({ hello: 'world' }));
    expect(res.jobId).toBe('job_1');
    expect(res.created).toBe(true);
  });

  it('should dequeue via /spooled.v1.QueueService/Dequeue', async () => {
    let received: any;

    server.use(
      http.post('https://grpc.spooled.cloud:50051/spooled.v1.QueueService/Dequeue', async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({ job: null });
      })
    );

    const client = createClient();
    const res = await client.grpc.queue.dequeue({
      queueName: 'emails',
      workerId: 'worker_1',
      leaseDurationSeconds: 30,
    });

    expect(received.queue_name).toBe('emails');
    expect(received.worker_id).toBe('worker_1');
    expect(received.lease_duration_seconds).toBe(30);
    expect(res.job).toBeNull();
  });
});
