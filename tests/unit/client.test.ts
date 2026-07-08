/**
 * Client tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  SpooledClient,
  createClient,
  decodeJwtExp,
  isJwtNearExpiry,
} from '../../src/client.js';
import type { LoginResponse } from '../../src/types/auth.js';

/** Build a syntactically valid JWT whose payload carries the given `exp` (seconds). */
function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

/** A login response whose access token expires `secondsFromNow` from now. */
function loginResponse(secondsFromNow: number, token?: string): LoginResponse {
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return {
    accessToken: token ?? makeJwt(exp),
    refreshToken: 'refresh_token',
    tokenType: 'Bearer',
    expiresIn: secondsFromNow,
    refreshExpiresIn: secondsFromNow * 2,
  };
}

// MSW server setup
const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('SpooledClient', () => {
  describe('constructor', () => {
    it('should create client with API key', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      expect(client).toBeInstanceOf(SpooledClient);
    });

    it('should create client with access token', () => {
      const client = new SpooledClient({ accessToken: 'jwt_token' });
      expect(client).toBeInstanceOf(SpooledClient);
    });

    it('should throw without auth', () => {
      expect(() => new SpooledClient({} as any)).toThrow('requires either apiKey or accessToken');
    });

    it('should throw with invalid API key format', () => {
      expect(() => new SpooledClient({ apiKey: 'invalid' })).toThrow('Invalid API key format');
    });
  });

  describe('resources', () => {
    it('should have all resource instances', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });

      expect(client.auth).toBeDefined();
      expect(client.jobs).toBeDefined();
      expect(client.queues).toBeDefined();
      expect(client.workers).toBeDefined();
      expect(client.schedules).toBeDefined();
      expect(client.workflows).toBeDefined();
      expect(client.webhooks).toBeDefined();
      expect(client.apiKeys).toBeDefined();
      expect(client.organizations).toBeDefined();
    });
  });

  describe('getConfig', () => {
    it('should return readonly config', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123', timeout: 60000 });
      const config = client.getConfig();

      expect(config.apiKey).toBe('sk_test_123');
      expect(config.timeout).toBe(60000);
    });
  });

  describe('circuit breaker', () => {
    it('should expose circuit breaker stats', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const stats = client.getCircuitBreakerStats();

      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('failureCount');
    });

    it('should allow resetting circuit breaker', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      expect(() => client.resetCircuitBreaker()).not.toThrow();
    });
  });

  describe('withOptions', () => {
    it('should create new client with merged options', () => {
      const client = new SpooledClient({ apiKey: 'sk_test_123', timeout: 30000 });
      const newClient = client.withOptions({ timeout: 60000 });

      expect(newClient.getConfig().timeout).toBe(60000);
      expect(client.getConfig().timeout).toBe(30000); // Original unchanged
    });
  });

  describe('API calls', () => {
    it('should make authenticated requests', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', ({ request }) => {
          const auth = request.headers.get('Authorization');
          if (auth !== 'Bearer sk_test_123') {
            return HttpResponse.json({ code: 'UNAUTHORIZED', message: 'Unauthorized' }, { status: 401 });
          }
          return HttpResponse.json([]);
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const jobs = await client.jobs.list();
      expect(jobs).toEqual([]);
    });

    it('should convert response from snake_case to camelCase', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/job_123', () => {
          return HttpResponse.json({
            id: 'job_123',
            queue_name: 'my-queue',
            created_at: '2024-01-01T00:00:00Z',
            max_retries: 3,
            retry_count: 0,
            payload: { some_key: 'value' },
          });
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      const job = await client.jobs.get('job_123');

      expect(job.queueName).toBe('my-queue');
      expect(job.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(job.maxRetries).toBe(3);
      // Payload should NOT be converted
      expect(job.payload).toEqual({ some_key: 'value' });
    });

    it('should convert request from camelCase to snake_case', async () => {
      let receivedBody: any;

      server.use(
        http.post('https://api.spooled.cloud/api/v1/jobs', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ id: 'job_123', created: true });
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      await client.jobs.create({
        queueName: 'my-queue',
        maxRetries: 5,
        payload: { myData: 'value' },
      });

      expect(receivedBody.queue_name).toBe('my-queue');
      expect(receivedBody.max_retries).toBe(5);
      // Payload should NOT be converted
      expect(receivedBody.payload).toEqual({ myData: 'value' });
    });

    it('should handle errors', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs/nonexistent', () => {
          return HttpResponse.json(
            { code: 'NOT_FOUND', message: 'Job not found' },
            { status: 404 }
          );
        })
      );

      const client = new SpooledClient({ apiKey: 'sk_test_123' });
      await expect(client.jobs.get('nonexistent')).rejects.toThrow('Job not found');
    });
  });
});

