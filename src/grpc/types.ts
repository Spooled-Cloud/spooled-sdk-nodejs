/**
 * gRPC Types
 *
 * Types that mirror the protobuf definitions in spooled.proto.
 * Uses proper enum names matching the proto (JOB_STATUS_PENDING, etc.)
 */

import type * as grpc from '@grpc/grpc-js';

// ============================================================================
// Job Status Enum
// ============================================================================

/** Job status enum values (proto-style naming) */
export enum GrpcJobStatus {
  JOB_STATUS_UNSPECIFIED = 'JOB_STATUS_UNSPECIFIED',
  JOB_STATUS_PENDING = 'JOB_STATUS_PENDING',
  JOB_STATUS_SCHEDULED = 'JOB_STATUS_SCHEDULED',
  JOB_STATUS_PROCESSING = 'JOB_STATUS_PROCESSING',
  JOB_STATUS_COMPLETED = 'JOB_STATUS_COMPLETED',
  JOB_STATUS_FAILED = 'JOB_STATUS_FAILED',
  JOB_STATUS_DEADLETTER = 'JOB_STATUS_DEADLETTER',
  JOB_STATUS_CANCELLED = 'JOB_STATUS_CANCELLED',
}

/** Numeric job status values (for backward compatibility) */
export const GrpcJobStatusNumber = {
  UNSPECIFIED: 0,
  PENDING: 1,
  SCHEDULED: 2,
  PROCESSING: 3,
  COMPLETED: 4,
  FAILED: 5,
  DEADLETTER: 6,
  CANCELLED: 7,
} as const;

// ============================================================================
// Timestamp handling
// ============================================================================

/** Timestamp as returned by gRPC (can be object or ISO string) */
export interface GrpcTimestamp {
  seconds?: string | number;
  nanos?: number;
}

/** Convert timestamp to Date */
export function timestampToDate(ts: GrpcTimestamp | string | undefined | null): Date | null {
  if (!ts) return null;

  if (typeof ts === 'string') {
    return new Date(ts);
  }

  const seconds = typeof ts.seconds === 'string' ? parseInt(ts.seconds, 10) : (ts.seconds ?? 0);
  const nanos = ts.nanos ?? 0;
  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
}

/** Convert Date to timestamp object */
export function dateToTimestamp(date: Date | string): GrpcTimestamp {
  const d = typeof date === 'string' ? new Date(date) : date;
  const ms = d.getTime();
  return {
    seconds: Math.floor(ms / 1000).toString(),
    nanos: (ms % 1000) * 1_000_000,
  };
}

// ============================================================================
// Job Message
// ============================================================================

/** Job message as returned by gRPC */
export interface GrpcJob {
  id: string;
  organizationId: string;
  queueName: string;
  status: GrpcJobStatus | string;
  /** Payload as google.protobuf.Struct (object) */
  payload?: Record<string, unknown> | null;
  /** Result as google.protobuf.Struct (object) */
  result?: Record<string, unknown> | null;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  priority: number;
  timeoutSeconds: number;
  createdAt?: GrpcTimestamp | string | null;
  scheduledAt?: GrpcTimestamp | string | null;
  startedAt?: GrpcTimestamp | string | null;
  completedAt?: GrpcTimestamp | string | null;
  leaseExpiresAt?: GrpcTimestamp | string | null;
  assignedWorkerId?: string | null;
  idempotencyKey?: string | null;
}

// ============================================================================
// Queue Service - Request/Response Types
// ============================================================================

/** Enqueue request */
export interface GrpcEnqueueRequest {
  queueName: string;
  /** Payload as object (will be converted to google.protobuf.Struct) */
  payload?: Record<string, unknown>;
  priority?: number;
  maxRetries?: number;
  timeoutSeconds?: number;
  scheduledAt?: GrpcTimestamp | string;
  idempotencyKey?: string;
  tags?: Record<string, string>;
}

/** Enqueue response */
export interface GrpcEnqueueResponse {
  jobId: string;
  created: boolean;
}

/** Dequeue request */
export interface GrpcDequeueRequest {
  queueName: string;
  workerId: string;
  leaseDurationSecs?: number;
  batchSize?: number;
}

/** Dequeue response */
export interface GrpcDequeueResponse {
  jobs: GrpcJob[];
}

/** Complete request */
export interface GrpcCompleteRequest {
  jobId: string;
  workerId: string;
  /** Result as object (will be converted to google.protobuf.Struct) */
  result?: Record<string, unknown>;
}

/** Complete response */
export interface GrpcCompleteResponse {
  success: boolean;
}

/** Fail request */
export interface GrpcFailRequest {
  jobId: string;
  workerId: string;
  error: string;
  retry?: boolean;
}

/** Fail response */
export interface GrpcFailResponse {
  success: boolean;
  willRetry?: boolean;
  nextRetryDelaySecs?: number;
}

/** Renew lease request */
export interface GrpcRenewLeaseRequest {
  jobId: string;
  workerId: string;
  extensionSecs: number;
}

/** Renew lease response */
export interface GrpcRenewLeaseResponse {
  success: boolean;
  newExpiresAt?: GrpcTimestamp | string | null;
}

/** Get job request */
export interface GrpcGetJobRequest {
  jobId: string;
}

/** Get job response */
export interface GrpcGetJobResponse {
  job?: GrpcJob | null;
}

/** Get queue stats request */
export interface GrpcGetQueueStatsRequest {
  queueName: string;
}

