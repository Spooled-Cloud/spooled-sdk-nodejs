/**
 * Realtime Module
 *
 * Provides WebSocket and SSE clients for real-time event streaming.
 */

export * from './types.js';
export { WebSocketRealtimeClient } from './websocket.js';
export { SseRealtimeClient } from './sse.js';

import { WebSocketRealtimeClient } from './websocket.js';
import { SseRealtimeClient } from './sse.js';
import type {
  RealtimeConnectionOptions,
  RealtimeEvent,
  RealtimeEventType,
  SubscriptionFilter,
  ConnectionState,
} from './types.js';

/** Options for creating a SpooledRealtime instance */
export interface SpooledRealtimeOptions {
  /**
   * Connection type: 'websocket' or 'sse' (default: 'websocket').
   *
   * Default is WebSocket because it’s typically the lowest server load:
   * - WebSocket uses push/pubsub in the backend
   * - SSE job/queue endpoints poll the database periodically
   */
  type?: 'websocket' | 'sse';
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
}

/** Full options including internal fields */
interface FullRealtimeOptions extends SpooledRealtimeOptions {
  baseUrl: string;
  token: string;
  debug?: (message: string, meta?: unknown) => void;
}

/** Event handler type - simplified for internal use */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventHandler = (data: any) => void;

/** Generic event handler */
type GenericEventHandler = (event: RealtimeEvent) => void;

/**
 * Unified Realtime Client
 *
 * Wraps WebSocket and SSE clients with a common interface.
 */
export class SpooledRealtime {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;

  constructor(options: FullRealtimeOptions) {
    const connectionOptions: RealtimeConnectionOptions = {
      baseUrl: options.baseUrl,
      token: options.token,
      autoReconnect: options.autoReconnect,
      maxReconnectAttempts: options.maxReconnectAttempts,
      reconnectDelay: options.reconnectDelay,
      maxReconnectDelay: options.maxReconnectDelay,
      debug: options.debug,
    };

    if (options.type === 'sse') {
      this.client = new SseRealtimeClient(connectionOptions);
    } else {
      this.client = new WebSocketRealtimeClient(connectionOptions);
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.client.getState();
  }

  /**
   * Connect to the realtime server
   */
  async connect(): Promise<void> {
    return this.client.connect();
  }

  /**
   * Disconnect from the realtime server
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Subscribe to events matching a filter
   *
   * @example
   * ```typescript
   * // Subscribe to all events from a queue
   * await realtime.subscribe({ queueName: 'my-queue' });
   *
   * // Subscribe to events for a specific job
   * await realtime.subscribe({ jobId: 'job-123' });
   * ```
   */
  async subscribe(filter: SubscriptionFilter): Promise<void> {
    // SSE subscriptions are effectively endpoint-based; change requires reconnect.
    if (typeof this.client.subscribe === 'function') {
      return this.client.subscribe(filter);
    }
    return this.client.reconnect(filter);
  }

  /**
   * Unsubscribe from events matching a filter
   */
  async unsubscribe(filter: SubscriptionFilter): Promise<void> {
    if (typeof this.client.unsubscribe === 'function') {
      return this.client.unsubscribe(filter);
    }
    // For SSE, unsubscribing means disconnecting if the filter matches current connection.
    this.client.disconnect();
  }

  /**
   * Add an event listener for a specific event type
   *
   * @example
   * ```typescript
   * realtime.on('job.completed', (data) => {
   *   console.log('Job completed:', data.jobId);
   * });
   *
   * realtime.on('job.failed', (data) => {
   *   console.error('Job failed:', data.error);
   * });
   * ```
   */
  on<T extends RealtimeEventType>(type: T, handler: EventHandler): () => void {
    return this.client.on(type, handler);
  }

  /**
   * Remove an event listener
   */
  off<T extends RealtimeEventType>(type: T, handler: EventHandler): void {
    this.client.off(type, handler);
  }

  /**
   * Add a listener for all events
   *
   * @example
   * ```typescript
   * realtime.onEvent((event) => {
   *   console.log(`Event: ${event.type}`, event.data);
   * });
   * ```
   */
  onEvent(handler: GenericEventHandler): () => void {
    return this.client.onEvent(handler);
  }

  /**
   * Add a listener for connection state changes
   *
   * @example
   * ```typescript
   * realtime.onStateChange((state) => {
   *   console.log('Connection state:', state);
   * });
   * ```
   */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    return this.client.onStateChange(handler);
  }
}
