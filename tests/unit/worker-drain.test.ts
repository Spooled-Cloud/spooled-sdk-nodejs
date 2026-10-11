/**
 * Worker graceful stop, job timeouts and failure text.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { SpooledWorker } from "../../src/worker/worker.js";

/* eslint-disable no-unused-vars -- TS function-type parameter names */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
/* eslint-enable no-unused-vars */

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Fake client that records the order of every ack/deregister call. */
function makeClient(jobOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const job = {
    id: "job_1",
    queueName: "q",
    payload: {},
    retryCount: 0,
    maxRetries: 3,
    timeoutSeconds: 0,
    leaseId: "lease_1",
    ...jobOverrides,
  };
  const claim = vi
    .fn()
    .mockImplementationOnce(async () => {
      calls.push("claim");
      return { jobs: [job] };
    })
    .mockImplementation(async () => {
      calls.push("claim");
      return { jobs: [] };
    });
  const complete = vi.fn(async () => {
    calls.push("complete");
    return { success: true };
  });
  const fail = vi.fn(async () => {
    calls.push("fail");
    return { success: true };
  });
  const jobHeartbeat = vi.fn(async () => ({ success: true }));
  const workerHeartbeat = vi.fn(async () => {
    calls.push("worker-heartbeat");
  });
  const deregister = vi.fn(async () => {
    calls.push("deregister");
  });

  const client = {
    getConfig: () => ({ debug: null }),
    workers: {
      register: vi.fn(async () => ({ id: "w1", heartbeatIntervalSecs: 1 })),
      heartbeat: workerHeartbeat,
      deregister,
    },
    jobs: { claim, complete, fail, heartbeat: jobHeartbeat },
  } as any;

  return {
    client,
    calls,
    claim,
    complete,
    fail,
    deregister,
    jobHeartbeat,
    workerHeartbeat,
  };
}

async function startAndClaim(worker: SpooledWorker) {
  await worker.start();
  await vi.advanceTimersByTimeAsync(10); // first poll claims the job
}

