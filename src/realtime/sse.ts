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
} from './types.js';

/** Event handler type - simplified for internal use */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (data: any) => void;

/** Generic event handler */
type GenericEventHandler = (event: RealtimeEvent) => void;

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
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private filter: SubscriptionFilter | null = null;

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
   * Connect to the SSE server with a subscription filter
   */
  async connect(filter?: SubscriptionFilter): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.filter = filter || null;

    return new Promise((resolve, reject) => {
      this.setState('connecting');

      const sseUrl = this.buildSseUrl(filter);
      this.options.debug(`Connecting to SSE: ${sseUrl}`);

      try {
        // Use eventsource package in Node.js, native EventSource in browser
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
        const EventSourceImpl = typeof EventSource !== 'undefined' ? EventSource : require('eventsource');

        // Create EventSource with authorization header
        this.eventSource = new EventSourceImpl(sseUrl, {
          headers: {
            Authorization: `Bearer ${this.options.token}`,
          },
        });

        this.eventSource.onopen = () => {
          this.options.debug('SSE connected');
          this.setState('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.eventSource.onmessage = (event: any) => {
          this.handleMessage(event.data);
        };

        this.eventSource.onerror = () => {
          this.options.debug('SSE error');

          if (this.state === 'connecting') {
            this.setState('disconnected');
            reject(new Error('SSE connection failed'));
            return;
          }

          this.handleDisconnect();
        };
      } catch (error) {
        this.setState('disconnected');
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

    this.setState('disconnected');
    this.filter = null;
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
    // - GET /api/v1/events (all events)
    // - GET /api/v1/events/jobs/{id} (single job polling stream)
    // - GET /api/v1/events/queues/{name} (queue stats polling stream)
    //
    // Note: SSE in the backend is unidirectional and subscriptions are effectively set by endpoint.
    if (filter?.jobId) {
      return `${this.options.baseUrl}/api/v1/events/jobs/${encodeURIComponent(filter.jobId)}`;
    }
    if (filter?.queueName) {
      return `${this.options.baseUrl}/api/v1/events/queues/${encodeURIComponent(filter.queueName)}`;
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
      const event = JSON.parse(data) as RealtimeEvent;
      this.options.debug(`Received SSE event: ${event.type}`, event);

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
      this.options.debug('Failed to parse SSE message', { data, error });
    }
  }

  private handleDisconnect(): void {
    this.eventSource = null;

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

    this.options.debug(`Scheduling SSE reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.filter || undefined);
      } catch (error) {
        this.options.debug('SSE reconnect failed', error);
      }
    }, delay);
  }
}
