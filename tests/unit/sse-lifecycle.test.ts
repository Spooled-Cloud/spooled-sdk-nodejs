/**
 * SSE client reconnect lifecycle (SDKNP-15, SDKNP-23).
 *
 * The client uses the global EventSource when one exists, so a fake installed
 * on globalThis stands in for the server end of the stream.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { SseRealtimeClient } from "../../src/realtime/sse.js";

/* eslint-disable no-unused-vars -- TS function-type parameter names */

const { packageSources } = vi.hoisted(() => ({
  packageSources: [] as Array<{
    url: string;
    init?: {
      fetch?: (
        input: unknown,
        init?: { headers?: Record<string, string> },
      ) => Promise<unknown>;
    };
    onopen: (() => void) | null;
  }>,
}));

vi.mock("eventsource", () => {
  class PackageEventSource {
    onopen: (() => void) | null = null;
    onmessage: unknown = null;
    onerror: unknown = null;
    url: string;
    init?: {
      fetch?: (
        input: unknown,
        init?: { headers?: Record<string, string> },
      ) => Promise<unknown>;
    };
    constructor(
      url: string,
      init?: {
        fetch?: (
          input: unknown,
          init?: { headers?: Record<string, string> },
        ) => Promise<unknown>;
      },
    ) {
      this.url = url;
      this.init = init;
      packageSources.push(this);
    }
    addEventListener(): void {}
    close(): void {}
  }
  return { default: PackageEventSource };
});

type MessageListener = (e: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: MessageListener | null = null;
  onerror: ((event: { code?: number }) => void) | null = null;
  closed = false;
  private listeners = new Map<string, MessageListener[]>();

  constructor(
    readonly url: string,
    readonly init: unknown,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, cb: MessageListener): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
  }

  close(): void {
    this.closed = true;
  }

  // Test controls (the server side of the stream).
  open(): void {
    this.onopen?.();
  }
  send(name: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const cb of this.listeners.get(name) ?? []) cb({ data });
  }
  fail(code?: number): void {
    this.onerror?.({ code });
  }
}

const jobStatus = (jobId: string, oldStatus: string, newStatus: string) => ({
  type: "JobStatusChange",
  data: {
    job_id: jobId,
    queue_name: "q",
    old_status: oldStatus,
    new_status: newStatus,
    timestamp: "2026-01-01T00:00:00Z",
  },
});

const last = () =>
  FakeEventSource.instances[FakeEventSource.instances.length - 1];

