/**
 * Worker Types
 *
 * Types for worker-related operations.
 */

import type { WorkerStatus, JsonObject } from "./common.js";

/** Full worker model */
export interface Worker {
  id: string;
  organizationId: string;
  queueName: string;
  /** Multi-queue membership when present (detail response). */
  queueNames?: string[];
  hostname: string;
  /** Serialized as explicit null by the backend when not set. */
  workerType?: string | null;
  maxConcurrency: number;
  currentJobs: number;
  status: WorkerStatus;
  lastHeartbeat: string;
  metadata: JsonObject;
  /** Serialized as explicit null by the backend when not set. */
  version?: string | null;
  registeredAt: string;
  /** Last row update (detail response). */
  updatedAt?: string;
}

/** Worker summary for list responses */
export interface WorkerSummary {
  id: string;
  queueName: string;
  hostname: string;
  status: WorkerStatus;
  currentJobs: number;
  maxConcurrency: number;
  lastHeartbeat: string;
}

/** Parameters for registering a worker */
export interface RegisterWorkerParams {
  /** Queue name to process */
  queueName: string;
  /**
   * Stable worker identifier (1-128 chars, `[A-Za-z0-9._-]`).
   *
   * Supplying one makes registration an upsert, so a restarting worker reuses
   * a single row and re-registering an id you already own is not charged
   * against the plan worker cap. Omit it and the server mints a UUID, which
   * means every restart leaves the old row occupying the cap until the
   * stale-worker reaper clears it (~2 minutes) — enough for a crash-looping
   * worker on a tight plan to 429 itself out of registering. An id owned by a
   * different organization is rejected with HTTP 409.
   */
  workerId?: string;
  /** Worker hostname */
  hostname: string;
  /** Worker type identifier */
  workerType?: string;
  /** Maximum concurrent jobs (1-100, default 5) */
  maxConcurrency?: number;
  /** Additional metadata */
  metadata?: JsonObject;
  /** Worker version */
  version?: string;
}

/** Response for worker registration */
export interface RegisterWorkerResponse {
  id: string;
  queueName: string;
  leaseDurationSecs: number;
  heartbeatIntervalSecs: number;
}

/** Parameters for worker heartbeat */
export interface WorkerHeartbeatParams {
  /** Current number of jobs being processed */
  currentJobs: number;
  /** Worker status */
  status?: WorkerStatus;
  /** Updated metadata */
  metadata?: JsonObject;
}
