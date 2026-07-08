/**
 * Realtime client tests
 *
 * Covers behavior that does not require a live socket: message case
 * conversion, token-provider refresh on (re)connect, and log redaction.
 */

import { describe, it, expect } from 'vitest';
import { WebSocketRealtimeClient, redactToken } from '../../src/realtime/websocket.js';
import { SseRealtimeClient } from '../../src/realtime/sse.js';
import type { RealtimeConnectionOptions } from '../../src/realtime/types.js';

const baseOptions: RealtimeConnectionOptions = {
  baseUrl: 'https://api.spooled.cloud',
  wsUrl: 'wss://api.spooled.cloud',
  token: 'static_token',
};

describe('WebSocketRealtimeClient', () => {
  describe('message conversion', () => {
    it('should convert snake_case event data to camelCase before dispatch', () => {
      const client = new WebSocketRealtimeClient(baseOptions);
      let received: any;
      client.on('job.completed', (data) => {
        received = data;
      });

      // Simulate an inbound message (backend emits snake_case).
      (client as any).handleMessage(
        JSON.stringify({
          type: 'job.completed',
          timestamp: '2024-01-01T00:00:00Z',
          data: {
            job_id: 'job_1',
            queue_name: 'my-queue',
            duration_ms: 42,
            result: { some_key: 'value' },
          },
        })
      );

      expect(received.jobId).toBe('job_1');
      expect(received.queueName).toBe('my-queue');
      expect(received.durationMs).toBe(42);
      // User blob preserved byte-for-byte.
      expect(received.result).toEqual({ some_key: 'value' });
    });
  });

  describe('token provider', () => {
    it('should mint a fresh token for each (re)connect via buildWsUrl', async () => {
      let counter = 0;
      const client = new WebSocketRealtimeClient({
        ...baseOptions,
        tokenProvider: async () => `token_${++counter}`,
      });

      const url1 = await (client as any).buildWsUrl();
      const url2 = await (client as any).buildWsUrl();

      expect(url1).toContain('token=token_1');
      expect(url2).toContain('token=token_2');
    });

    it('should fall back to the static token when no provider is supplied', async () => {
      const client = new WebSocketRealtimeClient(baseOptions);
      const url = await (client as any).buildWsUrl();
      expect(url).toContain('token=static_token');
    });
  });
});

describe('redactToken', () => {
  it('should redact the token query param', () => {
    const url = 'wss://api.spooled.cloud/api/v1/ws?token=secret.jwt.value';
    expect(redactToken(url)).toBe('wss://api.spooled.cloud/api/v1/ws?token=***');
  });

  it('should redact api_key too and preserve other params', () => {
    const url = 'https://api.spooled.cloud/api/v1/events?api_key=sp_live_abc&foo=bar';
    expect(redactToken(url)).toBe('https://api.spooled.cloud/api/v1/events?api_key=***&foo=bar');
  });
});

describe('SseRealtimeClient', () => {
  it('should convert snake_case event data to camelCase before dispatch', () => {
    const client = new SseRealtimeClient(baseOptions);
    let received: any;
    client.on('job.failed', (data) => {
      received = data;
    });

    (client as any).handleMessage(
      JSON.stringify({
        type: 'job.failed',
        timestamp: '2024-01-01T00:00:00Z',
        data: {
          job_id: 'job_2',
          queue_name: 'my-queue',
          error: 'boom',
          retry_count: 1,
          will_retry: true,
        },
      })
    );

    expect(received.jobId).toBe('job_2');
    expect(received.queueName).toBe('my-queue');
    expect(received.retryCount).toBe(1);
    expect(received.willRetry).toBe(true);
  });
});