describe("SseRealtimeClient reconnect lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    (globalThis as any).EventSource = FakeEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).EventSource;
  });

  function makeClient(
    overrides: Partial<ConstructorParameters<typeof SseRealtimeClient>[0]> = {},
  ) {
    const tokenProvider = vi.fn(async (_force?: boolean) => "jwt");
    const client = new SseRealtimeClient({
      baseUrl: "https://api.spooled.cloud",
      wsUrl: "wss://api.spooled.cloud",
      token: "jwt",
      tokenProvider,
      maxReconnectAttempts: 3,
      reconnectDelay: 10,
      maxReconnectDelay: 100,
      ...overrides,
    });
    return { client, tokenProvider };
  }

  async function connect(client: SseRealtimeClient, filter?: object) {
    const connecting = client.connect(filter);
    await vi.advanceTimersByTimeAsync(0);
    last().open();
    await connecting;
  }

  it("does not reconnect a job stream the server ended after the terminal event, and does not replay it", async () => {
    const { client } = makeClient();
    const completed = vi.fn();
    client.on("job.status_changed", completed);

    await connect(client, { jobId: "job_1" });
    // The server's first frame for a finished job is its terminal status.
    last().send("job.status", jobStatus("job_1", "", "completed"));
    expect(completed).toHaveBeenCalledTimes(1);

    last().fail(); // the server closed the stream
    expect(client.getState()).toBe("disconnected");

    // Without the fix this reconnected every few seconds and re-delivered the
    // terminal event each time, forever.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "deadletter", "cancelled"])(
    "treats %s as terminal for a job stream",
    async (status) => {
      const { client } = makeClient();
      await connect(client, { jobId: "job_1" });
      last().send("job.status", jobStatus("job_1", "processing", status));
      last().fail();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(client.getState()).toBe("disconnected");
    },
  );

  it("treats the server's own error frame on a job stream as the end", async () => {
    const { client } = makeClient();
    await connect(client, { jobId: "job_gone" });
    last().send("error", { type: "Error", data: { message: "Job not found" } });
    last().fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("still reconnects a job stream that drops before the job is terminal", async () => {
    const { client } = makeClient();
    await connect(client, { jobId: "job_1" });
    last().send("job.status", jobStatus("job_1", "", "processing"));
    last().fail();
    expect(client.getState()).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(200);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(last().url).toContain("/events/jobs/job_1");
  });

  it("gives up after maxReconnectAttempts when every connection closes right after opening", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);
    last().fail();

    // Each reconnect "succeeds" (opens) and is closed at once. Opening used to
    // reset the attempt counter, so this never ended.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(200);
      const es = last();
      if (!es.closed) {
        es.open();
        es.fail();
      }
    }

    expect(FakeEventSource.instances).toHaveLength(1 + 3);
    expect(client.getState()).toBe("disconnected");
  });

  it("refills the attempt budget after a connection that stayed up (e.g. the 30 min server cap)", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);
    last().fail(); // 1st quick drop: attempts -> 1
    await vi.advanceTimersByTimeAsync(200);
    last().open();
    expect((client as any).reconnectAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(31_000); // healthy for > 30 s
    last().fail();

    // Reset to 0 by the stable connection, then +1 for this reconnect.
    expect((client as any).reconnectAttempts).toBe(1);
    expect(client.getState()).toBe("reconnecting");
  });

  it("forces a fresh token only after the server rejected it, not on every retry (SDKNP-23)", async () => {
    const { client, tokenProvider } = makeClient({ maxReconnectAttempts: 10 });
    await connect(client);
    expect(tokenProvider).toHaveBeenLastCalledWith(false);

    // Plain drop: reuse the cached token.
    last().fail();
    await vi.advanceTimersByTimeAsync(200);
    expect(tokenProvider).toHaveBeenLastCalledWith(false);
    last().open();

    // 401 from the server: the next connect forces a new token.
    last().fail(401);
    await vi.advanceTimersByTimeAsync(400);
    expect(tokenProvider).toHaveBeenLastCalledWith(true);
    last().open();

    // And only once.
    last().fail();
    await vi.advanceTimersByTimeAsync(800);
    expect(tokenProvider).toHaveBeenLastCalledWith(false);
  });

  it("authenticates a platform EventSource with the token query param, not fetch", async () => {
    const debug = vi.fn();
    const { client } = makeClient({
      tokenProvider: async () => "jwt+/= x",
      debug,
    });

    await connect(client, { queueName: "orders" });
    expect(last().url).toBe(
      "https://api.spooled.cloud/api/v1/events?queue=orders&token=" +
        encodeURIComponent("jwt+/= x"),
    );
    expect(last().init).toBeUndefined();

    const logged = debug.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("token=");
    expect(logged).not.toContain("jwt+");
    client.disconnect();

    const job = makeClient();
    await connect(job.client, { jobId: "job/1" });
    expect(last().url).toBe(
      "https://api.spooled.cloud/api/v1/events/jobs/" +
        `${encodeURIComponent("job/1")}?token=jwt`,
    );
    expect(last().init).toBeUndefined();
    job.client.disconnect();
  });

  it("keeps the Authorization header on the eventsource package and the token off the URL", async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    packageSources.length = 0;
    // A missed mock must not open a socket to production.
    const { client } = makeClient({
      baseUrl: "http://127.0.0.1:9",
      wsUrl: "ws://127.0.0.1:9",
    });

    const connecting = client.connect({ jobId: "job/1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(packageSources).toHaveLength(1);
    const src = packageSources[0];
    expect(src.url).toBe(
      `http://127.0.0.1:9/api/v1/events/jobs/${encodeURIComponent("job/1")}`,
    );
    expect(src.url).not.toContain("token=");

    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await src.init?.fetch?.("http://127.0.0.1:9/events", {
        headers: { Accept: "text/event-stream" },
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9/events", {
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer jwt",
      },
    });

    src.onopen?.();
    await connecting;
    client.disconnect();
  });
});
