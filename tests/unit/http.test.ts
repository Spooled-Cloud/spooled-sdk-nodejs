/**
 * HTTP Client tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createHttpClient } from '../../src/utils/http.js';
import { createCircuitBreaker } from '../../src/utils/circuit-breaker.js';
import { resolveConfig } from '../../src/config.js';
import { ValidationError, ServerError } from '../../src/errors.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('HttpClient', () => {
  const createClient = (options = {}) => {
    const config = resolveConfig({ apiKey: 'sk_test_123', ...options });
    const circuitBreaker = createCircuitBreaker(config.circuitBreaker);
    return createHttpClient(config, circuitBreaker);
  };

  describe('request methods', () => {
    it('should make GET request', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', () => {
          return HttpResponse.json({ success: true });
        })
      );

      const client = createClient();
      const result = await client.get<{ success: boolean }>('/test');
      expect(result.success).toBe(true);
    });

    it('should make POST request with body', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/test', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ id: '123' });
        })
      );

      const client = createClient();
      const result = await client.post<{ id: string }>('/test', { data: 'value' });
      
      expect(result.id).toBe('123');
      expect(receivedBody.data).toBe('value');
    });

    it('should make PUT request', async () => {
      server.use(
        http.put('https://api.spooled.cloud/api/v1/test/123', () => {
          return HttpResponse.json({ updated: true });
        })
      );

      const client = createClient();
      const result = await client.put<{ updated: boolean }>('/test/123', { name: 'new' });
      expect(result.updated).toBe(true);
    });

    it('should make PATCH request', async () => {
      server.use(
        http.patch('https://api.spooled.cloud/api/v1/test/123', () => {
          return HttpResponse.json({ patched: true });
        })
      );

      const client = createClient();
      const result = await client.patch<{ patched: boolean }>('/test/123', { field: 'value' });
      expect(result.patched).toBe(true);
    });

    it('should make DELETE request', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/test/123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.delete('/test/123')).resolves.toBeUndefined();
    });
  });

  describe('authentication', () => {
    it('should include Authorization header', async () => {
      let authHeader: string | null;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          authHeader = request.headers.get('Authorization');
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/test');
      
      expect(authHeader).toBe('Bearer sk_test_123');
    });

    it('should allow updating auth token', async () => {
      let authHeader: string | null;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          authHeader = request.headers.get('Authorization');
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      client.setAuthToken('new_token');
      await client.get('/test');
      
      expect(authHeader).toBe('Bearer new_token');
    });
  });

  describe('query parameters', () => {
    it('should append query parameters', async () => {
      let url: URL | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/test', { params: { limit: 10, offset: 0 } });
      
      expect(url?.searchParams.get('limit')).toBe('10');
      expect(url?.searchParams.get('offset')).toBe('0');
    });

    it('should convert camelCase params to snake_case', async () => {
      let url: URL | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/test', { params: { queueName: 'my-queue', maxRetries: 3 } });
      
      expect(url?.searchParams.get('queue_name')).toBe('my-queue');
      expect(url?.searchParams.get('max_retries')).toBe('3');
    });

    it('should filter undefined params', async () => {
      let url: URL | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/test', { params: { limit: 10, status: undefined } });
      
      expect(url?.searchParams.get('limit')).toBe('10');
      expect(url?.searchParams.has('status')).toBe(false);
    });
  });

  describe('case conversion', () => {
    it('should convert request body from camelCase to snake_case', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/test', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.post('/test', { queueName: 'test', maxRetries: 3 });
      
      expect(receivedBody.queue_name).toBe('test');
      expect(receivedBody.max_retries).toBe(3);
    });

    it('should convert response from snake_case to camelCase', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', () => {
          return HttpResponse.json({ queue_name: 'test', max_retries: 3 });
        })
      );

      const client = createClient();
      const result = await client.get<{ queueName: string; maxRetries: number }>('/test');
      
      expect(result.queueName).toBe('test');
      expect(result.maxRetries).toBe(3);
    });

    it('should skip conversion when requested', async () => {
      let receivedBody: any;
      server.use(
        http.post('https://api.spooled.cloud/api/v1/test', async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({ custom_field: 'value' });
        })
      );

      const client = createClient();
      const response = await client.request<{ custom_field: string }>('/test', {
        method: 'POST',
        body: { customField: 'value' },
        skipRequestConversion: true,
        skipResponseConversion: true,
      });
      
      expect(receivedBody.customField).toBe('value'); // Not converted
      expect(response.data.custom_field).toBe('value'); // Not converted
    });
  });

  describe('error handling', () => {
    it('should throw ValidationError for 400', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', () => {
          return HttpResponse.json(
            { code: 'INVALID_INPUT', message: 'Invalid request' },
            { status: 400 }
          );
        })
      );

      const client = createClient();
      await expect(client.get('/test')).rejects.toThrow(ValidationError);
    });

    it('should throw ServerError for 500', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', () => {
          return HttpResponse.json(
            { code: 'INTERNAL_ERROR', message: 'Server error' },
            { status: 500 }
          );
        })
      );

      const client = createClient();
      await expect(client.get('/test')).rejects.toThrow(ServerError);
    });
  });

  describe('headers', () => {
    it('should include custom headers', async () => {
      let customHeader: string | null;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          customHeader = request.headers.get('X-Custom-Header');
          return HttpResponse.json({});
        })
      );

      const client = createClient({ headers: { 'X-Custom-Header': 'custom-value' } });
      await client.get('/test');
      
      expect(customHeader).toBe('custom-value');
    });

    it('should include User-Agent header', async () => {
      let userAgent: string | null;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/test', ({ request }) => {
          userAgent = request.headers.get('User-Agent');
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/test');
      
      expect(userAgent).toContain('@spooled/sdk');
    });
  });

  describe('URL building', () => {
    it('should prepend /api/v1 to paths', async () => {
      let requestUrl: string | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/jobs');
      
      expect(requestUrl).toBe('https://api.spooled.cloud/api/v1/jobs');
    });

    it('should not double prepend /api/v1', async () => {
      let requestUrl: string | undefined;
      server.use(
        http.get('https://api.spooled.cloud/api/v1/jobs', ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({});
        })
      );

      const client = createClient();
      await client.get('/api/v1/jobs');
      
      expect(requestUrl).toBe('https://api.spooled.cloud/api/v1/jobs');
    });
  });
});
