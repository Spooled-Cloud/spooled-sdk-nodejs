/**
 * gRPC quota code, queue stats as numbers, and quiet client-side cancel.
 *
 * NP-8: a plan cap over gRPC (RESOURCE_EXHAUSTED "... limit reached") carried
 * code RATE_LIMIT_EXCEEDED, so `error.code === "QUOTA_EXCEEDED"` missed it.
 * NP-14: GetQueueStats counters (int64, loader `longs: String`) came back as
 * strings. NP-13: aborting a stream threw `1 CANCELLED: Cancelled on client`.
 */

/* eslint-disable no-unused-vars -- TS function-type parameter names */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { SpooledGrpcClient } from "../../src/grpc/client.js";
import {
  createJobStream,
  createProcessJobsStream,
} from "../../src/grpc/streaming.js";
import { PayloadTooLargeError, RateLimitError } from "../../src/errors.js";

vi.mock("../../src/grpc/loader.js", () => {
  const unary = (response: unknown) =>
    vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1];
      if (typeof callback !== "function") {
        throw new TypeError("mock unary callback missing");
      }
      callback(null, response);
    });

  const mockClient = class MockClient {
    constructor() {}
    close() {}
    getChannel() {
      return { getConnectivityState: () => 0 };
    }
    waitForReady(_deadline: Date, callback: (error: Error | null) => void) {
      callback(null);
    }
    Enqueue = unary({ jobId: "job_123", created: true });
    GetQueueStats = unary({ queueName: "q", pending: "0" });
    Register = unary({ workerId: "w_1", leaseDurationSecs: 30 });
  };

  const definition = {
    spooled: { v1: { QueueService: mockClient, WorkerService: mockClient } },
  };
  return {
    loadProtoDefinition: vi.fn(() => definition),
    loadProtoDefinitionAsync: vi.fn(async () => definition),
    clearProtoCache: vi.fn(),
    PROTO_LOADER_OPTIONS: {},
  };
});

type Callback = (error: grpc.ServiceError | null, response: unknown) => void;

function newClient(): SpooledGrpcClient {
  return new SpooledGrpcClient({
    address: "localhost:50051",
    apiKey: "sk_test",
  });
}

function stubUnary(
  client: SpooledGrpcClient,
  method: string,
  answer: (callback: Callback) => void,
): void {
  const queueClient = (
    client as unknown as {
      queueClient: Record<string, (...args: unknown[]) => void>;
    }
  ).queueClient;
  queueClient[method] = (...args: unknown[]) => {
    answer(args[args.length - 1] as Callback);
  };
}

function resourceExhausted(
  details: string,
  retryAfter?: string,
): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  if (retryAfter !== undefined) {
    metadata.set("retry-after", retryAfter);
  }
  return Object.assign(new Error(details), {
    code: grpc.status.RESOURCE_EXHAUSTED,
    details,
    metadata,
  }) as grpc.ServiceError;
}

async function enqueueError(error: grpc.ServiceError): Promise<unknown> {
  const client = newClient();
  stubUnary(client, "Enqueue", (callback) => callback(error, null));
  try {
    await client.queue.enqueue({ queueName: "q", payload: {} });
    return undefined;
  } catch (caught) {
    return caught;
  } finally {
    client.close();
  }
}

describe("gRPC RESOURCE_EXHAUSTED", () => {
  it.each([
    "Daily job limit reached",
    "active jobs limit reached (10/10). Upgrade to starter for higher limits.",
    "queues limit reached (1/1)",
  ])(
    "a plan cap (%s) is a RateLimitError with code QUOTA_EXCEEDED",
    async (msg) => {
      const error = await enqueueError(resourceExhausted(msg));

      expect(error).toBeInstanceOf(RateLimitError);
      const limited = error as RateLimitError;
      expect(limited.code).toBe("QUOTA_EXCEEDED");
      expect(limited.isQuota).toBe(true);
      expect(limited.isRetryable()).toBe(false);
      expect(limited.message).toBe(msg);
    },
  );

  it("a per-second rate limit keeps code RATE_LIMIT_EXCEEDED", async () => {
    const error = (await enqueueError(
      resourceExhausted("Rate limit exceeded"),
    )) as RateLimitError;

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.isQuota).toBe(false);
    expect(error.isRetryable()).toBe(true);
  });

  it("an over-size payload is a PayloadTooLargeError, as REST's 413", async () => {
    const msg =
      "payload size limit reached (1048577/1048576) on plan free. Upgrade to starter for higher limits.";
    const error = await enqueueError(resourceExhausted(msg));

    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error).not.toBeInstanceOf(RateLimitError);
    const tooLarge = error as PayloadTooLargeError;
    expect(tooLarge.code).toBe("PAYLOAD_TOO_LARGE");
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.isRetryable()).toBe(false);
    expect(tooLarge.message).toBe(msg);
  });

  it("a retry-after trailer makes it a rate limit and sets retryAfter", async () => {
    const error = (await enqueueError(
      resourceExhausted("Daily job limit reached", "5"),
    )) as RateLimitError;

    expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(error.isQuota).toBe(false);
    expect(error.getRetryAfter()).toBe(5);
  });
});

