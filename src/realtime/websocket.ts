/**
 * WebSocket Realtime Client
 *
 * Provides real-time event streaming over WebSocket.
 */

import type {
  RealtimeConnectionOptions,
  RealtimeEvent,
  RealtimeEventType,
  SubscriptionFilter,
  ConnectionState,
  WebSocketCommand,
} from './types.js';
import { convertResponse } from '../utils/casing.js';
import { mapEventType } from './event-map.js';

/** Event handler type - simplified for internal use */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (data: any) => void;

/** Generic event handler */
type GenericEventHandler = (event: RealtimeEvent) => void;

/**
 * WebSocket Realtime Client
 *
 * Connects to the Spooled API WebSocket endpoint and emits typed events.
 */
export class WebSocketRealtimeClient {
  private readonly options: Required<RealtimeConnectionOptions>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ws: any = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set when the server rejected our token on the upgrade (e.g. HTTP 401/403).
   * The next (re)connect uses it to force the token provider to mint a fresh
   * JWT instead of replaying the rejected one (which would loop forever).
   */
  private authFailure = false;
  private subscriptions: Map<string, SubscriptionFilter> = new Map();

  // Event handlers
  private eventHandlers: Map<RealtimeEventType, Set<EventHandler>> = new Map();
  private allEventsHandlers: Set<GenericEventHandler> = new Set();
  private stateChangeHandlers: Set<(state: ConnectionState) => void> = new Set();

