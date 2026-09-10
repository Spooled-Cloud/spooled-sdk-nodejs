/**
 * Schedule payload_template/tags/metadata are serde_json::Value on the backend.
 * The SDK types them JsonValue and must not coerce them to objects in either
 * direction: an array or scalar has to survive both a GET and a create body.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../../src/client.js";

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("Schedules JSON values at runtime", () => {
  const createClient = () => new SpooledClient({ apiKey: "sk_test_123" });

  it("preserves array payload_template and tags on GET (no object coerce)", async () => {
    server.use(
      http.get(
        "https://api.spooled.cloud/api/v1/schedules/schedule_123",
        () =>
          HttpResponse.json({
            id: "schedule_123",
            organization_id: "org_123",
            name: "Daily",
            cron_expression: "0 0 9 * * *",
            timezone: "UTC",
            queue_name: "reports",
            payload_template: ["a", "b"],
            priority: 0,
            max_retries: 3,
            timeout_seconds: 300,
            is_active: true,
            run_count: 0,
            tags: ["urgent"],
            metadata: true,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
          }),
      ),
    );

    const schedule = await createClient().schedules.get("schedule_123");
    expect(schedule.payloadTemplate).toEqual(["a", "b"]);
    expect(schedule.tags).toEqual(["urgent"]);
    expect(schedule.metadata).toBe(true);
  });

  it("sends non-object payload_template and tags on create without wrapping", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(
        "https://api.spooled.cloud/api/v1/schedules",
        async ({ request }) => {
          receivedBody = await request.json();
          return HttpResponse.json({
            id: "schedule_123",
            name: "Test",
            cron_expression: "* * * * * *",
          });
        },
      ),
    );

    await createClient().schedules.create({
      name: "Test",
      cronExpression: "* * * * * *",
      queueName: "queue",
      // Backend accepts serde_json::Value, and CreateScheduleParams types both
      // fields as JsonValue — no cast needed for an array.
      payloadTemplate: ["item"],
      tags: ["urgent"],
    });

    expect(receivedBody).toMatchObject({
      payload_template: ["item"],
      tags: ["urgent"],
    });
  });
});
