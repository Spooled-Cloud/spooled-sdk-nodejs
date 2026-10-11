/**
 * Webhook Ingestion Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { SpooledClient } from "../../../src/client.js";
import { UnsupportedOperationError } from "../../../src/errors.js";

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe("WebhookIngestionResource", () => {
  const createClient = () => new SpooledClient({ apiKey: "sk_test_123" });

  it.each([
    [
      "github",
      (client: SpooledClient) =>
        client.ingest.github("org_123", "{}", {
          githubEvent: "push",
          secret: "s",
        }),
    ],
    [
      "stripe",
      (client: SpooledClient) =>
        client.ingest.stripe("org_123", "{}", { secret: "s" }),
    ],
  ])(
    "%s throws UnsupportedOperationError without a network call (the API has no such route)",
    async (name, call) => {
      let requests = 0;
      server.use(
        http.post(
          `https://api.spooled.cloud/api/v1/webhooks/org_123/${name}`,
          () => {
            requests++;
            return new HttpResponse(null, { status: 404 });
          },
        ),
      );

      const result = call(createClient());
      await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
      await expect(result).rejects.toMatchObject({
        code: "UNSUPPORTED_OPERATION",
        operation: `ingest.${name}`,
      });
      await expect(result).rejects.toThrow(/ingest\.custom/);
      expect(requests).toBe(0);
    },
  );

  it("should send custom webhook JSON with case conversion and preserve payload", async () => {
    const orgId = "org_123";

    let receivedBody: any;
    let tokenHeader: string | null = null;

    server.use(
      http.post(
        `https://api.spooled.cloud/api/v1/webhooks/${orgId}/custom`,
        async ({ request }) => {
          tokenHeader = request.headers.get("X-Webhook-Token");
          receivedBody = await request.json();
          return HttpResponse.json({
            job_id: "job_1",
            queue_name: "custom_events",
            status: "pending",
          });
        },
      ),
    );

    const client = createClient();
    const result = await client.ingest.custom(
      orgId,
      {
        queueName: "custom_events",
        eventType: "custom.event",
        idempotencyKey: "evt_123",
        priority: 10,
        payload: { custom_key: "preserved" },
      },
      { webhookToken: "org_webhook_token" },
    );

    expect(tokenHeader).toBe("org_webhook_token");
    expect(receivedBody.queue_name).toBe("custom_events");
    expect(receivedBody.event_type).toBe("custom.event");
    expect(receivedBody.idempotency_key).toBe("evt_123");
    expect(receivedBody.priority).toBe(10);
    // payload is preserved (no deep conversion)
    expect(receivedBody.payload).toEqual({ custom_key: "preserved" });
    expect(result.jobId).toBe("job_1");
    expect(result.queueName).toBe("custom_events");
    expect(result.status).toBe("pending");
  });
});
