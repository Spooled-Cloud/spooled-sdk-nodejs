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
    };
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    return new Promise((resolve, reject) => {
      this.setState('connecting');

      // Build WebSocket URL with token
      const wsUrl = this.buildWsUrl();
      this.options.debug(`Connecting to ${wsUrl}`);

      try {
        // Use ws package in Node.js, native WebSocket in browser
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');

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

  private buildWsUrl(): string {
    // wsUrl should already be ws:// or wss://
    const wsBase = this.options.wsUrl;
    return `${wsBase}/api/v1/ws?token=${encodeURIComponent(this.options.token)}`;
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateChangeHandlers.forEach((handler) => handler(state));
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

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

    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay
    );

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
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