describe('realtime JWT caching (getJwtToken)', () => {
  // The realtime layer requests a token on every (re)connect. Before caching,
  // each call re-logged-in via POST /auth/login, so a reconnect storm tripped
  // the login rate limit (429) and realtime could never recover. The token
  // provider must reuse a cached JWT until it nears expiry.

  it('logs in only once when called twice within the token lifetime', async () => {
    const client = new SpooledClient({ apiKey: 'sk_test_123' });
    // Token valid for an hour — well outside the 60s near-expiry window.
    const loginSpy = vi.spyOn(client.auth, 'login').mockResolvedValue(loginResponse(3600));

    const first = await (client as any).getJwtToken();
    const second = await (client as any).getJwtToken();

    expect(loginSpy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-logs-in when the cached token is near expiry', async () => {
    const client = new SpooledClient({ apiKey: 'sk_test_123' });
    // 30s of remaining life is inside the 60s skew, so the cached token is
    // always considered expiring and each call must mint a new one.
    const loginSpy = vi
      .spyOn(client.auth, 'login')
      .mockResolvedValueOnce(loginResponse(30, makeJwt(Math.floor(Date.now() / 1000) + 30)))
      .mockResolvedValueOnce(loginResponse(3600, 'second.token.value'));

    await (client as any).getJwtToken();
    const second = await (client as any).getJwtToken();

    expect(loginSpy).toHaveBeenCalledTimes(2);
    expect(second).toBe('second.token.value');
  });

  it('re-logs-in when forceRefresh is requested even if the cache is fresh', async () => {
    const client = new SpooledClient({ apiKey: 'sk_test_123' });
    const loginSpy = vi
      .spyOn(client.auth, 'login')
      .mockResolvedValueOnce(loginResponse(3600))
      .mockResolvedValueOnce(loginResponse(3600, 'forced.token.value'));

    await (client as any).getJwtToken();
    const forced = await (client as any).getJwtToken(true);

    expect(loginSpy).toHaveBeenCalledTimes(2);
    expect(forced).toBe('forced.token.value');
  });

  it('deduplicates concurrent logins into a single request', async () => {
    const client = new SpooledClient({ apiKey: 'sk_test_123' });
    const loginSpy = vi.spyOn(client.auth, 'login').mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(loginResponse(3600)), 10))
    );

    const [a, b] = await Promise.all([
      (client as any).getJwtToken(),
      (client as any).getJwtToken(),
    ]);

    expect(loginSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });
});

describe('JWT expiry decoding', () => {
  it('decodeJwtExp reads the exp claim without verification', () => {
    const exp = Math.floor(Date.now() / 1000) + 100;
    expect(decodeJwtExp(makeJwt(exp))).toBe(exp);
  });

  it('decodeJwtExp returns null for a malformed token', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeNull();
    expect(decodeJwtExp('a.b.c')).toBeNull();
  });

  it('isJwtNearExpiry is false for a token far from expiry', () => {
    expect(isJwtNearExpiry(makeJwt(Math.floor(Date.now() / 1000) + 3600))).toBe(false);
  });

  it('isJwtNearExpiry is true within the skew window and for undecodable tokens', () => {
    expect(isJwtNearExpiry(makeJwt(Math.floor(Date.now() / 1000) + 30))).toBe(true);
    expect(isJwtNearExpiry('garbage')).toBe(true);
  });
});

describe('createClient', () => {
  it('should be a factory function for SpooledClient', () => {
    const client = createClient({ apiKey: 'sk_test_123' });
    expect(client).toBeInstanceOf(SpooledClient);
  });
});
