/**
 * gRPC Types (backend gRPC HTTP gateway)
 *
 * The backend exposes gRPC-style service paths over HTTP+JSON on port 50051.
 * These types mirror the JSON request/response shapes in `spooled-backend/src/grpc/types.rs`.
 */

export enum GrpcJobStatus {
  Unspecified = 0,
  Pending = 1,
  Scheduled = 2,
  Processing = 3,
  Completed = 4,
  Failed = 5,
  Deadletter = 6,
  Cancelled = 7,
}

export interface GrpcJob {
  id: string;
  organizationId: string;
  queueName: string;
  status: GrpcJobStatus | number;
  /** JSON string */
  payload: string;
  /** JSON string */
  result?: string | null;
  retryCount: number;
  maxRetries: number;
  lastError?: string | null;
  createdAt?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  priority: number;
  /** JSON string */
  tags?: string | null;
  timeoutSeconds: number;
  parentJobId?: string | null;
  completionWebhook?: string | null;
  assignedWorkerId?: string | null;
  leaseId?: string | null;
  leaseExpiresAt?: string | null;
  idempotencyKey?: string | null;
}

export interface GrpcEnqueueJobParams {
  /** optional; backend uses authenticated org if provided */
  organizationId?: string;
  queueName: string;
  /** Will be JSON.stringified if object */
  payload: unknown;
  priority?: number;
  maxRetries?: number;
  timeoutSeconds?: number;
  scheduledAt?: Date | string;
  idempotencyKey?: string;
  /** tags JSON (record or string) */
  tags?: Record<string, string> | string;
  completionWebhook?: string;
  parentJobId?: string;
  expiresAt?: Date | string;
}

export interface GrpcEnqueueJobResponse {
  jobId: string;
  created: boolean;
}

export interface GrpcDequeueJobParams {
  /** optional; backend uses authenticated org if provided */
  organizationId?: string;
  queueName: string;
  workerId: string;
  leaseDurationSeconds?: number;
}

export interface GrpcDequeueJobResponse {
  job?: GrpcJob | null;
}

export interface GrpcCompleteJobParams {
  jobId: string;
  workerId: string;
  result?: unknown;
}

export interface GrpcCompleteJobResponse {
  success: boolean;
}

export interface GrpcFailJobParams {
  jobId: string;
  workerId: string;
  errorMessage: string;
}

export interface GrpcFailJobResponse {
  success: boolean;
  willRetry?: boolean;
  nextRetryDelaySecs?: number;
}

export interface GrpcRenewLeaseParams {
  jobId: string;
  workerId: string;
  leaseDurationSeconds: number;
}

export interface GrpcRenewLeaseResponse {
  renewed: boolean;
  newLeaseExpiresAt?: string | null;
}

export interface GrpcGetJobResponse {
  job?: GrpcJob | null;
}

export interface GrpcGetQueueStatsResponse {
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

export interface GrpcRegisterWorkerParams {
  workerId: string;
  organizationId?: string;
  queueNames: string[];
  maxConcurrentJobs?: number;
  hostname?: string;
  metadata?: Record<string, unknown> | string;
}

export interface GrpcRegisterWorkerResponse {
  registered: boolean;
  heartbeatIntervalSeconds: number;
}

export interface GrpcHeartbeatParams {
  workerId: string;
  currentJobIds: string[];
  status: string;
}

export interface GrpcHeartbeatResponse {
  acknowledged: boolean;
}

export interface GrpcDeregisterResponse {
  success: boolean;
}
