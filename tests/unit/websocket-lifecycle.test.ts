/**
 * WebSocket client reconnect lifecycle.
 *
 * A fake installed on globalThis stands in for the server end of the socket.
 * The client uses the global WebSocket when one exists.
 */

/* eslint-disable no-unused-vars -- TS function-type parameter names */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { WebSocketRealtimeClient } from "../../src/realtime/websocket.js";

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(_data: string): void {}

  close(): void {
    this.serverClose(1000, "client");
  }

  open(): void {
    this.onopen?.();
  }

  serverMessage(data: string): void {
    this.onmessage?.({ data });
  }

  serverClose(code = 1011, reason = "event channel closed"): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.({ code, reason });
  }
}

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];

/** The Error event the server sends before close 1011 (event channel closed). */
const channelClosedFrame = JSON.stringify({
  type: "Error",
  data: {
    message: "Realtime event channel closed; reconnect to resume events",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
});

const attempts = (client: WebSocketRealtimeClient) =>
  (client as { reconnectAttempts: number }).reconnectAttempts;

describe("WebSocketRealtimeClient reconnect lifecycle", () => {
  const previousWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousWebSocket === undefined) {
      delete (globalThis as { WebSocket?: unknown }).WebSocket;
    } else {
      (globalThis as { WebSocket?: unknown }).WebSocket = previousWebSocket;
    }
  });

  function makeClient(
    overrides: Partial<
      ConstructorParameters<typeof WebSocketRealtimeClient>[0]
    > = {},
  ) {
    const client = new WebSocketRealtimeClient({
      baseUrl: "https://api.spooled.cloud",
      wsUrl: "wss://api.spooled.cloud",
      token: "jwt",
      maxReconnectAttempts: 3,
      reconnectDelay: 10,
      maxReconnectDelay: 100,
      ...overrides,
    });
    return { client };
  }

  async function connect(client: WebSocketRealtimeClient) {
    const before = FakeSocket.instances.length;
    const connecting = client.connect();
    for (let i = 0; i < 20 && FakeSocket.instances.length === before; i++) {
      await vi.advanceTimersByTimeAsync(0);
    }
    last().open();
    await connecting;
  }

  it("gives up after maxReconnectAttempts when the server accepts and closes at once", async () => {
    const logs: string[] = [];
    const { client } = makeClient({
      maxReconnectAttempts: 3,
      debug: (message) => logs.push(message),
    });
    await connect(client);
    // The upgrade succeeded, then the server closed (event channel cannot be
    // opened). Opening used to zero the attempt counter, so this never ended.
    last().serverClose(1011, "event channel closed");

    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(200);
      const sock = last();
      if (!sock.closed) {
        sock.open();
        sock.serverClose(1011, "event channel closed");
      }
    }

    expect(FakeSocket.instances).toHaveLength(1 + 3);
    expect(client.getState()).toBe("disconnected");

    const scheduled = logs.filter((line) =>
      line.startsWith("Scheduling reconnect"),
    );
    expect(scheduled.map((line) => /attempt (\d+)/.exec(line)?.[1])).toEqual([
      "1",
      "2",
      "3",
    ]);
    const delays = scheduled.map((line) =>
      Number(/in (\d+)ms/.exec(line)?.[1]),
    );
    // Exponential backoff still applies: each failed accept-and-close waits
    // longer than the one before it.
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it("refills the attempt budget after a connection that stayed up", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);
    last().serverClose();
    await vi.advanceTimersByTimeAsync(200);
    last().open();
    expect(attempts(client)).toBe(1);

    await vi.advanceTimersByTimeAsync(31_000);
    last().serverClose();

    // Reset to 0 by the stable connection, then +1 for this reconnect.
    expect(attempts(client)).toBe(1);
    expect(client.getState()).toBe("reconnecting");
  });

  it("does not refill the attempt budget when an error frame is followed by an immediate close", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 2 });
    await connect(client);
    last().serverClose();
    await vi.advanceTimersByTimeAsync(200);
    last().open();
    expect(attempts(client)).toBe(1);

    // ChannelClosed sends this Error event and then close 1011. The frame
    // used to zero the counter, so the client dialed forever.
    last().serverMessage(channelClosedFrame);
    last().serverClose(1011, "event channel closed");

    expect(attempts(client)).toBe(2);
    expect(client.getState()).toBe("reconnecting");
  });

  it("gives up after maxReconnectAttempts when the server sends an error frame and closes", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);

    for (let i = 0; i < 12; i++) {
      const sock = last();
      if (!sock.closed) {
        sock.serverMessage(channelClosedFrame);
        sock.serverClose(1011, "event channel closed");
      }
      await vi.advanceTimersByTimeAsync(200);
      const next = last();
      if (!next.closed) {
        next.open();
      }
    }

    expect(FakeSocket.instances).toHaveLength(1 + 3);
    expect(client.getState()).toBe("disconnected");
  });

  it("resets the attempt budget when disconnecting a connection that stayed up", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);
    last().serverClose();
    await vi.advanceTimersByTimeAsync(200);
    last().open();
    expect(attempts(client)).toBe(1);

    await vi.advanceTimersByTimeAsync(31_000);
    client.disconnect();

    expect(attempts(client)).toBe(0);
    expect(client.getState()).toBe("disconnected");

    // The next session starts with a full budget.
    await connect(client);
    last().serverClose();
    expect(client.getState()).toBe("reconnecting");
    expect(attempts(client)).toBe(1);
  });

  it("keeps a spent attempt budget when disconnecting a connection that just opened", async () => {
    const { client } = makeClient({ maxReconnectAttempts: 3 });
    await connect(client);
    last().serverClose();
    await vi.advanceTimersByTimeAsync(200);
    last().open();
    last().serverMessage(channelClosedFrame);
    expect(attempts(client)).toBe(1);

    client.disconnect();

    expect(attempts(client)).toBe(1);
    expect(client.getState()).toBe("disconnected");
  });
});