describe("graceful stop drains (SDKNP-01)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = {
    queueName: "q",
    concurrency: 1,
    pollInterval: 10,
    leaseDuration: 30,
    shutdownTimeout: 5000,
  };

  it("completes a handler that returns after stop was requested, then deregisters", async () => {
    const { client, calls, complete, fail } = makeClient();
    const worker = new SpooledWorker(client, options);
    const gate = deferred<{ ok: boolean }>();
    let signal!: AbortSignal;
    worker.process((ctx) => {
      signal = ctx.signal;
      return gate.promise;
    });

    await startAndClaim(worker);
    expect(worker.getActiveJobCount()).toBe(1);

    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(100);
    // Still draining: the handler has not finished, nothing was acked yet and
    // the handler was NOT told to abort.
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    expect(calls).not.toContain("deregister");

    gate.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    await stopped;

    expect(complete).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        workerId: "w1",
        leaseId: "lease_1",
        result: { ok: true },
      }),
    );
    expect(fail).not.toHaveBeenCalled();
    // Deregister is LAST: re-queueing happens only for jobs still held.
    expect(calls.slice(-2)).toEqual(["complete", "deregister"]);
    expect(worker.getState()).toBe("stopped");
  });

  it("fails a handler that throws after stop was requested", async () => {
    const { client, calls, fail, complete } = makeClient();
    const worker = new SpooledWorker(client, options);
    const gate = deferred<void>();
    worker.process(async () => {
      await gate.promise;
      throw new Error("downstream 500");
    });

    await startAndClaim(worker);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(50);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;

    expect(fail).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ error: "downstream 500", leaseId: "lease_1" }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(calls.slice(-2)).toEqual(["fail", "deregister"]);
  });

  it("stops claiming new jobs once stop is requested", async () => {
    const { client, claim } = makeClient();
    const worker = new SpooledWorker(client, options);
    const gate = deferred<void>();
    worker.process(() => gate.promise);

    await startAndClaim(worker);
    const claimsBeforeStop = claim.mock.calls.length;
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(claim.mock.calls.length).toBe(claimsBeforeStop);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
    expect(claim.mock.calls.length).toBe(claimsBeforeStop);
  });

  it("drains the jobs of a claim that was already on the wire when stop was requested", async () => {
    const { client, calls, claim, complete } = makeClient();
    const inFlight = deferred<{ jobs: unknown[] }>();
    claim.mockReset();
    claim.mockImplementationOnce(() => inFlight.promise);
    claim.mockResolvedValue({ jobs: [] });

    const worker = new SpooledWorker(client, options);
    const handlerGate = deferred<{ done: boolean }>();
    worker.process(() => handlerGate.promise);

    await worker.start();
    await vi.advanceTimersByTimeAsync(10); // poll starts; claim pending

    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(10);
    inFlight.resolve({
      jobs: [
        {
          id: "job_late",
          queueName: "q",
          payload: {},
          retryCount: 0,
          maxRetries: 3,
          timeoutSeconds: 0,
          leaseId: "lease_late",
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(10);
    handlerGate.resolve({ done: true });
    await vi.advanceTimersByTimeAsync(0);
    await stopped;

    expect(complete).toHaveBeenCalledWith(
      "job_late",
      expect.objectContaining({ leaseId: "lease_late" }),
    );
    expect(calls.slice(-2)).toEqual(["complete", "deregister"]);
  });

  it("aborts and fails a handler that outlives shutdownTimeout, and drops its late result", async () => {
    const { client, calls, fail, complete } = makeClient();
    const worker = new SpooledWorker(client, {
      ...options,
      shutdownTimeout: 200,
    });
    const gate = deferred<{ late: boolean }>();
    let signal!: AbortSignal;
    worker.process((ctx) => {
      signal = ctx.signal;
      return gate.promise; // ignores the abort signal
    });

    await startAndClaim(worker);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(199);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await stopped;

    expect(signal.aborted).toBe(true);
    expect(fail).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ error: "Worker shutdown timeout" }),
    );
    expect(calls.slice(-2)).toEqual(["fail", "deregister"]);
    expect(worker.getActiveJobCount()).toBe(0);

    // The handler finishes after the force-fail: its result must not be sent.
    gate.resolve({ late: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("waits for an ack already on the wire before deregistering", async () => {
    const { client, calls, complete } = makeClient();
    const ack = deferred<{ success: boolean }>();
    complete.mockImplementation(async () => {
      calls.push("complete");
      return ack.promise;
    });
    const worker = new SpooledWorker(client, {
      ...options,
      shutdownTimeout: 100,
    });
    const gate = deferred<{ ok: boolean }>();
    worker.process(() => gate.promise);

    await startAndClaim(worker);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(50);
    gate.resolve({ ok: true }); // handler returns; complete() is now in flight
    await vi.advanceTimersByTimeAsync(0);
    // Past the shutdown deadline with the ack still unanswered.
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).not.toContain("deregister");

    ack.resolve({ success: true });
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
    expect(calls.slice(-2)).toEqual(["complete", "deregister"]);
  });

  it("keeps heartbeating (worker and job) while draining", async () => {
    const { client, jobHeartbeat, workerHeartbeat } = makeClient();
    const worker = new SpooledWorker(client, {
      ...options,
      shutdownTimeout: 60_000,
      heartbeatFraction: 0.1, // 3 s job heartbeat
    });
    const gate = deferred<void>();
    worker.process(() => gate.promise);

    await startAndClaim(worker);
    const stopped = worker.stop();
    jobHeartbeat.mockClear();
    workerHeartbeat.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(jobHeartbeat.mock.calls.length).toBeGreaterThan(0);
    expect(workerHeartbeat.mock.calls.length).toBeGreaterThan(0);

    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
  });

  it("leaves no timer behind after a clean stop (SDKNP-19)", async () => {
    const { client } = makeClient();
    const worker = new SpooledWorker(client, options);
    const gate = deferred<{ ok: boolean }>();
    worker.process(() => gate.promise);

    await startAndClaim(worker);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(50);
    gate.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    await stopped;

    // The shutdownTimeout timer used to stay armed for the full 30 s after a
    // stop that drained in time.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not ack a handler that returns while its shutdown force-fail is still in flight", async () => {
    const { client, calls, fail, complete } = makeClient();
    const failAck = deferred<{ success: boolean }>();
    fail.mockImplementation(async () => {
      calls.push("fail");
      return failAck.promise;
    });
    const worker = new SpooledWorker(client, {
      ...options,
      shutdownTimeout: 100,
    });
    const gate = deferred<{ late: boolean }>();
    worker.process(() => gate.promise);

    await startAndClaim(worker);
    const stopped = worker.stop();
    await vi.advanceTimersByTimeAsync(150); // deadline passed; fail() in flight
    expect(fail).toHaveBeenCalledTimes(1);

    gate.resolve({ late: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).not.toHaveBeenCalled();

    failAck.resolve({ success: true });
    await vi.advanceTimersByTimeAsync(0);
    await stopped;
    expect(complete).not.toHaveBeenCalled();
    expect(calls.slice(-2)).toEqual(["fail", "deregister"]);
  });

  it("reports the worker id on the stopped event (SDKNP-20)", async () => {
    const { client } = makeClient();
    const worker = new SpooledWorker(client, options);
    worker.process(async () => undefined);
    const stopped = vi.fn();
    worker.on("stopped", stopped);

    await startAndClaim(worker);
    await worker.stop();

    expect(stopped).toHaveBeenCalledWith({
      workerId: "w1",
      reason: "graceful",
    });
  });
});

describe("job timeout (SDKNP-16)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = {
    queueName: "q",
    concurrency: 1,
    pollInterval: 10,
    leaseDuration: 30,
  };

  it("aborts the handler, emits job:timeout and fails the job with 'Job timeout exceeded'", async () => {
    const { client, calls, fail, complete } = makeClient({ timeoutSeconds: 2 });
    const worker = new SpooledWorker(client, options);
    const gate = deferred<{ late: boolean }>();
    let signal!: AbortSignal;
    worker.process((ctx) => {
      signal = ctx.signal;
      return gate.promise; // hangs and ignores the signal
    });
    const timeout = vi.fn();
    const failed = vi.fn();
    worker.on("job:timeout", timeout);
    worker.on("job:failed", failed);

    await startAndClaim(worker);
    expect(worker.getActiveJobCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1990);
    expect(fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);

    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("Job timeout exceeded");
    expect(timeout).toHaveBeenCalledWith({ jobId: "job_1", queueName: "q" });
    expect(fail).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        error: "Job timeout exceeded",
        leaseId: "lease_1",
      }),
    );
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Job timeout exceeded" }),
    );
    // The slot is released and the lease is no longer extended.
    expect(worker.getActiveJobCount()).toBe(0);
    const heartbeatsAtTimeout = (client.jobs.heartbeat as any).mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect((client.jobs.heartbeat as any).mock.calls.length).toBe(
      heartbeatsAtTimeout,
    );

    // A result arriving after the timeout is not sent.
    gate.resolve({ late: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(complete).not.toHaveBeenCalled();
    expect(calls.filter((c) => c === "fail")).toHaveLength(1);
  });

  it("does not time out a handler that finishes in time", async () => {
    const { client, complete, fail } = makeClient({ timeoutSeconds: 5 });
    const worker = new SpooledWorker(client, options);
    worker.process(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return { ok: true };
    });
    const timeout = vi.fn();
    worker.on("job:timeout", timeout);

    await startAndClaim(worker);
    await vi.advanceTimersByTimeAsync(1100);
    expect(complete).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fail).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
  });

  it("applies no timeout when timeoutSeconds is 0 or absent", async () => {
    const { client, fail } = makeClient({ timeoutSeconds: 0 });
    // A slow poll keeps the hour of fake time below cheap.
    const worker = new SpooledWorker(client, {
      ...options,
      pollInterval: 1000,
    });
    worker.process(() => new Promise<void>(() => {}));

    await worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fail).not.toHaveBeenCalled();
    expect(worker.getActiveJobCount()).toBe(1);
  });
});

