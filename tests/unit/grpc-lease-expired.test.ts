/**
 * gRPC unary lease loss maps onto the same 409 LEASE_EXPIRED the REST worker
 * already handles, so the handler stops and the execution does not ack.
 */

/* eslint-disable no-unused-vars -- TS function-type parameter names */

import { afterEach, describe, it, expect, vi } from "vitest";
import * as grpc from "@grpc/grpc-js";
import { SpooledGrpcClient } from "../../src/grpc/client.js";
import { ConflictError } from "../../src/errors.js";
import { SpooledWorker } from "../../src/worker/worker.js";

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
    Dequeue = unary({ jobs: [] });
    Complete = unary({ success: true });
    Fail = unary({ success: true, willRetry: false });
    RenewLease = unary({ success: true });
    GetJob = unary({ job: null });
    GetQueueStats = unary({ queueName: "test", pending: 0 });
    StreamJobs = vi.fn(() => ({ on: vi.fn(), cancel: vi.fn() }));
    ProcessJobs = vi.fn(() => ({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(),
    }));
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
    loadProtoDefinitionAsync: vi.fn(async () => ({
      spooled: {
        v1: {
          QueueService: mockClient,
          WorkerService: mockClient,
        },
      },
    })),
    clearProtoCache: vi.fn(),
    PROTO_LOADER_OPTIONS: {},
  };
});

const LEASE_MISMATCH =
  "lease_id does not match the job's current lease; this worker no longer holds it";

function failUnary(
  client: SpooledGrpcClient,
  method: "RenewLease" | "Complete" | "Fail",
  details: string,
): void {
  const queueClient = (
    client as unknown as {
      queueClient: Record<string, (...args: unknown[]) => void>;
    }
  ).queueClient;
  queueClient[method] = (...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: grpc.ServiceError | null,
      response: unknown,
    ) => void;
    const error = Object.assign(new Error(details), {
      code: grpc.status.FAILED_PRECONDITION,
      details,
      metadata: new grpc.Metadata(),
    }) as grpc.ServiceError;
    callback(error, null);
  };
}

async function captureLeaseError(
  method: "RenewLease" | "Complete" | "Fail",
  details: string,
  call: (client: SpooledGrpcClient) => Promise<unknown>,
): Promise<unknown> {
  const client = new SpooledGrpcClient({
    address: "localhost:50051",
    apiKey: "sk_test",
  });
  failUnary(client, method, details);
  try {
    await call(client);
    return undefined;
  } catch (error) {
    return error;
  } finally {
    client.close();
  }
}

