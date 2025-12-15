/**
 * Worker Types
 *
 * Types for the worker runtime.
 */

import type { ClaimedJob } from '../types/jobs.js';
import type { JsonObject } from '../types/common.js';

/** Worker configuration options */
export interface SpooledWorkerOptions {
  /** Queue name to process */
  queueName: string;
  /** Worker hostname (default: auto-detected) */
  hostname?: string;
  /** Worker type identifier */
  workerType?: string;
  /** Maximum concurrent jobs (1-100, default: 5) */
  concurrency?: number;
  /** Polling interval in ms (default: 1000) */
  pollInterval?: number;
  /** Lease duration in seconds (5-3600, default: 30) */
  leaseDuration?: number;
  /** Heartbeat interval as a fraction of lease duration (default: 0.5) */
  heartbeatFraction?: number;
  /** Whether to auto-start on construction (default: false) */
  autoStart?: boolean;
  /** Worker version string */
  version?: string;
  /** Additional worker metadata */
  metadata?: JsonObject;
  /** Graceful shutdown timeout in ms (default: 30000) */
  shutdownTimeout?: number;
}

/** Worker state */
export type WorkerState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

/** Job context passed to handlers */
export interface JobContext {
  /** Job ID */
  jobId: string;
  /** Queue name */
  queueName: string;
  /** Job payload */
  payload: JsonObject;
  /** Current retry count */
  retryCount: number;
  /** Maximum retries */
  maxRetries: number;
  /** Abort signal for graceful shutdown */
  signal: AbortSignal;
  /** Update job progress (0-100) */
  progress: (percent: number, message?: string) => Promise<void>;
  /** Log a message */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
}

/** Job handler function */
export type JobHandler = (context: JobContext) => Promise<JsonObject | void>;

/** Job processing result */
export interface JobResult {
  success: boolean;
  result?: JsonObject;
  error?: string;
}

/** Worker event types */
export type WorkerEvent =
  | 'started'
  | 'stopped'
  | 'error'
  | 'job:claimed'
  | 'job:started'
  | 'job:completed'
  | 'job:failed'
  | 'job:timeout';

/** Worker event data types */
export interface WorkerEventData {
  started: { workerId: string; queueName: string };
  stopped: { workerId: string; reason: string };
  error: { error: Error };
  'job:claimed': { jobId: string; queueName: string };
  'job:started': { jobId: string; queueName: string };
  'job:completed': { jobId: string; queueName: string; result?: JsonObject };
  'job:failed': { jobId: string; queueName: string; error: string; willRetry: boolean };
  'job:timeout': { jobId: string; queueName: string };
}

/** Active job tracking */
export interface ActiveJob {
  job: ClaimedJob;
  startedAt: Date;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  abortController: AbortController;
}
