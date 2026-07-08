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
  WebSocketCommandResponse,
} from './types.js';
import { convertResponse } from '../utils/casing.js';

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
  private subscriptions: Map<string, SubscriptionFilter> = new Map();
  private pendingCommands: Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  // Event handlers
  private eventHandlers: Map<RealtimeEventType, Set<EventHandler>> = new Map();
  private allEventsHandlers: Set<GenericEventHandler> = new Set();
  private stateChangeHandlers: Set<(state: ConnectionState) => void> = new Set();

  constructor(options: RealtimeConnectionOptions) {
    this.options = {
      autoReconnect: true,
      maxReconnectAttempts: 10,
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      debug: () => {},
      ...options,
      // Always resolve to a provider so reconnects can mint a fresh JWT.
      // Falls back to the static token when no provider is supplied.
      tokenProvider: options.tokenProvider ?? (async () => options.token),
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
          this.handleDisconnect();
          if (this.state === 'connecting') {
            reject(new Error(`WebSocket connection failed: ${event.reason || 'Unknown error'}`));
          }
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.ws.onerror = (event: any) => {
          this.options.debug('WebSocket error', event);
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
    this.clearPendingCommands();
  }

  /**
   * Subscribe to events matching a filter
   */
  async subscribe(filter: SubscriptionFilter): Promise<void> {
    const filterId = this.filterToId(filter);

    if (this.subscriptions.has(filterId)) {
      return; // Already subscribed
    }

    this.subscriptions.set(filterId, filter);

    if (this.state === 'connected') {
      await this.sendCommand({ type: 'subscribe', filter });
    }
  }

  /**
   * Unsubscribe from events matching a filter
   */
  async unsubscribe(filter: SubscriptionFilter): Promise<void> {
    const filterId = this.filterToId(filter);

    if (!this.subscriptions.has(filterId)) {
      return; // Not subscribed
    }

    this.subscriptions.delete(filterId);

    if (this.state === 'connected') {
      await this.sendCommand({ type: 'unsubscribe', filter });
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
    // Mint a fresh JWT on every (re)connect so a stale token never blocks recovery.
    const token = await this.options.tokenProvider();
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
      const message = convertResponse(JSON.parse(data));

      // Check if this is a command response
      if (message.type === 'subscribed' || message.type === 'unsubscribed' || message.type === 'error') {
        this.handleCommandResponse(message as WebSocketCommandResponse);
        return;
      }

      // Handle as event
      const event = message as RealtimeEvent;
      this.options.debug(`Received event: ${event.type}`, event);

      // Emit to specific handlers
      const handlers = this.eventHandlers.get(event.type);
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

  private handleCommandResponse(response: WebSocketCommandResponse): void {
    if (!response.requestId) {
      return;
    }

    const pending = this.pendingCommands.get(response.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(response.requestId);

    if (response.type === 'error') {
      pending.reject(new Error(response.error || 'Unknown error'));
    } else {
      pending.resolve();
    }
  }

  private handleDisconnect(): void {
    this.ws = null;
    this.clearPendingCommands();

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
        // handleDisconnect will schedule another attempt if needed
      }
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    for (const filter of this.subscriptions.values()) {
      try {
        await this.sendCommand({ type: 'subscribe', filter });
      } catch (error) {
        this.options.debug('Failed to resubscribe', { filter, error });
      }
    }
  }

  private async sendCommand(command: Omit<WebSocketCommand, 'requestId'>): Promise<void> {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('WebSocket not connected');
    }

    const requestId = this.generateRequestId();
    const fullCommand: WebSocketCommand = { ...command, requestId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error('Command timeout'));
      }, 10000);

      this.pendingCommands.set(requestId, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(fullCommand));
    });
  }

  private clearPendingCommands(): void {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingCommands.clear();
  }

  private filterToId(filter: SubscriptionFilter): string {
    return JSON.stringify(filter);
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Redact sensitive auth query params (token/api_key) from a URL for logging.
 */
export function redactToken(url: string): string {
  return url.replace(/([?&](?:token|api_key)=)[^&]*/gi, '$1***');
}
