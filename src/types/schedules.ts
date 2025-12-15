/**
 * Schedule Types
 *
 * Types for schedule/cron-related operations.
 */

import type { ScheduleRunStatus, JsonObject, ListParams } from './common.js';

/** Full schedule model */
export interface Schedule {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  cronExpression: string;
  timezone: string;
  queueName: string;
  payloadTemplate: JsonObject;
  priority: number;
  maxRetries: number;
  timeoutSeconds: number;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  tags?: JsonObject;
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

/** Parameters for creating a schedule */
export interface CreateScheduleParams {
  /** Schedule name (1-255 chars) */
  name: string;
  /** Optional description (max 1000 chars) */
  description?: string;
  /** Cron expression (6-field: "sec min hour day month weekday") */
  cronExpression: string;
  /** Timezone (default: 'UTC') */
  timezone?: string;
  /** Target queue name */
  queueName: string;
  /** Job payload template */
  payloadTemplate: JsonObject;
  /** Job priority (-100 to 100) */
  priority?: number;
  /** Max retries for scheduled jobs (0-100) */
  maxRetries?: number;
  /** Timeout in seconds (1-86400) */
  timeoutSeconds?: number;
  /** Tags for created jobs */
  tags?: JsonObject;
  /** Additional metadata */
  metadata?: JsonObject;
}

/** Response for creating a schedule */
export interface CreateScheduleResponse {
  id: string;
  name: string;
  cronExpression: string;
  nextRunAt?: string;
}

/** Parameters for updating a schedule */
export interface UpdateScheduleParams {
  name?: string;
  description?: string;
  cronExpression?: string;
  timezone?: string;
  payloadTemplate?: JsonObject;
  priority?: number;
  maxRetries?: number;
  timeoutSeconds?: number;
  isActive?: boolean;
  tags?: JsonObject;
  metadata?: JsonObject;
}

/** Parameters for listing schedules */
export interface ListSchedulesParams extends ListParams {
  /** Filter by organization ID */
  organizationId?: string;
}

/** Response for manual trigger */
export interface TriggerScheduleResponse {
  jobId: string;
  scheduledAt: string;
}

/** Schedule execution run */
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  jobId?: string;
  status: ScheduleRunStatus;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}