describe("gRPC lease loss", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps RenewLease FAILED_PRECONDITION 'Lease expired' to LEASE_EXPIRED", async () => {
    const error = await captureLeaseError(
      "RenewLease",
      "Lease expired",
      (client) =>
        client.queue.renewLease({
          jobId: "job_1",
          workerId: "worker_1",
          extensionSecs: 30,
          leaseId: "lease_1",
        }),
    );

    expect(error).toBeInstanceOf(ConflictError);
    const conflict = error as ConflictError;
    expect(conflict.code).toBe("LEASE_EXPIRED");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.message).toBe("Lease expired");
  });

  it("maps the lease-mismatch text on Complete and Fail to LEASE_EXPIRED", async () => {
    const complete = await captureLeaseError(
      "Complete",
      LEASE_MISMATCH,
      (client) =>
        client.queue.complete({
          jobId: "job_1",
          workerId: "worker_1",
          leaseId: "lease_1",
        }),
    );
    const fail = await captureLeaseError("Fail", "Lease expired", (client) =>
      client.queue.fail({
        jobId: "job_1",
        workerId: "worker_1",
        leaseId: "lease_1",
        error: "boom",
      }),
    );

    expect((complete as ConflictError).code).toBe("LEASE_EXPIRED");
    expect((fail as ConflictError).code).toBe("LEASE_EXPIRED");
  });

  it("keeps a non-lease FAILED_PRECONDITION as CONFLICT", async () => {
    const error = await captureLeaseError(
      "Complete",
      "Job is already completed",
      (client) =>
        client.queue.complete({
          jobId: "job_1",
          workerId: "worker_1",
          leaseId: "lease_1",
        }),
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe("CONFLICT");
  });

  it("still maps a prefixed status line when details are missing", async () => {
    const client = new SpooledGrpcClient({
      address: "localhost:50051",
      apiKey: "sk_test",
    });
    const queueClient = (
      client as unknown as {
        queueClient: Record<string, (...args: unknown[]) => void>;
      }
    ).queueClient;
    queueClient.RenewLease = (...args: unknown[]) => {
      const callback = args[args.length - 1] as (
        error: grpc.ServiceError | null,
        response: unknown,
      ) => void;
      const error = Object.assign(
        new Error("9 FAILED_PRECONDITION: Lease expired"),
        {
          code: grpc.status.FAILED_PRECONDITION,
          details: "",
          metadata: new grpc.Metadata(),
        },
      ) as grpc.ServiceError;
      callback(error, null);
    };

    await expect(
      client.queue.renewLease({
        jobId: "job_1",
        workerId: "worker_1",
        extensionSecs: 30,
        leaseId: "lease_1",
      }),
    ).rejects.toMatchObject({ code: "LEASE_EXPIRED", statusCode: 409 });
    client.close();
  });

  it("stops the handler and does not ack when a gRPC lease loss hits the heartbeat", async () => {
    vi.useFakeTimers();
    const leaseError = await captureLeaseError(
      "RenewLease",
      "Lease expired",
      (client) =>
        client.queue.renewLease({
          jobId: "job_1",
          workerId: "worker_1",
          extensionSecs: 30,
          leaseId: "lease_1",
        }),
    );

    const heartbeat = vi.fn().mockRejectedValue(leaseError);
    const complete = vi.fn().mockResolvedValue({ success: true });
    const fail = vi.fn().mockResolvedValue({ success: true });
    const claim = vi
      .fn()
      .mockResolvedValueOnce({
        jobs: [
          {
            id: "job_1",
            queueName: "q",
            payload: {},
            retryCount: 0,
            maxRetries: 3,
            leaseId: "lease_1",
          },
        ],
      })
      .mockResolvedValue({ jobs: [] });
    const client = {
      getConfig: () => ({ debug: null }),
      workers: {
        register: vi
          .fn()
          .mockResolvedValue({ id: "w1", heartbeatIntervalSecs: 1000 }),
        heartbeat: vi.fn().mockResolvedValue({}),
        deregister: vi.fn().mockResolvedValue({}),
      },
      jobs: { claim, complete, fail, heartbeat },
    } as never;

    const worker = new SpooledWorker(client, {
      queueName: "q",
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 5,
      heartbeatFraction: 0.002,
      shutdownTimeout: 30,
    });

    let signal: AbortSignal | undefined;
    worker.process(async (ctx) => {
      signal = ctx.signal;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (ctx.signal.aborted) {
        throw new Error("lease lost");
      }
      return { ok: true };
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(30);

    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as ConflictError).code).toBe("LEASE_EXPIRED");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(heartbeat.mock.calls.length).toBeGreaterThan(0);

    await worker.stop();
  });

  it("does not emit error when complete is rejected with a gRPC lease loss", async () => {
    vi.useFakeTimers();
    const leaseError = await captureLeaseError(
      "Complete",
      LEASE_MISMATCH,
      (client) =>
        client.queue.complete({
          jobId: "job_1",
          workerId: "worker_1",
          leaseId: "lease_1",
        }),
    );

    const complete = vi.fn().mockRejectedValue(leaseError);
    const client = {
      getConfig: () => ({ debug: null }),
      workers: {
        register: vi
          .fn()
          .mockResolvedValue({ id: "w1", heartbeatIntervalSecs: 1000 }),
        heartbeat: vi.fn().mockResolvedValue({}),
        deregister: vi.fn().mockResolvedValue({}),
      },
      jobs: {
        claim: vi
          .fn()
          .mockResolvedValueOnce({
            jobs: [
              {
                id: "job_1",
                queueName: "q",
                payload: {},
                retryCount: 0,
                maxRetries: 3,
                leaseId: "lease_1",
              },
            ],
          })
          .mockResolvedValue({ jobs: [] }),
        complete,
        fail: vi.fn().mockResolvedValue({ success: true }),
        heartbeat: vi.fn().mockResolvedValue({ success: true }),
      },
    } as never;

    const worker = new SpooledWorker(client, {
      queueName: "q",
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 30,
      heartbeatFraction: 0.5,
    });
    const errors = vi.fn();
    worker.on("error", errors);
    worker.process(async () => ({ ok: true }));

    await worker.start();
    await vi.advanceTimersByTimeAsync(20);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    await worker.stop();
  });
});