describe("gRPC GetQueueStats", () => {
  it("returns int64 counters as numbers", async () => {
    const client = newClient();
    stubUnary(client, "GetQueueStats", (callback) =>
      callback(null, {
        queueName: "q",
        pending: "5",
        scheduled: "0",
        processing: "2",
        completed: "1234",
        failed: "3",
        deadletter: "1",
        total: "1245",
        maxAgeMs: "60000",
      }),
    );

    const stats = await client.queue.getQueueStats("q");
    client.close();

    expect(stats).toEqual({
      queueName: "q",
      pending: 5,
      scheduled: 0,
      processing: 2,
      completed: 1234,
      failed: 3,
      deadletter: 1,
      total: 1245,
      maxAgeMs: 60000,
    });
  });

  it("keeps a counter above Number.MAX_SAFE_INTEGER as a string", async () => {
    const client = newClient();
    stubUnary(client, "GetQueueStats", (callback) =>
      callback(null, {
        queueName: "q",
        pending: "9007199254740993",
        scheduled: 0,
        processing: "0",
        completed: "0",
        failed: "0",
        deadletter: "0",
        total: "9007199254740993",
        maxAgeMs: null,
      }),
    );

    const stats = await client.queue.getQueueStats("q");
    client.close();

    expect(stats.pending).toBe("9007199254740993");
    expect(stats.total).toBe("9007199254740993");
    expect(stats.scheduled).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.maxAgeMs).toBeNull();
  });
});

/** A stream call that behaves like grpc-js on cancel(): async CANCELLED error. */
class FakeCall extends EventEmitter {
  cancel = vi.fn(() => {
    setImmediate(() => {
      this.emit(
        "error",
        Object.assign(new Error("1 CANCELLED: Cancelled on client"), {
          code: grpc.status.CANCELLED,
          details: "Cancelled on client",
        }),
      );
      this.emit("status", { code: grpc.status.CANCELLED });
    });
  });
  write = vi.fn();
  end = vi.fn();
}

const wireJob = (id: string) => ({
  id,
  status: "JOB_STATUS_PROCESSING",
  leaseId: `lease_${id}`,
  payload: { fields: { n: { numberValue: 1 } } },
  result: null,
});

describe("client-side stream cancel", () => {
  it("cancel() inside a for-await loop ends StreamJobs without an error", async () => {
    const call = new FakeCall();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const stream = createJobStream(call as never, { onError, onEnd });
    setImmediate(() => call.emit("data", wireJob("job_1")));

    const seen: string[] = [];
    for await (const job of stream) {
      seen.push(job.id);
      stream.cancel();
    }

    expect(seen).toEqual(["job_1"]);
    expect(call.cancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("an aborted signal ends a waiting StreamJobs loop without an error", async () => {
    const call = new FakeCall();
    const controller = new AbortController();
    const onError = vi.fn();
    const stream = createJobStream(call as never, {
      signal: controller.signal,
      onError,
    });
    setTimeout(() => controller.abort(), 10);

    const seen: string[] = [];
    for await (const job of stream) {
      seen.push(job.id);
    }

    expect(seen).toEqual([]);
    expect(call.cancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancel() before iterating neither crashes nor hangs", async () => {
    const call = new FakeCall();
    const stream = createJobStream(call as never);

    stream.cancel();
    // Let the CANCELLED error event fire before anyone iterates.
    await new Promise((resolve) => setImmediate(resolve));

    const seen: string[] = [];
    for await (const job of stream) {
      seen.push(job.id);
    }
    expect(seen).toEqual([]);
  });

  it("a CANCELLED the client did not request still throws", async () => {
    const call = new FakeCall();
    const onError = vi.fn();
    const stream = createJobStream(call as never, { onError });
    setImmediate(() =>
      call.emit(
        "error",
        Object.assign(new Error("1 CANCELLED: Cancelled by server"), {
          code: grpc.status.CANCELLED,
        }),
      ),
    );

    await expect(async () => {
      for await (const job of stream) {
        void job;
      }
    }).rejects.toThrow("Cancelled by server");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("cancel() ends a ProcessJobs receive() loop without an error", async () => {
    const call = new FakeCall();
    const onError = vi.fn();
    const stream = createProcessJobsStream(call as never, { onError });
    stream.send({ dequeue: { queueName: "q", workerId: "w" } });
    setImmediate(() => call.emit("data", { job: wireJob("job_2") }));

    const seen: string[] = [];
    for await (const response of stream.receive()) {
      if (response.job) seen.push(response.job.id);
      stream.cancel();
    }

    expect(seen).toEqual(["job_2"]);
    expect(onError).not.toHaveBeenCalled();
  });
});