/** Get queue stats response */
export interface GrpcGetQueueStatsResponse {
  queueName: string;
  pending: number | string;
  scheduled: number | string;
  processing: number | string;
  completed: number | string;
  failed: number | string;
  deadletter: number | string;
  total: number | string;
  maxAgeMs?: number | string | null;
}

/** Stream jobs request (server streaming) */
export interface GrpcStreamJobsRequest {
  queueName: string;
  workerId: string;
  leaseDurationSecs?: number;
}

// ============================================================================
// Bidirectional Streaming Types
// ============================================================================

/** Process request (for bidirectional streaming) */
export interface GrpcProcessRequest {
  dequeue?: GrpcDequeueRequest;
  complete?: GrpcCompleteRequest;
  fail?: GrpcFailRequest;
  renewLease?: GrpcRenewLeaseRequest;
}

/** Error response */
export interface GrpcErrorResponse {
  code: string;
  message: string;
}

/** Process response (for bidirectional streaming) */
export interface GrpcProcessResponse {
  job?: GrpcJob;
  complete?: GrpcCompleteResponse;
  fail?: GrpcFailResponse;
  renewLease?: GrpcRenewLeaseResponse;
  error?: GrpcErrorResponse;
}

// ============================================================================
// Worker Service Types
// ============================================================================

/** Register worker request */
export interface GrpcRegisterWorkerRequest {
  queueName: string;
  hostname?: string;
  workerType?: string;
  maxConcurrency?: number;
  version?: string;
  metadata?: Record<string, string>;
}

/** Register worker response */
export interface GrpcRegisterWorkerResponse {
  workerId: string;
  leaseDurationSecs: number;
  heartbeatIntervalSecs: number;
}

/** Heartbeat request */
export interface GrpcHeartbeatRequest {
  workerId: string;
  currentJobs?: number;
  status?: string;
  metadata?: Record<string, string>;
}

/** Heartbeat response */
export interface GrpcHeartbeatResponse {
  acknowledged: boolean;
  shouldDrain?: boolean;
}

/** Deregister request */
export interface GrpcDeregisterRequest {
  workerId: string;
}

/** Deregister response */
export interface GrpcDeregisterResponse {
  success: boolean;
}

// ============================================================================
// gRPC Client Options
// ============================================================================

/** Options for creating a gRPC client */
export interface GrpcClientOptions {
  /** gRPC server address (host:port) */
  address: string;
  /** API key for authentication */
  apiKey: string;
  /** Use TLS (default: true for production, false for localhost) */
  useTls?: boolean;
  /** Custom channel credentials */
  credentials?: grpc.ChannelCredentials;
  /** Channel options */
  channelOptions?: grpc.ChannelOptions;
}

// ============================================================================
// Legacy types (backward compatibility)
// ============================================================================

/** @deprecated Use GrpcEnqueueRequest */
export type GrpcEnqueueJobParams = GrpcEnqueueRequest & {
  organizationId?: string;
};

/** @deprecated Use GrpcEnqueueResponse */
export type GrpcEnqueueJobResponse = GrpcEnqueueResponse;

/** @deprecated Use GrpcDequeueRequest */
export type GrpcDequeueJobParams = GrpcDequeueRequest & {
  organizationId?: string;
  leaseDurationSeconds?: number;
};

/** @deprecated Use GrpcDequeueResponse */
export interface GrpcDequeueJobResponse {
  job?: GrpcJob | null;
}

/** @deprecated Use GrpcCompleteRequest */
export type GrpcCompleteJobParams = GrpcCompleteRequest;

/** @deprecated Use GrpcCompleteResponse */
export type GrpcCompleteJobResponse = GrpcCompleteResponse;

/** @deprecated Use GrpcFailRequest */
export interface GrpcFailJobParams {
  jobId: string;
  workerId: string;
  errorMessage: string;
}

/** @deprecated Use GrpcFailResponse */
export type GrpcFailJobResponse = GrpcFailResponse;

/** @deprecated Use GrpcRenewLeaseRequest */
export interface GrpcRenewLeaseParams {
  jobId: string;
  workerId: string;
  leaseDurationSeconds: number;
}

/** @deprecated Use GrpcRenewLeaseResponse */
export interface GrpcRenewLeaseResponse_Legacy {
  renewed: boolean;
  newLeaseExpiresAt?: string | null;
}

/** @deprecated Use GrpcGetQueueStatsResponse */
export interface GrpcGetQueueStatsResponse_Legacy {
  queueName: string;
  pending: number;
  scheduled: number;
  processing: number;
  completed: number;
  failed: number;
  deadletter: number;
  total: number;
  maxAgeMs?: number | null;
}

/** @deprecated Use GrpcRegisterWorkerRequest */
export interface GrpcRegisterWorkerParams {
  workerId: string;
  organizationId?: string;
  queueNames: string[];
  maxConcurrentJobs?: number;
  hostname?: string;
  metadata?: Record<string, unknown> | string;
}

/** @deprecated Use GrpcRegisterWorkerResponse */
export interface GrpcRegisterWorkerResponse_Legacy {
  registered: boolean;
  heartbeatIntervalSeconds: number;
}

/** @deprecated Use GrpcHeartbeatRequest */
export interface GrpcHeartbeatParams {
  workerId: string;
  currentJobIds: string[];
  status: string;
}

/** @deprecated Use GrpcHeartbeatResponse */
export type GrpcHeartbeatResponse_Legacy = GrpcHeartbeatResponse;
