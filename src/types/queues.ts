/**
 * Queue Types
 *
 * Types for queue-related operations.
 */

import type { JsonObject } from './common.js';

/** Queue configuration */
export interface QueueConfig {
  id: string;
  organizationId: string;
  queueName: string;
  maxRetries: number;
  defaultTimeout: number;
  rateLimit?: number;
  enabled: boolean;
  settings: JsonObject;
  createdAt: string;
  updatedAt: string;
}

/** Queue configuration summary */
export interface QueueConfigSummary {
  queueName: string;
  maxRetries: number;
  defaultTimeout: number;
  rateLimit?: number;
  enabled: boolean;
}

/** Queue statistics */
export interface QueueStats {
  queueName: string;
  pendingJobs: number;
  processingJobs: number;
  completedJobs24h: number;
  failedJobs24h: number;
  avgProcessingTimeMs?: number;
  maxJobAgeSeconds?: number;
  activeWorkers: number;
}

/** Parameters for updating queue config */
export interface UpdateQueueConfigParams {
  /** Queue name */
  queueName: string;
  /** Maximum retries (0-100) */
  maxRetries?: number;
  /** Default timeout in seconds (1-86400) */
  defaultTimeout?: number;
  /** Rate limit (jobs per second, 1-100000) */
  rateLimit?: number;
  /** Whether the queue is enabled */
  enabled?: boolean;
  /** Additional settings */
  settings?: JsonObject;
}

/** Response for pause operation */
export interface PauseQueueResponse {
  queueName: string;
  paused: boolean;
  pausedAt: string;
  reason?: string;
}

/** Response for resume operation */
export interface ResumeQueueResponse {
  queueName: string;
  resumed: boolean;
  pausedDurationSecs: number;
}
