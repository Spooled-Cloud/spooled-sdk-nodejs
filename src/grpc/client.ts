/**
 * gRPC Client (backend gRPC HTTP gateway)
 *
 * The backend listens on port 50051 and exposes gRPC-style service paths over HTTP+JSON.
 * This is NOT standard gRPC over HTTP/2, so we implement it via the existing HttpClient.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  GrpcEnqueueJobParams,
  GrpcEnqueueJobResponse,
  GrpcDequeueJobParams,
  GrpcDequeueJobResponse,
  GrpcCompleteJobParams,
  GrpcCompleteJobResponse,
  GrpcFailJobParams,
  GrpcFailJobResponse,
  GrpcRenewLeaseParams,
  GrpcRenewLeaseResponse,
  GrpcGetJobResponse,
  GrpcGetQueueStatsResponse,
  GrpcRegisterWorkerParams,
  GrpcRegisterWorkerResponse,
  GrpcHeartbeatParams,
  GrpcHeartbeatResponse,
  GrpcDeregisterResponse,
} from './types.js';

function toIsoDate(value?: Date | string): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function jsonString(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null);
}

export class SpooledGrpcClient {
  constructor(private readonly http: HttpClient) {}

  readonly queue = {
    enqueue: async (params: GrpcEnqueueJobParams): Promise<GrpcEnqueueJobResponse> => {
      return this.http.post<GrpcEnqueueJobResponse>('/spooled.v1.QueueService/Enqueue', {
        organizationId: params.organizationId ?? '',
        queueName: params.queueName,
        payload: jsonString(params.payload),
        priority: params.priority ?? 0,
        maxRetries: params.maxRetries ?? 3,
        timeoutSeconds: params.timeoutSeconds ?? 300,
        scheduledAt: toIsoDate(params.scheduledAt),
        idempotencyKey: params.idempotencyKey,
        tags: params.tags === undefined ? undefined : (typeof params.tags === 'string' ? params.tags : JSON.stringify(params.tags)),
        completionWebhook: params.completionWebhook,
        parentJobId: params.parentJobId,
        expiresAt: toIsoDate(params.expiresAt),
      }, { skipApiPrefix: true });
    },

    dequeue: async (params: GrpcDequeueJobParams): Promise<GrpcDequeueJobResponse> => {
      return this.http.post<GrpcDequeueJobResponse>('/spooled.v1.QueueService/Dequeue', {
        organizationId: params.organizationId ?? '',
        queueName: params.queueName,
        workerId: params.workerId,
        leaseDurationSeconds: params.leaseDurationSeconds ?? 30,
      }, { skipApiPrefix: true });
    },

    complete: async (params: GrpcCompleteJobParams): Promise<GrpcCompleteJobResponse> => {
      return this.http.post<GrpcCompleteJobResponse>('/spooled.v1.QueueService/Complete', {
        jobId: params.jobId,
        workerId: params.workerId,
        result: params.result === undefined ? undefined : jsonString(params.result),
      }, { skipApiPrefix: true });
    },

    fail: async (params: GrpcFailJobParams): Promise<GrpcFailJobResponse> => {
      return this.http.post<GrpcFailJobResponse>('/spooled.v1.QueueService/Fail', {
        jobId: params.jobId,
        workerId: params.workerId,
        errorMessage: params.errorMessage,
      }, { skipApiPrefix: true });
    },

    renewLease: async (params: GrpcRenewLeaseParams): Promise<GrpcRenewLeaseResponse> => {
      return this.http.post<GrpcRenewLeaseResponse>('/spooled.v1.QueueService/RenewLease', {
        jobId: params.jobId,
        workerId: params.workerId,
        leaseDurationSeconds: params.leaseDurationSeconds,
      }, { skipApiPrefix: true });
    },

    getJob: async (jobId: string): Promise<GrpcGetJobResponse> => {
      return this.http.post<GrpcGetJobResponse>('/spooled.v1.QueueService/GetJob', {
        jobId,
      }, { skipApiPrefix: true });
    },

    getQueueStats: async (queueName: string): Promise<GrpcGetQueueStatsResponse> => {
      return this.http.post<GrpcGetQueueStatsResponse>('/spooled.v1.QueueService/GetQueueStats', {
        queueName,
      }, { skipApiPrefix: true });
    },
  };

  readonly workers = {
    register: async (params: GrpcRegisterWorkerParams): Promise<GrpcRegisterWorkerResponse> => {
      return this.http.post<GrpcRegisterWorkerResponse>('/spooled.v1.WorkerService/Register', {
        workerId: params.workerId,
        organizationId: params.organizationId ?? '',
        queueNames: params.queueNames,
        maxConcurrentJobs: params.maxConcurrentJobs ?? 5,
        hostname: params.hostname,
        metadata: params.metadata === undefined ? undefined : (typeof params.metadata === 'string' ? params.metadata : JSON.stringify(params.metadata)),
      }, { skipApiPrefix: true });
    },

    heartbeat: async (params: GrpcHeartbeatParams): Promise<GrpcHeartbeatResponse> => {
      return this.http.post<GrpcHeartbeatResponse>('/spooled.v1.WorkerService/Heartbeat', {
        workerId: params.workerId,
        currentJobIds: params.currentJobIds,
        status: params.status,
      }, { skipApiPrefix: true });
    },

    deregister: async (workerId: string): Promise<GrpcDeregisterResponse> => {
      return this.http.post<GrpcDeregisterResponse>('/spooled.v1.WorkerService/Deregister', {
        workerId,
      }, { skipApiPrefix: true });
    },
  };
}
