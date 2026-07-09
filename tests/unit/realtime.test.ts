/**
 * Realtime client tests
 *
 * Covers behavior that does not require a live socket: message case
 * conversion, token-provider refresh on (re)connect, and log redaction.
 */

import { describe, it, expect } from 'vitest';
import {
  WebSocketRealtimeClient,
  redactToken,
  isAuthFailureEvent,
} from '../../src/realtime/websocket.js';
import { SseRealtimeClient } from '../../src/realtime/sse.js';
import { SpooledRealtime } from '../../src/realtime/index.js';
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

    it('maps the backend PascalCase event type to the dotted handler name', () => {
      // The real backend serializes `RealtimeEvent` with the PascalCase variant
      // name as `type` and nests fields under `data`. Before the fix this never
      // reached a `on('job.completed')` handler because dispatch keyed on the
      // raw `JobCompleted` name.
      const client = new WebSocketRealtimeClient(baseOptions);
      let received: any;
      let genericType: string | undefined;
      client.on('job.completed', (data) => {
        received = data;
      });
      client.onEvent((event) => {
        genericType = event.type;
      });

      (client as any).handleMessage(
        JSON.stringify({
          type: 'JobCompleted',
          data: {
            job_id: 'job_1',
            queue_name: 'emails',
            duration_ms: 42,
            timestamp: '2024-01-01T00:00:00Z',
            result: { some_key: 'value' },
          },
        })
      );

      expect(received).toBeDefined();
      expect(received.jobId).toBe('job_1');
      expect(received.queueName).toBe('emails');
      expect(received.durationMs).toBe(42);
      expect(received.result).toEqual({ some_key: 'value' });
      // The catch-all sees the normalized dotted name too.
      expect(genericType).toBe('job.completed');
    });
  });

  describe('subscribe/unsubscribe (no ack)', () => {
    it('resolves promptly without waiting for a server ack and sends the backend command shape', async () => {
      const sent: string[] = [];
      const client = new WebSocketRealtimeClient(baseOptions);
      // Simulate an open connection with a socket that records outbound frames.
      (client as any).state = 'connected';
      (client as any).ws = { send: (payload: string) => sent.push(payload) };

      // The server sends no subscribe ack; if the client waited for one this
      // would hang until the 500ms guard rejects and fails the test.
      await expect(
        Promise.race([
          client.subscribe({ queueName: 'emails' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('subscribe hung waiting for an ack')), 500)
          ),
        ])
      ).resolves.toBeUndefined();

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({ cmd: 'Subscribe', queue: 'emails' });
    });

    it('sends an Unsubscribe command with queue and job_id', async () => {
      const sent: string[] = [];
      const client = new WebSocketRealtimeClient(baseOptions);
      (client as any).state = 'connected';
      (client as any).ws = { send: (payload: string) => sent.push(payload) };

      await client.subscribe({ queueName: 'emails', jobId: 'job_9' });
      await client.unsubscribe({ queueName: 'emails', jobId: 'job_9' });

      expect(sent).toHaveLength(2);
      expect(JSON.parse(sent[0])).toEqual({ cmd: 'Subscribe', queue: 'emails', job_id: 'job_9' });
      expect(JSON.parse(sent[1])).toEqual({ cmd: 'Unsubscribe', queue: 'emails', job_id: 'job_9' });
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

    it('reuses the cached token on a normal (re)connect (forceRefresh=false)', async () => {
      const forceCalls: (boolean | undefined)[] = [];
      const client = new WebSocketRealtimeClient({
        ...baseOptions,
        tokenProvider: async (forceRefresh) => {
          forceCalls.push(forceRefresh);
          return 'tok';
        },
      });

      await (client as any).buildWsUrl();
      await (client as any).buildWsUrl();

      // No auth failure occurred, so the provider is never asked to force-refresh.
      expect(forceCalls).toEqual([false, false]);
    });

    it('forces exactly one refresh after an auth failure, then reverts', async () => {
      const forceCalls: (boolean | undefined)[] = [];
      const client = new WebSocketRealtimeClient({
        ...baseOptions,
        tokenProvider: async (forceRefresh) => {
          forceCalls.push(forceRefresh);
          return 'tok';
        },
      });

      // Simulate the ws `onerror` path for a rejected upgrade (HTTP 401).
      (client as any).options.debug('WebSocket error');
      const errorEvent = { message: 'Unexpected server response: 401' };
      if (isAuthFailureEvent(errorEvent)) {
        (client as any).authFailure = true;
      }

      await (client as any).buildWsUrl();
      await (client as any).buildWsUrl();

      // First reconnect forces a fresh token; the flag is cleared afterwards.
      expect(forceCalls).toEqual([true, false]);
    });
  });
});

describe('isAuthFailureEvent', () => {
  it('detects 401/403 from the error message text', () => {
    expect(isAuthFailureEvent({ message: 'Unexpected server response: 401' })).toBe(true);
    expect(isAuthFailureEvent({ error: { message: 'Unexpected server response: 403' } })).toBe(true);
  });

  it('detects a status/statusCode field', () => {
    expect(isAuthFailureEvent({ status: 401 })).toBe(true);
    expect(isAuthFailureEvent({ statusCode: 403 })).toBe(true);
  });

  it('returns false for non-auth errors and empty events', () => {
    expect(isAuthFailureEvent(null)).toBe(false);
    expect(isAuthFailureEvent({ message: 'Unexpected server response: 500' })).toBe(false);
    expect(isAuthFailureEvent({ message: 'network error' })).toBe(false);
  });
});

