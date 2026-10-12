/**
 * gRPC Client Tests
 *
 * Tests for the real gRPC client. These tests focus on:
 * - Client construction and configuration
 * - Type correctness
 * - Proto loading
 *
 * Note: For actual gRPC communication tests, see integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as grpc from "@grpc/grpc-js";
import {
  SpooledGrpcClient,
  GrpcJobStatus,
  createJobStream,
  createProcessJobsStream,
  timestampToDate,
  dateToTimestamp,
} from "../../src/grpc/index.js";

// Mock grpc-js to avoid actual network calls
vi.mock("@grpc/grpc-js", async () => {
  const actual = await vi.importActual("@grpc/grpc-js");
  return {
    ...actual,
    credentials: {
      createSsl: vi.fn(() => ({})),
      createInsecure: vi.fn(() => ({})),
    },
  };
});

// Mock proto-loader
vi.mock("@grpc/proto-loader", () => ({
  loadSync: vi.fn(() => ({})),
  load: vi.fn(() => Promise.resolve({})),
}));

// Mock the loaded package definition
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
    waitForReady(_deadline: Date, callback: any) {
      callback(null);
    }
    // Queue methods
    Enqueue = unary({ jobId: "job_123", created: true });
    Dequeue = unary({ jobs: [] });
    Complete = unary({ success: true });
    Fail = unary({ success: true, willRetry: false });
    RenewLease = unary({ success: true });
    GetJob = unary({ job: null });
    GetQueueStats = unary({ queueName: "test", pending: 0 });
    StreamJobs = vi.fn(() => ({
      on: vi.fn(),
      cancel: vi.fn(),
    }));
    ProcessJobs = vi.fn(() => ({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(),
    }));
    // Worker methods
    Register = unary({ workerId: "w_1", leaseDurationSecs: 30 });
    Heartbeat = unary({ acknowledged: true });
    Deregister = unary({ success: true });
  };

  return {
    loadProtoDefinition: vi.fn(() => ({
      spooled: {
        v1: {
          QueueService: mockClient,
          WorkerService: mockClient,
        },
      },
    })),
    loadProtoDefinitionAsync: vi.fn(() =>
      Promise.resolve({
        spooled: {
          v1: {
            QueueService: mockClient,
            WorkerService: mockClient,
          },
        },
      }),
    ),
    clearProtoCache: vi.fn(),
    PROTO_LOADER_OPTIONS: {},
  };
});

describe("SpooledGrpcClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("construction", () => {
    it("should create client with address and apiKey", () => {
      const client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });

      expect(client).toBeInstanceOf(SpooledGrpcClient);
      expect(client.queue).toBeDefined();
      expect(client.workers).toBeDefined();

      client.close();
    });

    it("should use insecure credentials for localhost", () => {
      const client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });

      expect(grpc.credentials.createInsecure).toHaveBeenCalled();
      client.close();
    });

    it("should use SSL credentials for non-localhost", () => {
      const client = new SpooledGrpcClient({
        address: "grpc.spooled.cloud:443",
        apiKey: "sk_test_123",
      });

      expect(grpc.credentials.createSsl).toHaveBeenCalled();
      client.close();
    });

    it("should respect explicit useTls option", () => {
      const client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
        useTls: true,
      });

      expect(grpc.credentials.createSsl).toHaveBeenCalled();
      client.close();
    });
  });

  describe("queue operations", () => {
    let client: SpooledGrpcClient;

    beforeEach(() => {
      client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });
    });

    afterEach(() => {
      client.close();
    });

    it("should enqueue a job", async () => {
      const result = await client.queue.enqueue({
        queueName: "test-queue",
        payload: { message: "hello" },
      });

      expect(result.jobId).toBe("job_123");
      expect(result.created).toBe(true);
    });

    it("should dequeue jobs", async () => {
      const result = await client.queue.dequeue({
        queueName: "test-queue",
        workerId: "worker-1",
      });

      expect(result.jobs).toEqual([]);
    });

    it("should complete a job", async () => {
      const result = await client.queue.complete({
        jobId: "job_123",
        workerId: "worker-1",
        result: { processed: true },
      });

      expect(result.success).toBe(true);
    });

    it("should fail a job", async () => {
      const result = await client.queue.fail({
        jobId: "job_123",
        workerId: "worker-1",
        error: "Something went wrong",
      });

      expect(result.success).toBe(true);
    });

    it("should get queue stats", async () => {
      const result = await client.queue.getQueueStats("test-queue");

      expect(result.queueName).toBe("test");
    });

    it("should get a job", async () => {
      const result = await client.queue.getJob("job_123");

      expect(result.job).toBeNull();
    });

    it("keeps a job status this SDK does not know as a string", async () => {
      (client as any).queueClient.GetJob = vi.fn((...args: unknown[]) => {
        const callback = args[args.length - 1] as (
          // eslint-disable-next-line no-unused-vars
          ...a: unknown[]
        ) => void;
        // proto-loader hands an unknown enum number through as a number.
        callback(null, { job: { id: "job_123", status: 42 } });
      });

      const result = await client.queue.getJob("job_123");

      expect(result.job?.status).toBe("42");
    });
  });

  describe("worker operations", () => {
    let client: SpooledGrpcClient;

    beforeEach(() => {
      client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });
    });

    afterEach(() => {
      client.close();
    });

    it("should register a worker", async () => {
      const result = await client.workers.register({
        queueName: "test-queue",
        hostname: "my-host",
      });

      expect(result.workerId).toBe("w_1");
    });

    it("sends a stable workerId on register (proto field 7)", async () => {
      await client.workers.register({
        queueName: "test-queue",
        hostname: "my-host",
        workerId: "test-queue-worker-01",
      });

      const register = (client as any).workerClient.Register as ReturnType<
        typeof vi.fn
      >;
      expect(register.mock.calls[0][0]).toMatchObject({
        queueName: "test-queue",
        workerId: "test-queue-worker-01",
      });
    });

    it("should send heartbeat", async () => {
      const result = await client.workers.heartbeat({
        workerId: "worker-1",
        status: "active",
      });

      expect(result.acknowledged).toBe(true);
    });

    it("should deregister a worker", async () => {
      const result = await client.workers.deregister("worker-1");

      expect(result.success).toBe(true);
    });
  });

  describe("connection management", () => {
    it("should wait for ready", async () => {
      const client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });

      await expect(client.waitForReady()).resolves.toBeUndefined();
      client.close();
    });

    it("should get connection state", () => {
      const client = new SpooledGrpcClient({
        address: "localhost:50051",
        apiKey: "sk_test_123",
      });

      const state = client.getState();
      expect(typeof state).toBe("number");
      client.close();
    });
  });
});

describe("Timestamp utilities", () => {
  it("should convert timestamp object to Date", () => {
    const ts = { seconds: "1702500000", nanos: 500000000 };
    const date = timestampToDate(ts);

    expect(date).toBeInstanceOf(Date);
    expect(date!.getTime()).toBe(1702500000500);
  });

  it("should convert string to Date", () => {
    const isoString = "2024-12-14T00:00:00.000Z";
    const date = timestampToDate(isoString);

    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe(isoString);
  });

  it("should return null for undefined", () => {
    expect(timestampToDate(undefined)).toBeNull();
    expect(timestampToDate(null)).toBeNull();
  });

  it("should convert Date to timestamp", () => {
    const date = new Date("2024-12-14T12:30:45.123Z");
    const ts = dateToTimestamp(date);

    // Convert back and verify round-trip
    const ms =
      parseInt(ts.seconds as string, 10) * 1000 +
      Math.floor((ts.nanos ?? 0) / 1_000_000);
    expect(ms).toBe(date.getTime());
    expect(ts.nanos).toBe(123000000);
  });

  it("should convert ISO string to timestamp", () => {
    const isoString = "2024-12-14T12:30:45.000Z";
    const ts = dateToTimestamp(isoString);

    // Convert back and verify round-trip
    const originalDate = new Date(isoString);
    const seconds = parseInt(ts.seconds as string, 10);
    expect(seconds).toBe(Math.floor(originalDate.getTime() / 1000));
  });
});

describe("GrpcJobStatus", () => {
  it("should have proto-style enum values", () => {
    expect(GrpcJobStatus.JOB_STATUS_UNSPECIFIED).toBe("JOB_STATUS_UNSPECIFIED");
    expect(GrpcJobStatus.JOB_STATUS_PENDING).toBe("JOB_STATUS_PENDING");
    expect(GrpcJobStatus.JOB_STATUS_PROCESSING).toBe("JOB_STATUS_PROCESSING");
    expect(GrpcJobStatus.JOB_STATUS_COMPLETED).toBe("JOB_STATUS_COMPLETED");
    expect(GrpcJobStatus.JOB_STATUS_FAILED).toBe("JOB_STATUS_FAILED");
  });
});

describe("gRPC fail retry default (SDKNP-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // eslint-disable-next-line no-unused-vars
  function failRequestSentBy(call: (client: SpooledGrpcClient) => unknown) {
    const client = new SpooledGrpcClient({
      address: "localhost:50051",
      apiKey: "sk_test_123",
    });
    const pending = call(client);
    const fail = (client as any).queueClient.Fail as ReturnType<typeof vi.fn>;
    const request = fail.mock.calls[0][0];
    client.close();
    return { request, pending };
  }

  it("sends retry: true when the caller does not say", async () => {
    // proto3 `retry` is false when unset, and the server dead-letters a job on
    // the first failure when retry is false.
    const { request, pending } = failRequestSentBy((client) =>
      client.queue.fail({
        jobId: "job_1",
        workerId: "w1",
        error: "boom",
        leaseId: "lease_1",
      }),
    );
    await pending;
    expect(request.retry).toBe(true);
    expect(request.leaseId).toBe("lease_1");
  });

  it("honours an explicit retry: false (dead-letter on purpose)", async () => {
    const { request, pending } = failRequestSentBy((client) =>
      client.queue.fail({
        jobId: "job_1",
        workerId: "w1",
        error: "boom",
        retry: false,
        leaseId: "lease_1",
      }),
    );
    await pending;
    expect(request.retry).toBe(false);
  });

  it("applies the same default to a fail sent on the ProcessJobs stream", () => {
    const write = vi.fn();
    const stream = createProcessJobsStream({ write } as any);
    stream.send({
      fail: { jobId: "job_1", workerId: "w1", error: "x", leaseId: "l" },
    });
    stream.send({
      fail: {
        jobId: "job_2",
        workerId: "w1",
        error: "x",
        retry: false,
        leaseId: "l",
      },
    });
    stream.send({ dequeue: { queueName: "q", workerId: "w1" } });

    expect(write.mock.calls[0][0].fail.retry).toBe(true);
    expect(write.mock.calls[1][0].fail.retry).toBe(false);
    expect(write.mock.calls[2][0]).toEqual({
      dequeue: { queueName: "q", workerId: "w1" },
    });
  });

  it("serializes the defaulted retry as true on the wire", async () => {
    const protoLoader =
      await vi.importActual<typeof import("@grpc/proto-loader")>(
        "@grpc/proto-loader",
      );
    const { resolve } = await import("node:path");
    const { PROTO_LOADER_OPTIONS } = await vi.importActual<
      typeof import("../../src/grpc/loader.js")
    >("../../src/grpc/loader.js");
    const { encodeFailRequest } = await import("../../src/grpc/encode.js");
    const definition = protoLoader.loadSync(
      resolve("proto/spooled.proto"),
      PROTO_LOADER_OPTIONS,
    );
    const type = definition["spooled.v1.FailRequest"] as any;

    const omitted = type.deserialize(
      type.serialize(
        encodeFailRequest({
          jobId: "j",
          workerId: "w",
          error: "e",
          leaseId: "l",
        }),
      ),
    );
    expect(omitted.retry).toBe(true);
  });
});

describe("gRPC TLS detection (SDKNP-24)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["localhost:50051", false],
    ["127.0.0.1:50051", false],
    ["[::1]:50051", false],
    ["[::1]", false],
    ["::1", false],
    ["grpc.spooled.cloud:443", true],
    ["[2001:db8::1]:443", true],
  ])("address %s uses TLS: %s", (address, tls) => {
    const client = new SpooledGrpcClient({ address, apiKey: "sk_test_123" });
    expect(vi.mocked(grpc.credentials.createSsl).mock.calls.length).toBe(
      tls ? 1 : 0,
    );
    expect(vi.mocked(grpc.credentials.createInsecure).mock.calls.length).toBe(
      tls ? 0 : 1,
    );
    client.close();
  });
});

describe("gRPC streams decode jobs like unary calls", () => {
  function fakeStream() {
    // eslint-disable-next-line no-unused-vars
    type Handler = (...args: unknown[]) => void;
    const handlers: Record<string, Handler[]> = {};
    return {
      write: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(),
      on(event: string, handler: Handler) {
        (handlers[event] ??= []).push(handler);
        return this;
      },
      emit(event: string, arg?: unknown) {
        for (const handler of handlers[event] ?? []) handler(arg);
      },
    };
  }

  const wireJob = {
    id: "job_1",
    status: 42,
    leaseId: "lease_1",
    payload: {
      fields: {
        to: { stringValue: "a@example.com" },
        n: { numberValue: 3 },
        tags: { listValue: { values: [{ stringValue: "x" }] } },
      },
    },
    result: null,
  };

  it("StreamJobs yields plain payload objects and string statuses", async () => {
    const call = fakeStream();
    const stream = createJobStream(call as any);
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    call.emit("data", wireJob);
    call.emit("end");

    const { value } = await next;
    expect(value?.payload).toEqual({
      to: "a@example.com",
      n: 3,
      tags: ["x"],
    });
    expect(value?.status).toBe("42");
    expect(value?.leaseId).toBe("lease_1");
  });

  it("ProcessJobs decodes received jobs and encodes a complete result", async () => {
    const call = fakeStream();
    const stream = createProcessJobsStream(call as any);

    stream.send({
      complete: {
        jobId: "job_1",
        workerId: "w1",
        leaseId: "lease_1",
        result: { ok: true },
      },
    });
    expect(call.write.mock.calls[0][0].complete.result).toEqual({
      fields: { ok: { boolValue: true } },
    });

    const iterator = stream.receive()[Symbol.asyncIterator]();
    const next = iterator.next();
    call.emit("data", { job: wireJob });
    call.emit("end");
    const { value } = await next;
    expect(value?.job?.payload).toEqual({
      to: "a@example.com",
      n: 3,
      tags: ["x"],
    });
  });

  // A Struct entry that is not a protobuf Value makes decodeValue throw.
  const undecodableJob = {
    ...wireJob,
    id: "job_bad",
    payload: { fields: { a: null } },
  };

  it("cancels the stream when a received job cannot be decoded, then rethrows", async () => {
    const call = fakeStream();
    const onError = vi.fn();
    const stream = createJobStream(call as any, { onError });
    const iterator = stream[Symbol.asyncIterator]();

    const first = iterator.next();
    call.emit("data", wireJob);
    expect((await first).value?.id).toBe("job_1");

    const second = iterator.next();
    const rejected = expect(second).rejects.toThrow(TypeError);
    call.emit("data", undecodableJob);
    await rejected;

    expect(call.cancel).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports the decode error, not the CANCELLED error its own cancel() causes", async () => {
    const call = fakeStream();
    const onError = vi.fn();
    // grpc-js answers cancel() with an 'error' event carrying status CANCELLED.
    call.cancel.mockImplementation(() => {
      call.emit(
        "error",
        Object.assign(new Error("1 CANCELLED: Cancelled on client"), {
          code: grpc.status.CANCELLED,
        }),
      );
    });
    const stream = createProcessJobsStream(call as any, { onError });
    const iterator = stream.receive()[Symbol.asyncIterator]();

    const next = iterator.next();
    const rejected = expect(next).rejects.toThrow(TypeError);
    call.emit("data", { job: undecodableJob });
    await rejected;

    expect(call.cancel).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("drops what the server still sends after a decode failure", async () => {
    const call = fakeStream();
    const stream = createJobStream(call as any);
    const iterator = stream[Symbol.asyncIterator]();

    const next = iterator.next();
    const rejected = expect(next).rejects.toThrow(TypeError);
    call.emit("data", undecodableJob);
    call.emit("data", wireJob);
    await rejected;
    expect(call.cancel).toHaveBeenCalledTimes(1);
  });

  it("rethrows the decode error when the stream has no cancel()", async () => {
    const call = fakeStream() as Record<string, unknown>;
    delete call.cancel;
    const stream = createJobStream(call as any);
    const iterator = stream[Symbol.asyncIterator]();

    const next = iterator.next();
    const rejected = expect(next).rejects.toThrow(TypeError);
    call.emit("data", undecodableJob);
    await rejected;
  });

  it("does not cancel a stream that ends or fails by itself", async () => {
    const ended = fakeStream();
    const endedIterator = createJobStream(ended as any)[Symbol.asyncIterator]();
    const endedNext = endedIterator.next();
    ended.emit("end");
    await expect(endedNext).resolves.toMatchObject({ done: true });
    expect(ended.cancel).not.toHaveBeenCalled();

    const failed = fakeStream();
    const failedIterator = createJobStream(failed as any)[
      Symbol.asyncIterator
    ]();
    const failedNext = failedIterator.next();
    const rejected = expect(failedNext).rejects.toThrow("unavailable");
    failed.emit("error", new Error("unavailable"));
    await rejected;
    expect(failed.cancel).not.toHaveBeenCalled();
  });
});