describe("failure text and ack errors", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = {
    queueName: "q",
    concurrency: 1,
    pollInterval: 10,
    leaseDuration: 30,
  };

  it("sends 'Job failed' when the handler throws an empty message", async () => {
    const { client, fail } = makeClient();
    const worker = new SpooledWorker(client, options);
    worker.process(async () => {
      throw new Error("");
    });

    await startAndClaim(worker);
    await vi.advanceTimersByTimeAsync(0);

    expect(fail).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({ error: "Job failed" }),
    );
  });

  it("truncates an over-long failure message to 2048 characters", async () => {
    const { client, fail } = makeClient();
    const worker = new SpooledWorker(client, options);
    worker.process(async () => {
      throw new Error("x".repeat(10_000));
    });
    const failed = vi.fn();
    worker.on("job:failed", failed);

    await startAndClaim(worker);
    await vi.advanceTimersByTimeAsync(0);

    const sent = (
      fail.mock.calls[0] as unknown as [string, { error: string }]
    )[1].error;
    expect(sent).toHaveLength(2048);
    expect(failed.mock.calls[0][0].error).toHaveLength(2048);
  });

  it("emits an error event when an ack finally fails", async () => {
    const { client, complete } = makeClient();
    complete.mockRejectedValue(new Error("502 after retries"));
    const worker = new SpooledWorker(client, options);
    worker.process(async () => ({ ok: true }));
    const errors: Error[] = [];
    worker.on("error", ({ error }) => errors.push(error));

    await startAndClaim(worker);
    await vi.advanceTimersByTimeAsync(0);

    expect(errors.map((e) => e.message)).toContain("502 after retries");
  });
});

describe("autoStart (SDKNP-21)", () => {
  afterEach(() => vi.useRealTimers());

  it("does not turn a failed registration into an unhandled rejection", async () => {
    const { client } = makeClient();
    client.workers.register.mockRejectedValue(new Error("register 500"));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const worker = new SpooledWorker(client, {
        queueName: "q",
        autoStart: true,
      });
      worker.process(async () => undefined);
      const errors: Error[] = [];
      worker.on("error", ({ error }) => errors.push(error));

      await new Promise((r) => setTimeout(r, 30));

      expect(errors.map((e) => e.message)).toEqual(["register 500"]);
      expect(worker.getState()).toBe("error");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
