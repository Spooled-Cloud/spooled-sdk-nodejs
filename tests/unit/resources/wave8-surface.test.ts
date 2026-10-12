/**
 * API 0.1.122 surface: job list filters and X-Has-More, job history, worker
 * counters, webhook formats and events, the inbound webhook log, and
 * X-RateLimit-* on successful responses. Also checks that values newer than
 * the SDK's types (event names, formats, statuses, plan tiers) pass through.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../../src/client.js";
import type {
  CreateOutgoingWebhookParams,
  InboundWebhookDelivery,
  JobHistoryEvent,
  ListJobsParams,
  UpdateOutgoingWebhookParams,
  WebhookEventType,
} from "../../../src/index.js";
import { NotFoundError, ValidationError } from "../../../src/errors.js";

const BASE = "https://api.spooled.cloud/api/v1";
const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

const createClient = () =>
  new SpooledClient({
    apiKey: "sk_test_123",
    retry: { maxRetries: 0 },
  });

const summary = (id: string) => ({
  id,
  queue_name: "emails",
  status: "failed",
  priority: 0,
  attempt: 1,
  max_retries: 3,
  job_type: "send",
  last_error: "boom",
  created_at: "2026-10-12T08:00:00Z",
});

describe("jobs.list filters (QW12)", () => {
  it("sends a status list, q, job_type and RFC 3339 timestamps", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([summary("job_1")]);
      }),
    );

    const params: ListJobsParams = {
      queueName: "emails",
      status: ["failed", "deadletter"],
      q: "job_1",
      jobType: "send",
      createdAfter: new Date("2026-10-11T00:00:00Z"),
      createdBefore: "2026-10-12T00:00:00+02:00",
      limit: 10,
      offset: 20,
    };
    const rows = await createClient().jobs.list(params);

    expect(rows[0].jobType).toBe("send");
    expect(query?.get("status")).toBe("failed,deadletter");
    expect(query?.get("q")).toBe("job_1");
    expect(query?.get("job_type")).toBe("send");
    expect(query?.get("queue_name")).toBe("emails");
    // String(date) would be "Sun Oct 11 2026 ..." and a 400 from the API.
    expect(query?.get("created_after")).toBe("2026-10-11T00:00:00.000Z");
    expect(query?.get("created_before")).toBe("2026-10-12T00:00:00+02:00");
    expect(query?.get("limit")).toBe("10");
    expect(query?.get("offset")).toBe("20");
  });

  it("keeps a single status and drops an empty status list", async () => {
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("status"));
        return HttpResponse.json([]);
      }),
    );

    const client = createClient();
    await client.jobs.list({ status: "pending" });
    await client.jobs.list({ status: [] });
    expect(seen).toEqual(["pending", null]);
  });

  it("surfaces an invalid filter as a ValidationError", async () => {
    server.use(
      http.get(`${BASE}/jobs`, () =>
        HttpResponse.json(
          {
            code: "VALIDATION_ERROR",
            message: "created_after must be an RFC 3339 timestamp",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      createClient().jobs.list({ createdAfter: "yesterday" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sends the search filters on the DLQ list too", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/jobs/dlq`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([summary("job_9")], {
          headers: { "X-Has-More": "true" },
        });
      }),
    );

    const page = await createClient().jobs.dlq.listPage({
      jobType: "send",
      createdAfter: new Date("2026-10-01T00:00:00Z"),
      limit: 1,
    });
    expect(query?.get("job_type")).toBe("send");
    expect(query?.get("created_after")).toBe("2026-10-01T00:00:00.000Z");
    expect(page.hasMore).toBe(true);
    expect(page.data.map((j) => j.id)).toEqual(["job_9"]);
  });
});

describe("jobs.listPage and X-Has-More", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["TRUE", true],
  ])("reads X-Has-More: %s", async (header, expected) => {
    server.use(
      http.get(`${BASE}/jobs`, () =>
        HttpResponse.json([summary("job_1")], {
          headers: { "X-Has-More": header },
        }),
      ),
    );

    const page = await createClient().jobs.listPage({ limit: 1 });
    expect(page.hasMore).toBe(expected);
    expect(page.data).toHaveLength(1);
  });

  it("guesses from the page size when an older server sends no header", async () => {
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get("limit"));
        return HttpResponse.json(
          Array.from({ length: Math.min(limit, 2) }, (_, i) =>
            summary(`job_${i}`),
          ),
        );
      }),
    );

    const client = createClient();
    expect((await client.jobs.listPage({ limit: 2 })).hasMore).toBe(true);
    expect((await client.jobs.listPage({ limit: 3 })).hasMore).toBe(false);
  });

  it("jobs.list still returns the bare array", async () => {
    server.use(
      http.get(`${BASE}/jobs`, () =>
        HttpResponse.json([summary("job_1")], {
          headers: { "X-Has-More": "true" },
        }),
      ),
    );

    const rows = await createClient().jobs.list();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(["job_1"]);
  });
});

describe("jobs.history (QW10)", () => {
  const events = [
    {
      id: "h1",
      job_id: "job_1",
      event_type: "processing",
      worker_id: "w1",
      details: { worker_id: "w1", lease_id: "l1" },
      created_at: "2026-10-12T08:00:00Z",
    },
    {
      id: "h2",
      job_id: "job_1",
      event_type: "deadlettered",
      worker_id: null,
      details: { error: "boom" },
      created_at: "2026-10-12T08:00:01Z",
    },
  ];

  it("sends order/limit/offset and maps the rows", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/jobs/job_1/history`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(events, {
          headers: { "X-Has-More": "false" },
        });
      }),
    );

    const rows: JobHistoryEvent[] = await createClient().jobs.history("job_1", {
      order: "desc",
      limit: 2,
      offset: 0,
    });

    expect(query?.get("order")).toBe("desc");
    expect(query?.get("limit")).toBe("2");
    expect(query?.get("offset")).toBe("0");
    expect(rows).toEqual([
      {
        id: "h1",
        jobId: "job_1",
        eventType: "processing",
        workerId: "w1",
        // details are user-visible JSON and keep the server's keys
        details: { worker_id: "w1", lease_id: "l1" },
        createdAt: "2026-10-12T08:00:00Z",
      },
      {
        id: "h2",
        jobId: "job_1",
        eventType: "deadlettered",
        workerId: null,
        details: { error: "boom" },
        createdAt: "2026-10-12T08:00:01Z",
      },
    ]);
  });

  it("historyPage reports X-Has-More and keeps unknown event types", async () => {
    server.use(
      http.get(`${BASE}/jobs/job_1/history`, () =>
        HttpResponse.json(
          [{ ...events[0], event_type: "lease_released_someday" }],
          { headers: { "X-Has-More": "true" } },
        ),
      ),
    );

    const page = await createClient().jobs.historyPage("job_1", { limit: 1 });
    expect(page.hasMore).toBe(true);
    expect(page.data[0].eventType).toBe("lease_released_someday");
  });

  it("maps an unknown job to NotFoundError", async () => {
    server.use(
      http.get(`${BASE}/jobs/nope/history`, () =>
        HttpResponse.json(
          { code: "NOT_FOUND", message: "Job not found" },
          { status: 404 },
        ),
      ),
    );

    await expect(createClient().jobs.history("nope")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("worker counters (QW15)", () => {
  it("exposes jobsProcessed and jobsFailed on list and get", async () => {
    const worker = {
      id: "w1",
      organization_id: "org",
      queue_name: "emails",
      hostname: "h",
      max_concurrency: 5,
      current_jobs: 0,
      status: "healthy",
      last_heartbeat: "2026-10-12T08:00:00Z",
      metadata: {},
      registered_at: "2026-10-12T07:00:00Z",
      jobs_processed: 41,
      jobs_failed: 3,
    };
    server.use(
      http.get(`${BASE}/workers`, () => HttpResponse.json([worker])),
      http.get(`${BASE}/workers/w1`, () => HttpResponse.json(worker)),
    );

    const client = createClient();
    const [listed] = await client.workers.list();
    const got = await client.workers.get("w1");
    expect([listed.jobsProcessed, listed.jobsFailed]).toEqual([41, 3]);
    expect([got.jobsProcessed, got.jobsFailed]).toEqual([41, 3]);
  });
});

describe("webhook format and events (QW8, QW14)", () => {
  const newEvents: WebhookEventType[] = [
    "job.deadlettered",
    "job.retried",
    "workflow.completed",
    "workflow.failed",
  ];

  it("sends format and the new events on create and update", async () => {
    const bodies: unknown[] = [];
    const webhook = {
      id: "wh_1",
      organization_id: "org",
      name: "alerts",
      url: "https://hooks.slack.com/services/x",
      events: newEvents,
      enabled: true,
      failure_count: 0,
      format: "slack",
      created_at: "2026-10-12T08:00:00Z",
      updated_at: "2026-10-12T08:00:00Z",
    };
    server.use(
      http.post(`${BASE}/outgoing-webhooks`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(webhook);
      }),
      http.put(`${BASE}/outgoing-webhooks/wh_1`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...webhook, format: "teams" });
      }),
    );

    const client = createClient();
    const create: CreateOutgoingWebhookParams = {
      name: "alerts",
      url: "https://hooks.slack.com/services/x",
      events: newEvents,
      format: "slack",
    };
    const created = await client.webhooks.create(create);
    const update: UpdateOutgoingWebhookParams = { format: "teams" };
    const updated = await client.webhooks.update("wh_1", update);

    expect(bodies[0]).toMatchObject({ events: newEvents, format: "slack" });
    expect(bodies[1]).toEqual({ format: "teams" });
    expect(created.format).toBe("slack");
    expect(created.events).toEqual(newEvents);
    expect(updated.format).toBe("teams");
  });

  it("passes event names, formats and statuses newer than the SDK through", async () => {
    server.use(
      http.get(`${BASE}/outgoing-webhooks`, () =>
        HttpResponse.json([
          {
            id: "wh_1",
            organization_id: "org",
            name: "n",
            url: "https://example.com",
            events: ["job.created", "queue.drained"],
            enabled: true,
            failure_count: 0,
            format: "googlechat",
            last_status: "throttled",
            created_at: "2026-10-12T08:00:00Z",
            updated_at: "2026-10-12T08:00:00Z",
          },
        ]),
      ),
      http.get(`${BASE}/jobs/job_1`, () =>
        HttpResponse.json({
          id: "job_1",
          organization_id: "org",
          queue_name: "q",
          status: "archived",
          payload: {},
          retry_count: 0,
          max_retries: 3,
          created_at: "2026-10-12T08:00:00Z",
          priority: 0,
          timeout_seconds: 300,
          updated_at: "2026-10-12T08:00:00Z",
        }),
      ),
    );

    const client = createClient();
    const [webhook] = await client.webhooks.list();
    const job = await client.jobs.get("job_1");
    expect(webhook.events).toEqual(["job.created", "queue.drained"]);
    expect(webhook.format).toBe("googlechat");
    expect(webhook.lastStatus).toBe("throttled");
    expect(job.status).toBe("archived");
  });
});

describe("inbound webhook log (QW11)", () => {
  it("sends the filters and maps the rows", async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/webhooks/deliveries`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([
          {
            id: "d1",
            provider: "custom",
            event_type: "order.paid",
            matched_queue: "orders",
            job_id: "job_1",
            status: "created",
            created_at: "2026-10-12T08:00:00Z",
          },
          {
            id: "d0",
            provider: "custom",
            event_type: "custom",
            matched_queue: null,
            job_id: null,
            status: null,
            created_at: "2026-10-01T08:00:00Z",
          },
        ]);
      }),
    );

    const rows: InboundWebhookDelivery[] =
      await createClient().ingest.listDeliveries({
        status: "created",
        since: new Date("2026-10-01T00:00:00Z"),
        queueName: "orders",
        limit: 2,
        offset: 0,
      });

    expect(query?.get("status")).toBe("created");
    expect(query?.get("since")).toBe("2026-10-01T00:00:00.000Z");
    expect(query?.get("queue_name")).toBe("orders");
    expect(query?.get("limit")).toBe("2");
    expect(rows[0]).toEqual({
      id: "d1",
      provider: "custom",
      eventType: "order.paid",
      matchedQueue: "orders",
      jobId: "job_1",
      status: "created",
      createdAt: "2026-10-12T08:00:00Z",
    });
    expect(rows[1].jobId).toBeNull();
  });

  it("sends no filters when none are given", async () => {
    let search = "unset";
    server.use(
      http.get(`${BASE}/webhooks/deliveries`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );

    expect(await createClient().ingest.listDeliveries()).toEqual([]);
    expect(search).toBe("");
  });
});

describe("X-RateLimit-* on successful responses (QW9)", () => {
  it("getRateLimitInfo reads limit, remaining, reset (Unix seconds) and scope", async () => {
    const reset = Math.floor(Date.now() / 1000) + 2;
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { total: 0 },
          {
            headers: {
              "X-RateLimit-Limit": "200",
              "X-RateLimit-Remaining": "199",
              "X-RateLimit-Reset": String(reset),
              "X-RateLimit-Scope": "organization",
            },
          },
        ),
      ),
    );

    const client = createClient();
    expect(client.getRateLimitInfo()).toBeUndefined();
    await client.jobs.getStats();

    const info = client.getRateLimitInfo();
    expect(info).toMatchObject({
      limit: 200,
      remaining: 199,
      scope: "organization",
    });
    expect(info?.reset?.getTime()).toBe(reset * 1000);
    expect(info?.retryAfter).toBeUndefined();
  });

  it("keeps the last values when a response has no rate-limit headers", async () => {
    server.use(
      http.get(`${BASE}/jobs/stats`, () =>
        HttpResponse.json(
          { total: 0 },
          {
            headers: {
              "X-RateLimit-Limit": "60",
              "X-RateLimit-Remaining": "59",
              "X-RateLimit-Scope": "api_key",
            },
          },
        ),
      ),
      http.get("https://api.spooled.cloud/health", () =>
        HttpResponse.json({ status: "healthy" }),
      ),
    );

    const client = createClient();
    await client.jobs.getStats();
    await client.health.get();
    expect(client.getRateLimitInfo()).toMatchObject({
      limit: 60,
      remaining: 59,
      scope: "api_key",
    });
  });
});
