/**
 * HTTP Client tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createHttpClient } from "../../src/utils/http.js";
import { createCircuitBreaker } from "../../src/utils/circuit-breaker.js";
import { resolveConfig } from "../../src/config.js";
import { ValidationError, ServerError } from "../../src/errors.js";

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("HttpClient", () => {
  const createClient = (options = {}) => {
    const config = resolveConfig({ apiKey: "sk_test_123", ...options });
    const circuitBreaker = createCircuitBreaker(config.circuitBreaker);
    return createHttpClient(config, circuitBreaker);
  };

  describe("request methods", () => {
    it("should make GET request", async () => {
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", () => {
          return HttpResponse.json({ success: true });
        }),
      );

      const client = createClient();
      const result = await client.get<{ success: boolean }>("/test");
      expect(result.success).toBe(true);
    });

    it("should make POST request with body", async () => {
      let receivedBody: any;
      server.use(
        http.post(
          "https://api.spooled.cloud/api/v1/test",
          async ({ request }) => {
            receivedBody = await request.json();
            return HttpResponse.json({ id: "123" });
          },
        ),
      );

      const client = createClient();
      const result = await client.post<{ id: string }>("/test", {
        data: "value",
      });

      expect(result.id).toBe("123");
      expect(receivedBody.data).toBe("value");
    });

    it("should make PUT request", async () => {
      server.use(
        http.put("https://api.spooled.cloud/api/v1/test/123", () => {
          return HttpResponse.json({ updated: true });
        }),
      );

      const client = createClient();
      const result = await client.put<{ updated: boolean }>("/test/123", {
        name: "new",
      });
      expect(result.updated).toBe(true);
    });

    it("should make PATCH request", async () => {
      server.use(
        http.patch("https://api.spooled.cloud/api/v1/test/123", () => {
          return HttpResponse.json({ patched: true });
        }),
      );

      const client = createClient();
      const result = await client.patch<{ patched: boolean }>("/test/123", {
        field: "value",
      });
      expect(result.patched).toBe(true);
    });

    it("should make DELETE request", async () => {
      server.use(
        http.delete("https://api.spooled.cloud/api/v1/test/123", () => {
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const client = createClient();
      await expect(client.delete("/test/123")).resolves.toBeUndefined();
    });
  });

  describe("authentication", () => {
    it("should include Authorization header", async () => {
      let authHeader: string | null;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          authHeader = request.headers.get("Authorization");
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/test");

      expect(authHeader).toBe("Bearer sk_test_123");
    });

    it("should allow updating auth token", async () => {
      let authHeader: string | null;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          authHeader = request.headers.get("Authorization");
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      client.setAuthToken("new_token");
      await client.get("/test");

      expect(authHeader).toBe("Bearer new_token");
    });
  });

  describe("query parameters", () => {
    it("should append query parameters", async () => {
      let url: URL | undefined;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/test", { params: { limit: 10, offset: 0 } });

      expect(url?.searchParams.get("limit")).toBe("10");
      expect(url?.searchParams.get("offset")).toBe("0");
    });

    it("should convert camelCase params to snake_case", async () => {
      let url: URL | undefined;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/test", {
        params: { queueName: "my-queue", maxRetries: 3 },
      });

      expect(url?.searchParams.get("queue_name")).toBe("my-queue");
      expect(url?.searchParams.get("max_retries")).toBe("3");
    });

    it("should filter undefined params", async () => {
      let url: URL | undefined;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          url = new URL(request.url);
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/test", { params: { limit: 10, status: undefined } });

      expect(url?.searchParams.get("limit")).toBe("10");
      expect(url?.searchParams.has("status")).toBe(false);
    });
  });

  describe("case conversion", () => {
    it("should convert request body from camelCase to snake_case", async () => {
      let receivedBody: any;
      server.use(
        http.post(
          "https://api.spooled.cloud/api/v1/test",
          async ({ request }) => {
            receivedBody = await request.json();
            return HttpResponse.json({});
          },
        ),
      );

      const client = createClient();
      await client.post("/test", { queueName: "test", maxRetries: 3 });

      expect(receivedBody.queue_name).toBe("test");
      expect(receivedBody.max_retries).toBe(3);
    });

    it("should convert response from snake_case to camelCase", async () => {
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", () => {
          return HttpResponse.json({ queue_name: "test", max_retries: 3 });
        }),
      );

      const client = createClient();
      const result = await client.get<{
        queueName: string;
        maxRetries: number;
      }>("/test");

      expect(result.queueName).toBe("test");
      expect(result.maxRetries).toBe(3);
    });

    it("should skip conversion when requested", async () => {
      let receivedBody: any;
      server.use(
        http.post(
          "https://api.spooled.cloud/api/v1/test",
          async ({ request }) => {
            receivedBody = await request.json();
            return HttpResponse.json({ custom_field: "value" });
          },
        ),
      );

      const client = createClient();
      const response = await client.request<{ custom_field: string }>("/test", {
        method: "POST",
        body: { customField: "value" },
        skipRequestConversion: true,
        skipResponseConversion: true,
      });

      expect(receivedBody.customField).toBe("value"); // Not converted
      expect(response.data.custom_field).toBe("value"); // Not converted
    });
  });

  describe("error handling", () => {
    it("should throw ValidationError for 400", async () => {
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", () => {
          return HttpResponse.json(
            { code: "INVALID_INPUT", message: "Invalid request" },
            { status: 400 },
          );
        }),
      );

      const client = createClient();
      await expect(client.get("/test")).rejects.toThrow(ValidationError);
    });

    it("should throw ServerError for 500", async () => {
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", () => {
          return HttpResponse.json(
            { code: "INTERNAL_ERROR", message: "Server error" },
            { status: 500 },
          );
        }),
      );

      const client = createClient();
      await expect(client.get("/test")).rejects.toThrow(ServerError);
    });
  });

  describe("retry idempotency", () => {
    it("should NOT retry a non-idempotent POST on 5xx", async () => {
      let calls = 0;
      server.use(
        http.post("https://api.spooled.cloud/api/v1/jobs", () => {
          calls++;
          return HttpResponse.json(
            { code: "INTERNAL", message: "boom" },
            { status: 500 },
          );
        }),
      );

      const client = createClient({ retries: 3, retryDelay: 1 });
      await expect(client.post("/jobs", { queueName: "q" })).rejects.toThrow(
        ServerError,
      );
      expect(calls).toBe(1); // no blind retry of a write
    });

    it("should retry an idempotent GET on 5xx", async () => {
      let calls = 0;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/jobs", () => {
          calls++;
          return HttpResponse.json(
            { code: "INTERNAL", message: "boom" },
            { status: 500 },
          );
        }),
      );

      const client = createClient({ retries: 2, retryDelay: 1 });
      await expect(client.get("/jobs")).rejects.toThrow(ServerError);
      expect(calls).toBe(3); // 1 initial + 2 retries
    });

    it("should retry a POST that carries an Idempotency-Key header", async () => {
      let calls = 0;
      server.use(
        http.post("https://api.spooled.cloud/api/v1/jobs", () => {
          calls++;
          if (calls < 2) {
            return HttpResponse.json(
              { code: "INTERNAL", message: "boom" },
              { status: 500 },
            );
          }
          return HttpResponse.json({ id: "job_1" });
        }),
      );

      const client = createClient({ retries: 3, retryDelay: 1 });
      const res = await client.request<{ id: string }>("/jobs", {
        method: "POST",
        body: { queueName: "q" },
        headers: { "Idempotency-Key": "abc-123" },
      });
      expect(res.data.id).toBe("job_1");
      expect(calls).toBe(2); // retried because it is safe
    });

    it("should retry a POST on 429 (rate limited, no side effect)", async () => {
      let calls = 0;
      server.use(
        http.post("https://api.spooled.cloud/api/v1/jobs", () => {
          calls++;
          if (calls < 2) {
            return HttpResponse.json(
              { code: "RATE_LIMIT", message: "slow down" },
              {
                status: 429,
                headers: { "Retry-After": "0" },
              },
            );
          }
          return HttpResponse.json({ id: "job_1" });
        }),
      );

      const client = createClient({ retries: 3, retryDelay: 1 });
      const result = await client.post<{ id: string }>("/jobs", {
        queueName: "q",
      });
      expect(result.id).toBe("job_1");
      expect(calls).toBe(2);
    });
  });

  describe("token refresh on 401", () => {
    it("should refresh the token once and retry the original request", async () => {
      let jobsCalls = 0;
      let refreshCalls = 0;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          jobsCalls++;
          if (request.headers.get("Authorization") === "Bearer new_token") {
            return HttpResponse.json({ ok: true });
          }
          return HttpResponse.json(
            { code: "TOKEN_EXPIRED", message: "expired" },
            { status: 401 },
          );
        }),
      );

      const client = createClient();
      client.setRefreshTokenFn(async () => {
        refreshCalls++;
        return "new_token";
      });

      const result = await client.get<{ ok: boolean }>("/test");
      expect(result.ok).toBe(true);
      expect(refreshCalls).toBe(1);
      expect(jobsCalls).toBe(2); // initial 401 + retry with refreshed token
    });

    it("should not loop when refresh does not fix the 401", async () => {
      let calls = 0;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", () => {
          calls++;
          return HttpResponse.json(
            { code: "TOKEN_EXPIRED", message: "expired" },
            { status: 401 },
          );
        }),
      );

      const client = createClient();
      client.setRefreshTokenFn(async () => "still_bad_token");

      await expect(client.get("/test")).rejects.toThrow();
      expect(calls).toBe(2); // one refresh + retry, then give up
    });
  });

  describe("headers", () => {
    it("should include custom headers", async () => {
      let customHeader: string | null;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          customHeader = request.headers.get("X-Custom-Header");
          return HttpResponse.json({});
        }),
      );

      const client = createClient({
        headers: { "X-Custom-Header": "custom-value" },
      });
      await client.get("/test");

      expect(customHeader).toBe("custom-value");
    });

    it("should include User-Agent header", async () => {
      let userAgent: string | null;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/test", ({ request }) => {
          userAgent = request.headers.get("User-Agent");
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/test");

      expect(userAgent).toContain("@spooled/sdk");
    });
  });

  describe("URL building", () => {
    it("should prepend /api/v1 to paths", async () => {
      let requestUrl: string | undefined;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/jobs", ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/jobs");

      expect(requestUrl).toBe("https://api.spooled.cloud/api/v1/jobs");
    });

    it("should not double prepend /api/v1", async () => {
      let requestUrl: string | undefined;
      server.use(
        http.get("https://api.spooled.cloud/api/v1/jobs", ({ request }) => {
          requestUrl = request.url;
          return HttpResponse.json({});
        }),
      );

      const client = createClient();
      await client.get("/api/v1/jobs");

      expect(requestUrl).toBe("https://api.spooled.cloud/api/v1/jobs");
    });
  });
});