  constructor(options: RealtimeConnectionOptions) {
    // All defaults are applied AFTER the spread. SpooledRealtime forwards each of
    // these options as possibly-`undefined`, and a pre-spread default is clobbered
    // by an explicit `undefined` — e.g. autoReconnect would resolve to undefined
    // (falsy), silently disabling reconnect despite the documented default `true`,
    // and debug would become undefined and throw when connect() calls it.
    this.options = {
      ...options,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
      // Always resolve to a provider so reconnects can mint a fresh JWT.
      // Falls back to the static token when no provider is supplied.
      tokenProvider: options.tokenProvider ?? (async () => options.token),
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
   * Get WebSocket implementation (browser native or Node.js ws package)
   */
  private async getWebSocketImpl(): Promise<typeof WebSocket> {
    if (typeof WebSocket !== 'undefined') {
      return WebSocket;
    }
    // Node.js environment - use ws package with dynamic import for ESM compatibility
    const wsModule = await import('ws');
    return wsModule.default as unknown as typeof WebSocket;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');

    // Build WebSocket URL with a freshly-minted token
    let wsUrl: string;
    try {
      wsUrl = await this.buildWsUrl();
    } catch (error) {
      this.setState('disconnected');
      throw new Error(`Failed to acquire realtime token: ${error}`);
    }
    // Redact the token query param so JWTs never land in logs.
    this.options.debug(`Connecting to ${redactToken(wsUrl)}`);

    // Get WebSocket implementation (async for ESM compatibility in Node.js)
    let WebSocketImpl: typeof WebSocket;
    try {
      WebSocketImpl = await this.getWebSocketImpl();
    } catch (error) {
      this.setState('disconnected');
      throw new Error(`Failed to load WebSocket implementation: ${error}`);
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocketImpl(wsUrl);

        this.ws.onopen = () => {
          this.options.debug('WebSocket connected');
          this.setState('connected');
          this.reconnectAttempts = 0;
          this.resubscribeAll();
          resolve();
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws.onmessage = (event: any) => {
          this.handleMessage(typeof event.data === 'string' ? event.data : String(event.data));
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws.onclose = (event: any) => {
          this.options.debug(`WebSocket closed: ${event.code} ${event.reason}`);
          const wasConnecting = this.state === 'connecting';
          this.handleDisconnect();
          if (wasConnecting) {
            reject(new Error(`WebSocket connection failed: ${event.reason || 'Unknown error'}`));
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws.onerror = (event: any) => {
          this.options.debug('WebSocket error', event);
          // The Node `ws` package surfaces a rejected upgrade here as an error
          // whose message is e.g. "Unexpected server response: 401". Flag it so
          // the next reconnect forces a fresh token rather than replaying the
          // rejected one. (Browsers don't expose the status; expiry-based
          // refresh still covers the common case there.)
          if (isAuthFailureEvent(event)) {
            this.authFailure = true;
          }
        };
      } catch (error) {
        this.setState('disconnected');
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
    this.subscriptions.clear();
  }

  /**
   * Subscribe to events matching a filter.
   *
   * The server applies filtering itself and sends no acknowledgement, so this
   * resolves as soon as the command has been written to the socket. The filter
   * is tracked locally so it is replayed automatically on reconnect.
   */
  async subscribe(filter: SubscriptionFilter): Promise<void> {
    const filterId = this.filterToId(filter);

    if (this.subscriptions.has(filterId)) {
      return; // Already subscribed
    }

    this.subscriptions.set(filterId, filter);

    if (this.state === 'connected') {
      this.sendCommand('Subscribe', filter);
    }
  }

  /**
   * Unsubscribe from events matching a filter.
   *
   * Fire-and-forget, like {@link subscribe} — the server sends no ack.
   */
  async unsubscribe(filter: SubscriptionFilter): Promise<void> {
    const filterId = this.filterToId(filter);

    if (!this.subscriptions.has(filterId)) {
      return; // Not subscribed
    }

    this.subscriptions.delete(filterId);

    if (this.state === 'connected') {
      this.sendCommand('Unsubscribe', filter);
    }
  }

  /**
   * Add an event listener for a specific event type
   */
  on<T extends RealtimeEventType>(type: T, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);

    // Return unsubscribe function
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

  private async buildWsUrl(): Promise<string> {
    // wsUrl should already be ws:// or wss://
    const wsBase = this.options.wsUrl;
    // Reuse the provider's cached JWT unless the previous attempt was rejected
    // for auth (401/403 on the upgrade), in which case force a fresh token so a
    // stale/revoked one can't block recovery. Clear the flag either way.
    const forceRefresh = this.authFailure;
    this.authFailure = false;
    const token = await this.options.tokenProvider(forceRefresh);
    return `${wsBase}/api/v1/ws?token=${encodeURIComponent(token)}`;
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
      // event shapes (jobId, queueName, durationMs, ...). User blobs like
      // `result`/`payload` are preserved via SKIP_CONVERSION_KEYS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message = convertResponse(JSON.parse(data)) as any;

      // The backend tags events with the PascalCase enum variant name
      // (`JobCompleted`, `QueueStats`, ...); the SDK's public API dispatches by
      // dotted name (`job.completed`, `queue.stats`). Translate before dispatch
      // so `on('job.completed', ...)` fires. Unknown/pre-dotted names pass
      // through unchanged.
      const eventType = mapEventType(String(message.type));
      message.type = eventType;
      const event = message as RealtimeEvent;
      this.options.debug(`Received event: ${eventType}`, event);

      // Emit to specific handlers
      const handlers = this.eventHandlers.get(eventType as RealtimeEventType);
      if (handlers) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventData = (event as any).data;
        handlers.forEach((handler) => {
          try {
            handler(eventData);
          } catch (error) {
            this.options.debug('Event handler error', error);
          }
        });
      }

      // Emit to all-events handlers
      this.allEventsHandlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          this.options.debug('Event handler error', error);
        }
      });
    } catch (error) {
      this.options.debug('Failed to parse message', { data, error });
    }
  }

  private handleDisconnect(): void {
    this.ws = null;

    if (this.options.autoReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      this.setState('disconnected');
    }
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting');
    this.reconnectAttempts++;

    const baseDelay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay
    );
    // Add randomized jitter (up to +25%) to avoid a thundering-herd reconnect
    // storm when many clients drop at the same moment. Matches utils/retry.ts.
    const delay = Math.floor(baseDelay + Math.random() * baseDelay * 0.25);

    this.options.debug(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.options.debug('Reconnect failed', error);
        if (this.options.autoReconnect && this.reconnectAttempts < this.options.maxReconnectAttempts) {
          this.scheduleReconnect();
        } else {
          this.setState('disconnected');
        }
      }
    }, delay);
  }

  private resubscribeAll(): void {
    for (const filter of this.subscriptions.values()) {
      try {
        this.sendCommand('Subscribe', filter);
      } catch (error) {
        this.options.debug('Failed to resubscribe', { filter, error });
      }
    }
  }

  /**
   * Send a subscribe/unsubscribe command to the server.
   *
   * The backend `ClientCommand` shape is `{ cmd, queue, job_id }` and it sends
   * no acknowledgement, so this is fire-and-forget — it writes to the socket
   * and returns. The `SubscriptionFilter`'s `workerId`/`scheduleId` have no
   * server-side equivalent and are ignored.
   */
  private sendCommand(cmd: 'Subscribe' | 'Unsubscribe', filter: SubscriptionFilter): void {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('WebSocket not connected');
    }

    const command: WebSocketCommand = {
      cmd,
      queue: filter.queueName,
      job_id: filter.jobId,
    };
    this.ws.send(JSON.stringify(command));
  }

  private filterToId(filter: SubscriptionFilter): string {
    return JSON.stringify(filter);
  }
}

/**
 * Redact sensitive auth query params (token/api_key) from a URL for logging.
 */
export function redactToken(url: string): string {
  return url.replace(/([?&](?:token|api_key)=)[^&]*/gi, '$1***');
}

/**
 * Detect whether a WebSocket error event represents an auth rejection on the
 * upgrade (HTTP 401/403). The Node `ws` package reports these as an error whose
 * message is like "Unexpected server response: 401"; different runtimes may put
 * the text on `message`, `error.message`, or `reason`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isAuthFailureEvent(event: any): boolean {
  if (!event) {
    return false;
  }
  const status = event.status ?? event.statusCode ?? event.error?.status;
  if (status === 401 || status === 403) {
    return true;
  }
  const text = String(event.message ?? event.error?.message ?? event.reason ?? '');
  return /\b(401|403)\b/.test(text);
}
