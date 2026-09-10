/**
 * Runtime mapping vs backend WorkflowDetailResponse / WorkflowJobResponse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../../src/client.js";
import { mapWorkflowGetResponse } from "../../../src/resources/workflows.js";

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

const DETAIL = {
  id: "workflow_123",
  organization_id: "org_1",
  name: "My Workflow",
  description: "keep me",
  status: "running",
  started_at: "2024-01-01T00:00:01Z",
  metadata: { env: "prod" },
  jobs: [
    {
      id: "job_1",
      organization_id: "org_1",
      queue: "etl",
      job_type: "job",
      payload: "plain-string",
      status: "completed",
      priority: 0,
      attempt: 1,
      max_retries: 3,
      timeout_ms: 30000,
      created_at: "2024-01-01T00:00:00Z",
      result: [1, 2, 3],
      metadata: { tag: "urgent" },
      workflow_id: "workflow_123",
    },
    {
      id: "job_2",
      queue: "etl",
      payload: null,
      status: "pending",
      priority: 0,
      attempt: 0,
      max_retries: 3,
      timeout_ms: 60000,
      created_at: "2024-01-01T00:00:00Z",
      workflow_id: "workflow_123",
    },
    {
      id: "job_3",
      queue: "etl",
      payload: false,
      status: "pending",
      priority: 0,
      attempt: 0,
      max_retries: 3,
      created_at: "2024-01-01T00:00:00Z",
      workflow_id: "workflow_123",
    },
  ],
  dependencies: [],
  progress: {
    total: 3,
    completed: 1,
    failed: 0,
    pending: 2,
    processing: 0,
  },
  created_at: "2024-01-01T00:00:00Z",
};

describe("mapWorkflowGetResponse", () => {
  it("drops description, startedAt, and metadata the API sends", () => {
    const mapped = mapWorkflowGetResponse({
      id: "workflow_123",
      name: "My Workflow",
      status: "running",
      createdAt: "2024-01-01T00:00:00Z",
      // present on GET /workflows/{id} after camelCase
      ...{
        description: "keep me",
        startedAt: "2024-01-01T00:00:01Z",
        metadata: { env: "prod" },
      },
      progress: { total: 2, completed: 1, failed: 0 },
    });

    expect(mapped.totalJobs).toBe(2);
    expect("description" in mapped).toBe(false);
    expect("startedAt" in mapped).toBe(false);
    expect("metadata" in mapped).toBe(false);
  });
});

describe("mapWorkflowDetailJobs runtime", () => {
  const createClient = () => new SpooledClient({ apiKey: "sk_test_123" });

  function stubDetail() {
    server.use(
      http.get(
        "https://api.spooled.cloud/api/v1/workflows/workflow_123",
        () => HttpResponse.json(DETAIL),
      ),
    );
  }

  it("does not replace a string payload with {} (?? only hits null/undefined)", async () => {
    stubDetail();
    const jobs = await createClient().workflows.jobs.list("workflow_123");
    expect(jobs[0].payload).toBe("plain-string");
    expect(jobs[2].payload).toBe(false);
  });

  it("replaces a null payload with {}", async () => {
    stubDetail();
    const jobs = await createClient().workflows.jobs.list("workflow_123");
    expect(jobs[1].payload).toEqual({});
  });

  it("keeps a JSON-array result (cast is type-only)", async () => {
    stubDetail();
    const jobs = await createClient().workflows.jobs.list("workflow_123");
    expect(jobs[0].result).toEqual([1, 2, 3]);
  });

  it("drops backend metadata (job.tags) instead of exposing tags", async () => {
    stubDetail();
    const jobs = await createClient().workflows.jobs.list("workflow_123");
    expect(
      (jobs[0] as { tags?: unknown; metadata?: unknown }).tags,
    ).toBeUndefined();
    expect(
      (jobs[0] as { tags?: unknown; metadata?: unknown }).metadata,
    ).toBeUndefined();
  });

  it("maps timeout_ms onto timeoutSeconds; omits timeout when timeout_ms is absent", async () => {
    stubDetail();
    const jobs = await createClient().workflows.jobs.list("workflow_123");
    expect(jobs[0].timeoutSeconds).toBe(30);
    expect(jobs[2].timeoutSeconds).toBeUndefined();
  });
});