describe('debug option default (regression)', () => {
  // Regression for v1.0.29: SpooledRealtime forwards `debug: undefined` for any
  // client built without a debug logger (the normal case). The WS/SSE
  // constructors spread `...options` after their no-op default, so that
  // explicit undefined clobbered the no-op and connect() threw
  // "this.options.debug is not a function". debug must always be callable.
  const withoutDebug: RealtimeConnectionOptions = {
    baseUrl: 'https://api.spooled.cloud',
    wsUrl: 'wss://api.spooled.cloud',
    token: 'static_token',
  };

  it('WebSocket client: debug is a callable no-op when debug is omitted', () => {
    const client = new WebSocketRealtimeClient(withoutDebug);
    const debug = (client as any).options.debug;
    expect(typeof debug).toBe('function');
    // Calling it must not throw (this is what connect() does internally).
    expect(() => debug('hello', { meta: true })).not.toThrow();
  });

  it('WebSocket client: debug is callable even when debug is explicitly undefined', () => {
    // This mirrors exactly what SpooledRealtime passes down for a default client.
    const client = new WebSocketRealtimeClient({ ...withoutDebug, debug: undefined });
    const debug = (client as any).options.debug;
    expect(typeof debug).toBe('function');
    expect(() => debug('connecting')).not.toThrow();
  });

  it('SSE client: debug is a callable no-op when debug is omitted', () => {
    const client = new SseRealtimeClient(withoutDebug);
    const debug = (client as any).options.debug;
    expect(typeof debug).toBe('function');
    expect(() => debug('hello', { meta: true })).not.toThrow();
  });

  it('SSE client: debug is callable even when debug is explicitly undefined', () => {
    const client = new SseRealtimeClient({ ...withoutDebug, debug: undefined });
    const debug = (client as any).options.debug;
    expect(typeof debug).toBe('function');
    expect(() => debug('connecting')).not.toThrow();
  });

  it('SpooledRealtime wrapper (default WebSocket): underlying debug is callable without a debug option', () => {
    // Mirrors what SpooledClient.realtime() builds for a client with no debug
    // logger: baseUrl/wsUrl/token and no debug. The wrapper must not throw and
    // the underlying transport client's debug must be a callable no-op.
    const realtime = new SpooledRealtime({
      baseUrl: 'https://api.spooled.cloud',
      wsUrl: 'wss://api.spooled.cloud',
      token: 'static_token',
    });
    const debug = (realtime as any).client.options.debug;
    expect(typeof debug).toBe('function');
    expect(() => debug('connecting')).not.toThrow();
  });

  it('SpooledRealtime wrapper (SSE): underlying debug is callable without a debug option', () => {
    const realtime = new SpooledRealtime({
      type: 'sse',
      baseUrl: 'https://api.spooled.cloud',
      wsUrl: 'wss://api.spooled.cloud',
      token: 'static_token',
    });
    const debug = (realtime as any).client.options.debug;
    expect(typeof debug).toBe('function');
    expect(() => debug('connecting')).not.toThrow();
  });

  it('honors a user-supplied debug logger', () => {
    const calls: string[] = [];
    const client = new WebSocketRealtimeClient({
      ...withoutDebug,
      debug: (msg: string) => calls.push(msg),
    });
    (client as any).options.debug('logged');
    expect(calls).toEqual(['logged']);
  });
});

describe('reconnect option defaults (regression)', () => {
  // Same clobber bug class as debug: SpooledRealtime forwards autoReconnect and
  // the reconnect timings as possibly-undefined. A pre-spread default was
  // overwritten by that explicit undefined, so autoReconnect resolved to
  // undefined (falsy) — silently disabling reconnect despite the documented
  // default of true. Defaults must survive an explicit undefined.
  const base: RealtimeConnectionOptions = {
    baseUrl: 'https://api.spooled.cloud',
    wsUrl: 'wss://api.spooled.cloud',
    token: 'static_token',
  };

  for (const [name, make] of [
    ['WebSocket', (o: RealtimeConnectionOptions) => new WebSocketRealtimeClient(o)],
    ['SSE', (o: RealtimeConnectionOptions) => new SseRealtimeClient(o)],
  ] as const) {
    it(`${name}: autoReconnect defaults to true and timings are set when omitted`, () => {
      const opts = (make(base) as any).options;
      expect(opts.autoReconnect).toBe(true);
      expect(opts.maxReconnectAttempts).toBe(10);
      expect(opts.reconnectDelay).toBe(1000);
      expect(opts.maxReconnectDelay).toBe(30000);
    });

    it(`${name}: defaults survive explicit undefined (as SpooledRealtime forwards)`, () => {
      const opts = (make({
        ...base,
        autoReconnect: undefined,
        maxReconnectAttempts: undefined,
        reconnectDelay: undefined,
        maxReconnectDelay: undefined,
      }) as any).options;
      expect(opts.autoReconnect).toBe(true);
      expect(opts.maxReconnectAttempts).toBe(10);
    });

    it(`${name}: honors an explicit autoReconnect:false`, () => {
      const opts = (make({ ...base, autoReconnect: false }) as any).options;
      expect(opts.autoReconnect).toBe(false);
    });
  }
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
