/**
 * SSE Realtime Client
 *
 * Provides real-time event streaming over Server-Sent Events.
 */

import type {
  RealtimeConnectionOptions,
  RealtimeEvent,
  RealtimeEventType,
  SubscriptionFilter,
  ConnectionState,
} from "./types.js";
import { convertResponse } from "../utils/casing.js";
import { mapEventType } from "./event-map.js";

/** Event handler type - simplified for internal use */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (data: any) => void;

/** Generic event handler */
type GenericEventHandler = (event: RealtimeEvent) => void;

/**
 * Every SSE `event:` name the API sends. The server always names its frames
 * (`event: job.completed`), and an EventSource delivers named frames only to
 * `addEventListener(name, ...)` — `onmessage` sees unnamed frames alone — so
 * without these listeners the client received nothing at all.
 */
export const SSE_EVENT_NAMES = [
  "job.created",
  "job.status",
  "job.completed",
  "job.failed",
  "queue.stats",
  "worker.heartbeat",
  "worker.registered",
  "worker.deregistered",
  "system.health",
  "ping",
  "error",
] as const;

/**
 * Job statuses after which the API closes a job stream
 * (`/events/jobs/{id}` ends once the job reaches one of these).
 */
const TERMINAL_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "deadletter",
  "cancelled",
]);

/**
 * How long a connection must stay open before it counts as healthy and gives
 * the next reconnect a fresh attempt budget. A stream the server closes right
 * after opening is not healthy, however "successfully" it opened.
 */
const STABLE_CONNECTION_MS = 30_000;

/**
 * SSE Realtime Client
 *
 * Connects to the Spooled API SSE endpoint and emits typed events.
 * SSE is unidirectional - subscriptions must be set at connection time.
 */
export class SseRealtimeClient {
  private readonly options: Required<RealtimeConnectionOptions>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private eventSource: any = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private filter: SubscriptionFilter | null = null;
  /** When the current connection opened (for the stable-connection check). */
  private connectedAt: number | null = null;
  /** The server finished this stream on purpose (terminal job); do not reconnect. */
  private streamEnded = false;
  /** The server rejected our token; mint a fresh one for the next connect. */
  private forceTokenRefresh = false;

  // Event handlers
  private eventHandlers: Map<RealtimeEventType, Set<EventHandler>> = new Map();
  private allEventsHandlers: Set<GenericEventHandler> = new Set();
  private stateChangeHandlers: Set<(state: ConnectionState) => void> =
    new Set();

  constructor(options: RealtimeConnectionOptions) {
    // Defaults applied AFTER the spread — a pre-spread default is clobbered by an
    // explicit `undefined` forwarded from SpooledRealtime (e.g. autoReconnect would
    // resolve to undefined/falsy, silently disabling reconnect despite the
    // documented default `true`).
    this.options = {
      ...options,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      // Always resolve to a provider so reconnects can mint a fresh token.
      // Falls back to the static token when no provider is supplied.
      tokenProvider: options.tokenProvider ?? (async () => options.token),
      // Coalesce debug to a no-op AFTER the spread. A caller that omits debug
      // still passes `debug: undefined` explicitly (e.g. via SpooledRealtime),
      // and spreading that would overwrite a pre-spread default with undefined,
      // making connect() call `this.options.debug(...)` on undefined and throw
      // "this.options.debug is not a function". Guarding here keeps it callable
      // regardless of what the caller passes.
      debug: options.debug ?? (() => {}),
    };
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Connect to the SSE server with a subscription filter
   */
  async connect(filter?: SubscriptionFilter): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.filter = filter || null;
    this.streamEnded = false;

    this.setState("connecting");

    const sseUrl = this.buildSseUrl(filter);
    this.options.debug(`Connecting to SSE: ${sseUrl}`);

    // Use eventsource package in Node.js, native EventSource in browser
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let EventSourceImpl: any;
    if (typeof EventSource !== "undefined") {
      EventSourceImpl = EventSource;
    } else {
      // Dynamic import for ESM compatibility
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod = (await import("eventsource")) as any;
        EventSourceImpl = mod.default || mod.EventSource || mod;
      } catch {
        this.setState("disconnected");
        throw new Error(
          "eventsource package is required for SSE in Node.js. Install it with: npm install eventsource",
        );
      }
    }

