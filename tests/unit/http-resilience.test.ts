/**
 * HTTP resilience: ack retries, quota handling, single-flight token refresh,
 * and Content-Type on body-less requests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../src/client.js";
import { createHttpClient } from "../../src/utils/http.js";
import {
  CircuitState,
  createCircuitBreaker,
} from "../../src/utils/circuit-breaker.js";
import type { CircuitStateChange } from "../../src/utils/circuit-breaker.js";
import { resolveConfig } from "../../src/config.js";
import {
  AuthenticationError,
  CircuitBreakerOpenError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "../../src/errors.js";

const BASE = "https://api.spooled.cloud/api/v1";
const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

const fastRetry = { baseDelay: 1, maxDelay: 5, jitter: false };

function makeClient(options: Record<string, unknown> = {}): SpooledClient {
  return new SpooledClient({
    apiKey: "sk_test_123",
    retry: fastRetry,
    ...options,
  });
}

describe("ack retries (SDKNP-05)", () => {
  // eslint-disable-next-line no-unused-vars
  const acks: Array<[string, (c: SpooledClient) => Promise<unknown>, string]> =
    [
      [
        "jobs.complete",
        (c) => c.jobs.complete("job_1", { workerId: "w1" }),
        "/jobs/job_1/complete",
      ],
      [
        "jobs.fail",
        (c) => c.jobs.fail("job_1", { workerId: "w1", error: "boom" }),
        "/jobs/job_1/fail",
      ],
      [
        "jobs.heartbeat",
        (c) =>
          c.jobs.heartbeat("job_1", { workerId: "w1", leaseDurationSecs: 30 }),
        "/jobs/job_1/heartbeat",
      ],
      [
        "workers.heartbeat",
        (c) => c.workers.heartbeat("w1", { currentJobs: 1, status: "healthy" }),
        "/workers/w1/heartbeat",
      ],
    ];

  it.each(acks)(
    "%s retries a 502 and then succeeds",
    async (_n, call, path) => {
      let attempts = 0;
      server.use(
        http.post(`${BASE}${path}`, () => {
          attempts++;
          return attempts < 3
            ? HttpResponse.json(
                { code: "BAD_GATEWAY", message: "502" },
                { status: 502 },
              )
            : HttpResponse.json({ success: true });
        }),
      );

      await expect(call(makeClient())).resolves.not.toThrow();
      expect(attempts).toBe(3);
    },
  );

  it("retries a network error on complete", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs/job_1/complete`, () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.error();
        }
        return HttpResponse.json({ success: true });
      }),
    );

    await makeClient().jobs.complete("job_1", { workerId: "w1" });
    expect(attempts).toBe(2);
  });

  it("retries a 408 on complete", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs/job_1/complete`, () => {
        attempts++;
        return attempts === 1
          ? HttpResponse.json(
              { code: "REQUEST_TIMEOUT", message: "slow" },
              { status: 408 },
            )
          : HttpResponse.json({ success: true });
      }),
    );

    await makeClient().jobs.complete("job_1", { workerId: "w1" });
    expect(attempts).toBe(2);
  });

  it.each([400, 404, 409, 422])(
    "never retries a %i on complete",
    async (status) => {
      let attempts = 0;
      server.use(
        http.post(`${BASE}/jobs/job_1/complete`, () => {
          attempts++;
          return HttpResponse.json({ code: "X", message: "nope" }, { status });
        }),
      );

      await expect(
        makeClient().jobs.complete("job_1", { workerId: "w1" }),
      ).rejects.toBeTruthy();
      expect(attempts).toBe(1);
    },
  );

  it("is bounded by the configured retry budget", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs/job_1/complete`, () => {
        attempts++;
        return HttpResponse.json(
          { code: "BAD_GATEWAY", message: "502" },
          { status: 502 },
        );
      }),
    );

    await expect(
      makeClient({ retries: 2 }).jobs.complete("job_1", { workerId: "w1" }),
    ).rejects.toBeInstanceOf(ServerError);
    expect(attempts).toBe(3); // 1 + 2 retries
  });

  it("still does not retry job creation without an idempotency key", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs`, () => {
        attempts++;
        return HttpResponse.json(
          { code: "BAD_GATEWAY", message: "502" },
          { status: 502 },
        );
      }),
    );

    await expect(
      makeClient().jobs.create({ queueName: "q", payload: {} }),
    ).rejects.toBeInstanceOf(ServerError);
    expect(attempts).toBe(1);
  });

  it("retries job creation that carries an idempotencyKey (SDKNP-22)", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs`, () => {
        attempts++;
        return attempts === 1
          ? HttpResponse.json(
              { code: "BAD_GATEWAY", message: "502" },
              { status: 502 },
            )
          : HttpResponse.json({ id: "job_1", created: true });
      }),
    );

    const result = await makeClient().jobs.create({
      queueName: "q",
      payload: {},
      idempotencyKey: "order-1",
    });
    expect(result.id).toBe("job_1");
    expect(attempts).toBe(2);
  });
});

describe("jobs.fail text (item 4)", () => {
  async function failBody(error: string): Promise<{ error: string }> {
    let body: { error: string } | undefined;
    server.use(
      http.post(`${BASE}/jobs/job_1/fail`, async ({ request }) => {
        body = (await request.json()) as { error: string };
        return HttpResponse.json({ success: true });
      }),
    );
    await makeClient().jobs.fail("job_1", { workerId: "w1", error });
    return body!;
  }

  it("sends 'Job failed' for empty text", async () => {
    expect((await failBody("")).error).toBe("Job failed");
  });

  it("truncates over-long text to 2048 characters", async () => {
    const sent = (await failBody("é".repeat(3000))).error;
    expect(Array.from(sent)).toHaveLength(2048);
  });

  it("leaves ordinary text alone", async () => {
    expect((await failBody("db down")).error).toBe("db down");
  });
});

describe("quota 429 (SDKNP-06)", () => {
  const quotaBody = {
    error: "limit_exceeded",
    code: "QUOTA_EXCEEDED",
    message: "jobs per day limit reached (1000/1000)",
    resource: "jobs_per_day",
  };

  it("does not retry a quota 429 on job creation and does not sleep", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs`, () => {
        attempts++;
        return HttpResponse.json(quotaBody, { status: 429 });
      }),
    );

    const client = makeClient({
      // Default delays are 30 s, so a retry would blow the test timeout.
      retry: { baseDelay: 1000, maxDelay: 30000, jitter: false },
    });
    const started = Date.now();
    await expect(
      client.jobs.create({ queueName: "q", payload: {} }),
    ).rejects.toMatchObject({ isQuota: true, code: "QUOTA_EXCEEDED" });
    expect(attempts).toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("does not retry a quota 429 on an idempotent GET either", async () => {
    let attempts = 0;
    server.use(
      http.get(`${BASE}/queues`, () => {
        attempts++;
        return HttpResponse.json(quotaBody, { status: 429 });
      }),
    );

    await expect(makeClient().queues.list()).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(attempts).toBe(1);
  });

  it("never trips the circuit breaker, so acks keep flowing", async () => {
    let creates = 0;
    server.use(
      http.post(`${BASE}/jobs`, () => {
        creates++;
        return HttpResponse.json(quotaBody, { status: 429 });
      }),
      http.post(`${BASE}/jobs/job_1/complete`, () =>
        HttpResponse.json({ success: true }),
      ),
    );

    const client = makeClient({
      circuitBreaker: { failureThreshold: 2, successThreshold: 1 },
    });
    for (let i = 0; i < 5; i++) {
      await expect(
        client.jobs.create({ queueName: "q", payload: {} }),
      ).rejects.toBeInstanceOf(RateLimitError);
    }
    expect(creates).toBe(5); // every call reached the server: breaker stayed closed
    expect(client.getCircuitBreakerStats().failureCount).toBe(0);

    await expect(
      client.jobs.complete("job_1", { workerId: "w1" }),
    ).resolves.toEqual({ success: true });
  });

  it("still retries a rate-limit 429 that carries Retry-After", async () => {
    let attempts = 0;
    server.use(
      http.post(`${BASE}/jobs`, () => {
        attempts++;
        return attempts === 1
          ? HttpResponse.json(
              { code: "RATE_LIMIT_EXCEEDED", message: "slow down" },
              { status: 429, headers: { "Retry-After": "0" } },
            )
          : HttpResponse.json({ id: "job_1", created: true });
      }),
    );

    await makeClient().jobs.create({ queueName: "q", payload: {} });
    expect(attempts).toBe(2);
  });
});

describe("rate-limit 429 burst and the circuit breaker (SDKNP-32)", () => {
  const rateLimitBody = {
    error: "rate_limit_exceeded",
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests",
  };

  function rateLimited(): Response {
    return HttpResponse.json(rateLimitBody, {
      status: 429,
      headers: {
        "Retry-After": "1",
        "X-RateLimit-Limit": "200",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1),
        "X-RateLimit-Scope": "organization",
      },
    });
  }

  const stats = {
    pending: 0,
    scheduled: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    deadletter: 0,
    cancelled: 0,
    total: 0,
  };

  it("keeps the breaker closed and lets every call succeed after Retry-After", async () => {
    const concurrent = 8;
    let hits = 0;
    server.use(
      http.get(`${BASE}/jobs/stats`, () => {
        hits++;
        // The first wave of a burst above the plan limit is rate limited.
        return hits <= concurrent ? rateLimited() : HttpResponse.json(stats);
      }),
    );

    // Default breaker (threshold 5, 30 s); fastRetry caps the 1 s Retry-After.
    const client = makeClient();
    const results = await Promise.allSettled(
      Array.from({ length: concurrent }, () => client.jobs.getStats()),
    );

    expect(results.map((r) => r.status)).toEqual(
      Array(concurrent).fill("fulfilled"),
    );
    expect(hits).toBe(concurrent * 2);
    expect(client.getCircuitBreakerStats().state).toBe("CLOSED");
    expect(client.getCircuitBreakerStats().failureCount).toBe(0);
    await expect(client.jobs.getStats()).resolves.toEqual(stats);
  });

  it("does not open the breaker on rate-limit 429s that reach the caller", async () => {
    let limited = true;
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        limited ? rateLimited() : HttpResponse.json(stats),
      ),
    );

    const client = makeClient({ retry: { ...fastRetry, maxRetries: 0 } });
    for (let i = 0; i < 6; i++) {
      await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
        RateLimitError,
      );
    }
    limited = false;

    // Before the fix the 5th 429 opened the breaker and this call failed with
    // CircuitBreakerOpenError without reaching the server.
    await expect(client.jobs.getStats()).resolves.toEqual(stats);
    expect(client.getCircuitBreakerStats().state).toBe("CLOSED");
  });

  it("still opens the breaker on 5xx", async () => {
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "boom" },
          { status: 500 },
        ),
      ),
    );

    const client = makeClient({ retry: { ...fastRetry, maxRetries: 0 } });
    for (let i = 0; i < 5; i++) {
      await expect(client.jobs.getStats()).rejects.toBeInstanceOf(ServerError);
    }
    await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });

  it("keeps an isFailure passed in the client's circuitBreaker option", async () => {
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "bad" },
          { status: 400 },
        ),
      ),
    );

    // resolveConfig spreads options.circuitBreaker, so a predicate passed here
    // reaches the breaker; it counted in 1.3.0 and must keep counting.
    const client = makeClient({
      retry: { ...fastRetry, maxRetries: 0 },
      circuitBreaker: { isFailure: () => true },
    });
    for (let i = 0; i < 5; i++) {
      await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });

  it("calls onStateChange passed in the client's circuitBreaker option", async () => {
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "boom" },
          { status: 500 },
        ),
      ),
    );

    const events: CircuitStateChange[] = [];
    const client = makeClient({
      retry: { ...fastRetry, maxRetries: 0 },
      circuitBreaker: {
        failureThreshold: 2,
        onStateChange: (event: CircuitStateChange) => events.push(event),
      },
    });
    for (let i = 0; i < 2; i++) {
      await expect(client.jobs.getStats()).rejects.toBeInstanceOf(ServerError);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from: CircuitState.CLOSED,
      to: CircuitState.OPEN,
      failureCount: 2,
    });
  });

  it("calls a method-style isFailure in the circuitBreaker option with its options as this", async () => {
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "bad" },
          { status: 400 },
        ),
      ),
    );

    // resolveConfig copies the option's own properties, so `this` is that copy
    // and still carries countAll, as in 1.3.0.
    const client = makeClient({
      retry: { ...fastRetry, maxRetries: 0 },
      circuitBreaker: {
        failureThreshold: 2,
        countAll: true,
        isFailure(): boolean {
          return this.countAll;
        },
      },
    });
    for (let i = 0; i < 2; i++) {
      await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    await expect(client.jobs.getStats()).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });
});

describe("single-flight token refresh (SDKNP-07)", () => {
  function createRaw() {
    const config = resolveConfig({
      apiKey: "sk_test_123",
      retry: fastRetry,
    });
    return createHttpClient(
      config,
      createCircuitBreaker(config.circuitBreaker),
    );
  }

  it("lets every concurrent 401 recover through one shared refresh", async () => {
    server.use(
      http.get(`${BASE}/test`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer fresh"
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json(
              { code: "TOKEN_EXPIRED", message: "expired" },
              { status: 401 },
            ),
      ),
    );

    const client = createRaw();
    let refreshCalls = 0;
    client.setRefreshTokenFn(async () => {
      refreshCalls++;
      // Slow enough that all five requests have their 401 while it runs.
      await new Promise((r) => setTimeout(r, 30));
      return "fresh";
    });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => client.get<{ ok: boolean }>("/test")),
    );

    expect(results.map((r) => r.status)).toEqual(Array(5).fill("fulfilled"));
    expect(refreshCalls).toBe(1);
  });

  it("replays a request whose 401 arrives after the refresh already finished, without refreshing again", async () => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => (releaseSlow = r));
    server.use(
      http.get(`${BASE}/fast`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer fresh"
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ code: "E", message: "e" }, { status: 401 }),
      ),
      http.get(`${BASE}/slow`, async ({ request }) => {
        if (request.headers.get("Authorization") === "Bearer fresh") {
          return HttpResponse.json({ ok: true });
        }
        // Sent with the old token, answered only after the refresh is done.
        await slowGate;
        return HttpResponse.json({ code: "E", message: "e" }, { status: 401 });
      }),
    );

    const client = createRaw();
    let refreshCalls = 0;
    client.setRefreshTokenFn(async () => {
      refreshCalls++;
      return "fresh";
    });

    const slow = client.get<{ ok: boolean }>("/slow");
    await client.get("/fast"); // 401 -> refresh -> replay
    releaseSlow();

    await expect(slow).resolves.toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
  });

  it("fails every waiting request with its 401 when the shared refresh fails", async () => {
    server.use(
      http.get(`${BASE}/test`, () =>
        HttpResponse.json(
          { code: "TOKEN_EXPIRED", message: "expired" },
          { status: 401 },
        ),
      ),
    );

    const client = createRaw();
    let refreshCalls = 0;
    client.setRefreshTokenFn(async () => {
      refreshCalls++;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("refresh token revoked");
    });

    const results = await Promise.allSettled([
      client.get("/test"),
      client.get("/test"),
      client.get("/test"),
    ]);

    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        AuthenticationError,
      );
    }
    expect(refreshCalls).toBe(1);
  });

  it("does not deadlock when the refresh endpoint itself answers 401", async () => {
    server.use(
      http.get(`${BASE}/jobs`, () =>
        HttpResponse.json({ code: "E", message: "expired" }, { status: 401 }),
      ),
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json(
          { code: "INVALID_TOKEN", message: "refresh token invalid" },
          { status: 401 },
        ),
      ),
    );

    const client = new SpooledClient({
      accessToken: "old_access",
      refreshToken: "old_refresh",
      retry: fastRetry,
    });

    await expect(client.jobs.list()).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("recovers N concurrent calls through SpooledClient's own refresh", async () => {
    let refreshCalls = 0;
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) =>
        request.headers.get("Authorization") === "Bearer new_access"
          ? HttpResponse.json([])
          : HttpResponse.json({ code: "E", message: "e" }, { status: 401 }),
      ),
      http.post(`${BASE}/auth/refresh`, async () => {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({
          access_token: "new_access",
          expires_in: 3600,
        });
      }),
    );

    const client = new SpooledClient({
      accessToken: "old_access",
      refreshToken: "old_refresh",
      retry: fastRetry,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => client.jobs.list()),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("fulfilled"));
    expect(refreshCalls).toBe(1);
  });
});

describe("Content-Type on body-less requests (SDKNP-08)", () => {
  it("sends no Content-Type when pause has no reason", async () => {
    let contentType: string | null = "unset";
    let body = "unset";
    server.use(
      http.post(`${BASE}/queues/emails/pause`, async ({ request }) => {
        contentType = request.headers.get("Content-Type");
        body = await request.text();
        return HttpResponse.json({
          queue_name: "emails",
          paused: true,
          paused_at: "2026-01-01T00:00:00Z",
        });
      }),
    );

    await makeClient().queues.pause("emails");
    expect(contentType).toBeNull();
    expect(body).toBe("");
  });

  it("still sends JSON Content-Type with the reason when there is one", async () => {
    let contentType: string | null = null;
    let body: unknown;
    server.use(
      http.post(`${BASE}/queues/emails/pause`, async ({ request }) => {
        contentType = request.headers.get("Content-Type");
        body = await request.json();
        return HttpResponse.json({
          queue_name: "emails",
          paused: true,
          paused_at: "2026-01-01T00:00:00Z",
          reason: "deploy",
        });
      }),
    );

    await makeClient().queues.pause("emails", "deploy");
    expect(contentType).toContain("application/json");
    expect(body).toEqual({ reason: "deploy" });
  });

  it("sends no Content-Type on GET and DELETE", async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${BASE}/queues`, ({ request }) => {
        seen.push(request.headers.get("Content-Type"));
        return HttpResponse.json([]);
      }),
      http.delete(`${BASE}/queues/q`, ({ request }) => {
        seen.push(request.headers.get("Content-Type"));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const client = makeClient();
    await client.queues.list();
    await client.queues.delete("q");
    expect(seen).toEqual([null, null]);
  });
});

describe("422 end to end", () => {
  it("surfaces a 422 from the API as ValidationError", async () => {
    server.use(
      http.post(`${BASE}/jobs`, () =>
        HttpResponse.json(
          { code: "VALIDATION_ERROR", message: "queue_name: missing field" },
          { status: 422 },
        ),
      ),
    );

    const err = await makeClient()
      .jobs.create({ queueName: "q", payload: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).statusCode).toBe(422);
  });
});

describe("CircuitBreakerOpenError is unaffected", () => {
  it("still opens on repeated 5xx", async () => {
    server.use(
      http.get(`${BASE}/queues`, () =>
        HttpResponse.json({ code: "E", message: "e" }, { status: 500 }),
      ),
    );
    const client = makeClient({
      retries: 0,
      circuitBreaker: { failureThreshold: 2 },
    });
    await expect(client.queues.list()).rejects.toBeInstanceOf(ServerError);
    await expect(client.queues.list()).rejects.toBeInstanceOf(ServerError);
    await expect(client.queues.list()).rejects.toBeInstanceOf(
      CircuitBreakerOpenError,
    );
  });
});
