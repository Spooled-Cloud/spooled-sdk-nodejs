/**
 * Realtime Types
 *
 * Types for WebSocket and SSE realtime connections.
 */

import type { JsonObject, JobStatus } from '../types/common.js';

/** Subscription filter */
export interface SubscriptionFilter {
  /** Queue name to subscribe to */
  queueName?: string;
  /** Job ID to subscribe to */
  jobId?: string;
  /** Worker ID to subscribe to */
  workerId?: string;
  /** Schedule ID to subscribe to */
  scheduleId?: string;
}

/** Base realtime event */
export interface RealtimeEventBase {
  /** Event type */
  type: string;
  /** Timestamp of the event */
  timestamp: string;
}

/** Job created event */
export interface JobCreatedEvent extends RealtimeEventBase {
  type: 'job.created';
  data: {
    jobId: string;
    queueName: string;
    priority: number;
  };
}

/** Job started event */
export interface JobStartedEvent extends RealtimeEventBase {
  type: 'job.started';
  data: {
    jobId: string;
    queueName: string;
    workerId: string;
  };
}

/** Job completed event */
export interface JobCompletedEvent extends RealtimeEventBase {
  type: 'job.completed';
  data: {
    jobId: string;
    queueName: string;
    result?: JsonObject;
    durationMs: number;
  };
}

/** Job failed event */
export interface JobFailedEvent extends RealtimeEventBase {
  type: 'job.failed';
  data: {
    jobId: string;
    queueName: string;
    error: string;
    retryCount: number;
    willRetry: boolean;
  };
}

/** Job progress event */
export interface JobProgressEvent extends RealtimeEventBase {
  type: 'job.progress';
  data: {
    jobId: string;
    queueName: string;
    progress: number;
    message?: string;
  };
}

/** Job status changed event */
export interface JobStatusChangedEvent extends RealtimeEventBase {
  type: 'job.status_changed';
  data: {
    jobId: string;
    queueName: string;
    oldStatus: JobStatus;
    newStatus: JobStatus;
  };
}

/** Queue paused event */
export interface QueuePausedEvent extends RealtimeEventBase {
  type: 'queue.paused';
  data: {
    queueName: string;
    reason?: string;
  };
}

/** Queue resumed event */
export interface QueueResumedEvent extends RealtimeEventBase {
  type: 'queue.resumed';
  data: {
    queueName: string;
  };
}

/** Worker registered event */
export interface WorkerRegisteredEvent extends RealtimeEventBase {
  type: 'worker.registered';
  data: {
    workerId: string;
    queueName: string;
    hostname: string;
  };
}

/** Worker deregistered event */
export interface WorkerDeregisteredEvent extends RealtimeEventBase {
  type: 'worker.deregistered';
  data: {
    workerId: string;
    queueName: string;
  };
}

/** Schedule triggered event */
export interface ScheduleTriggeredEvent extends RealtimeEventBase {
  type: 'schedule.triggered';
  data: {
    scheduleId: string;
    jobId: string;
  };
}

/** Heartbeat event (for connection keep-alive) */
export interface HeartbeatEvent extends RealtimeEventBase {
  type: 'heartbeat';
  data: {
    serverTime: string;
  };
}

/** All realtime event types */
export type RealtimeEvent =
  | JobCreatedEvent
  | JobStartedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobProgressEvent
  | JobStatusChangedEvent
  | QueuePausedEvent
  | QueueResumedEvent
  | WorkerRegisteredEvent
  | WorkerDeregisteredEvent
  | ScheduleTriggeredEvent
  | HeartbeatEvent;

/** Event type names */
export type RealtimeEventType = RealtimeEvent['type'];

/** Extract event data type from event type name */
export type RealtimeEventData<T extends RealtimeEventType> = Extract<
  RealtimeEvent,
  { type: T }
>['data'];

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Realtime connection options */
export interface RealtimeConnectionOptions {
  /** Base URL for the API */
  baseUrl: string;
  /** JWT token for authentication */
  token: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Debug logger */
  debug?: (message: string, meta?: unknown) => void;
}

/** WebSocket command to server */
export interface WebSocketCommand {
  type: 'subscribe' | 'unsubscribe';
  filter: SubscriptionFilter;
  requestId?: string;
}

/** WebSocket command response */
export interface WebSocketCommandResponse {
  type: 'subscribed' | 'unsubscribed' | 'error';
  requestId?: string;
  filter?: SubscriptionFilter;
  error?: string;
}