    // Ask the provider on every (re)connect so a stale token never blocks
    // recovery. It caches the JWT itself, so only force a new login after the
    // server actually rejected the token (a 401/403), not on every retry.
    let token: string;
    try {
      const force = this.forceTokenRefresh;
      this.forceTokenRefresh = false;
      token = await this.options.tokenProvider(force);
    } catch (error) {
      this.setState("disconnected");
      throw new Error(`Failed to acquire realtime token: ${error}`);
    }

    return new Promise((resolve, reject) => {
      try {
        // Create EventSource with authorization header
        // Note: eventsource v4 changed API - headers are now passed via custom fetch
        this.eventSource = new EventSourceImpl(sseUrl, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          fetch: (input: any, init: any) =>
            fetch(input, {
              ...init,
              headers: {
                ...init?.headers,
                Authorization: `Bearer ${token}`,
              },
            }),
        });

        this.eventSource.onopen = () => {
          this.options.debug("SSE connected");
          this.setState("connected");
          // The attempt counter is NOT reset here: an open that the server
          // closes at once (a finished job's stream) would otherwise refill the
          // budget on every cycle and reconnect forever. It resets once the
          // connection has proved stable (see handleDisconnect).
          this.connectedAt = Date.now();
          resolve();
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventSource.onmessage = (event: any) => {
          this.handleMessage(event.data);
        };
        for (const name of SSE_EVENT_NAMES) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.eventSource.addEventListener(name, (event: any) => {
            // "error" also fires for connection failures, which carry no data
            // and are handled by onerror below.
            if (typeof event?.data === "string") this.handleMessage(event.data);
          });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventSource.onerror = (event: any) => {
          this.options.debug("SSE error");

          // The `eventsource` package reports the HTTP status of a rejected
          // connection as `code`.
          if (event?.code === 401 || event?.code === 403) {
            this.forceTokenRefresh = true;
          }

          if (this.state === "connecting") {
            this.setState("disconnected");
            // Close the abandoned EventSource so it doesn't keep auto-reconnecting
            // in the background after we reject the initial connect promise.
            if (this.eventSource) {
              this.eventSource.close();
              this.eventSource = null;
            }
            reject(new Error("SSE connection failed"));
            return;
          }

          this.handleDisconnect();
        };
      } catch (error) {
        this.setState("disconnected");
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the SSE server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.setState("disconnected");
    this.filter = null;
    this.connectedAt = null;
    this.streamEnded = false;
  }

  /**
   * Reconnect with a new filter (SSE requires reconnection to change subscriptions)
   */
  async reconnect(filter?: SubscriptionFilter): Promise<void> {
    this.disconnect();
    await this.connect(filter);
  }

  /**
   * Add an event listener for a specific event type
   */
  on<T extends RealtimeEventType>(type: T, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);

    return () => this.off(type, handler);
  }

  /**
   * Remove an event listener
   */
  off<T extends RealtimeEventType>(type: T, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Add a listener for all events
   */
  onEvent(handler: GenericEventHandler): () => void {
    this.allEventsHandlers.add(handler);
    return () => this.allEventsHandlers.delete(handler);
  }

  /**
   * Add a listener for state changes
   */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  // Private methods

  private buildSseUrl(filter?: SubscriptionFilter): string {
    // Backend SSE endpoints:
    // - GET /api/v1/events (every org event; ?queue= narrows it to one queue)
    // - GET /api/v1/events/jobs/{id} (single job status stream)
    // - GET /api/v1/events/queues/{name} (queue.stats counters only)
    //
    // A queue subscription uses /events?queue=: the per-queue route carries only
    // queue.stats, so `on('job.created')` after `subscribe({ queueName })` would
    // never fire there. Requires API 0.1.114+.
    if (filter?.jobId) {
      return `${this.options.baseUrl}/api/v1/events/jobs/${encodeURIComponent(filter.jobId)}`;
    }
    if (filter?.queueName) {
      return `${this.options.baseUrl}/api/v1/events?queue=${encodeURIComponent(filter.queueName)}`;
    }
    return `${this.options.baseUrl}/api/v1/events`;
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateChangeHandlers.forEach((handler) => handler(state));
    }
  }

  private handleMessage(data: string): void {
    try {
      // Backend emits snake_case; convert to camelCase to match the typed
      // event shapes. User blobs (`result`/`payload`) are preserved via
      // SKIP_CONVERSION_KEYS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = convertResponse(JSON.parse(data)) as any;
      // Translate the backend's PascalCase variant name (`JobCompleted`) to the
      // SDK's dotted event name (`job.completed`) before dispatch, matching the
      // WebSocket client. Unknown/pre-dotted names pass through unchanged.
      const eventType = mapEventType(String(parsed.type));
      parsed.type = eventType;
      const event = parsed as RealtimeEvent;
      this.options.debug(`Received SSE event: ${eventType}`, event);

      // A job stream ends once the job is terminal; remember it so the close
      // that follows is not treated as a dropped connection.
      if (this.filter?.jobId && isStreamEndingEvent(eventType, parsed.data)) {
        this.streamEnded = true;
      }

      // Emit to specific handlers
      const handlers = this.eventHandlers.get(eventType as RealtimeEventType);
      if (handlers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventData = (event as any).data;
        handlers.forEach((handler) => {
          try {
            handler(eventData);
          } catch (error) {
            this.options.debug("Event handler error", error);
          }
        });
      }

      // Emit to all-events handlers
      this.allEventsHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          this.options.debug("Event handler error", error);
        }
      });
    } catch (error) {
      this.options.debug("Failed to parse SSE message", { data, error });
    }
  }

  private handleDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // The server ended this stream deliberately (a terminal job): reconnecting
    // would only replay the terminal event again and again.
    if (this.streamEnded) {
      this.connectedAt = null;
      this.setState("disconnected");
      return;
    }

    // A connection that stayed up long enough was healthy (e.g. the server's
    // 30 minute cap closed it): give the reconnect a fresh budget. One that
    // closed right after opening keeps counting toward maxReconnectAttempts.
    if (
      this.connectedAt !== null &&
      Date.now() - this.connectedAt >= STABLE_CONNECTION_MS
    ) {
      this.reconnectAttempts = 0;
    }
    this.connectedAt = null;

    if (
      this.options.autoReconnect &&
      this.reconnectAttempts < this.options.maxReconnectAttempts
    ) {
      this.scheduleReconnect();
    } else {
      this.setState("disconnected");
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    this.reconnectAttempts++;

    const baseDelay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay,
    );
    // Add randomized jitter (up to +25%) to avoid synchronized reconnect
    // storms across clients. Matches utils/retry.ts.
    const delay = Math.floor(baseDelay + Math.random() * baseDelay * 0.25);

    this.options.debug(
      `Scheduling SSE reconnect attempt ${this.reconnectAttempts} in ${delay}ms`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.filter || undefined);
      } catch (error) {
        this.options.debug("SSE reconnect failed", error);
        if (
          this.options.autoReconnect &&
          this.reconnectAttempts < this.options.maxReconnectAttempts
        ) {
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      }
    }, delay);
  }
}

/**
 * Whether an inbound event means the API is about to close this job stream:
 * the job reached a terminal status, or the server sent its own `error` (e.g.
 * "Job not found"), which it follows by closing the stream.
 */
function isStreamEndingEvent(eventType: string, data: unknown): boolean {
  if (eventType === "error" || eventType === "job.completed") {
    return true;
  }
  const record = (data ?? {}) as { newStatus?: unknown; willRetry?: unknown };
  if (eventType === "job.failed") {
    return record.willRetry === false;
  }
  if (eventType === "job.status_changed" || eventType === "job.status") {
    return (
      typeof record.newStatus === "string" &&
      TERMINAL_JOB_STATUSES.has(record.newStatus)
    );
  }
  return false;
}
