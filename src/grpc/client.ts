/**
 * gRPC Client
 *
 * Real gRPC client using @grpc/grpc-js for HTTP/2 + Protobuf communication.
 * Supports unary calls, server streaming, and bidirectional streaming.
 */

import * as grpc from '@grpc/grpc-js';
import { loadProtoDefinition } from './loader.js';
import {
  createJobStream,
  createProcessJobsStream,
  type JobStream,
  type ProcessJobsStream,
  type StreamOptions,
} from './streaming.js';
import type {
  GrpcClientOptions,
  GrpcEnqueueRequest,
  GrpcEnqueueResponse,
  GrpcDequeueRequest,
  GrpcDequeueResponse,
  GrpcCompleteRequest,
  GrpcCompleteResponse,
  GrpcFailRequest,
  GrpcFailResponse,
  GrpcRenewLeaseRequest,
  GrpcRenewLeaseResponse,
  GrpcGetJobRequest,
  GrpcGetJobResponse,
  GrpcGetQueueStatsRequest,
  GrpcGetQueueStatsResponse,
  GrpcStreamJobsRequest,
  GrpcRegisterWorkerRequest,
  GrpcRegisterWorkerResponse,
  GrpcHeartbeatRequest,
  GrpcHeartbeatResponse,
  GrpcDeregisterRequest,
  GrpcDeregisterResponse,
  GrpcProcessRequest,
  GrpcProcessResponse,
  GrpcJob,
} from './types.js';

// Type definitions for dynamic gRPC clients
type UnaryCallback<T> = (error: grpc.ServiceError | null, response: T) => void;

interface QueueServiceClient extends grpc.Client {
  Enqueue(request: GrpcEnqueueRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcEnqueueResponse>): void;
  Dequeue(request: GrpcDequeueRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcDequeueResponse>): void;
  Complete(request: GrpcCompleteRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcCompleteResponse>): void;
  Fail(request: GrpcFailRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcFailResponse>): void;
  RenewLease(request: GrpcRenewLeaseRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcRenewLeaseResponse>): void;
  GetJob(request: GrpcGetJobRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcGetJobResponse>): void;
  GetQueueStats(request: GrpcGetQueueStatsRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcGetQueueStatsResponse>): void;
  StreamJobs(request: GrpcStreamJobsRequest, metadata: grpc.Metadata): grpc.ClientReadableStream<GrpcJob>;
  ProcessJobs(metadata: grpc.Metadata): grpc.ClientDuplexStream<GrpcProcessRequest, GrpcProcessResponse>;
}

interface WorkerServiceClient extends grpc.Client {
  Register(request: GrpcRegisterWorkerRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcRegisterWorkerResponse>): void;
  Heartbeat(request: GrpcHeartbeatRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcHeartbeatResponse>): void;
  Deregister(request: GrpcDeregisterRequest, metadata: grpc.Metadata, callback: UnaryCallback<GrpcDeregisterResponse>): void;
}

/**
 * Wrap a callback-based gRPC call in a Promise
 */
function promisify<TReq, TRes>(
  client: grpc.Client,
  method: (request: TReq, metadata: grpc.Metadata, callback: UnaryCallback<TRes>) => void,
  request: TReq,
  metadata: grpc.Metadata
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    method.call(client, request, metadata, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

/**
 * Determine if TLS should be used based on address
 */
function shouldUseTls(address: string, explicitTls?: boolean): boolean {
  if (explicitTls !== undefined) {
    return explicitTls;
  }
  // Default to insecure for localhost/127.0.0.1
  const host = address.split(':')[0].toLowerCase();
  return host !== 'localhost' && host !== '127.0.0.1' && !host.startsWith('[::1]');
}

/**
 * Queue operations for the gRPC client
 */
export class GrpcQueueOperations {
  constructor(
    private readonly client: QueueServiceClient,
    private readonly metadata: grpc.Metadata
  ) {}

  /**
   * Enqueue a new job
   */
  async enqueue(params: GrpcEnqueueRequest): Promise<GrpcEnqueueResponse> {
    return promisify(this.client, this.client.Enqueue, params, this.metadata);
  }

  /**
   * Dequeue a job (for workers)
   */
  async dequeue(params: GrpcDequeueRequest): Promise<GrpcDequeueResponse> {
    return promisify(this.client, this.client.Dequeue, params, this.metadata);
  }

  /**
   * Complete a job successfully
   */
  async complete(params: GrpcCompleteRequest): Promise<GrpcCompleteResponse> {
    return promisify(this.client, this.client.Complete, params, this.metadata);
  }

  /**
   * Fail a job
   */
  async fail(params: GrpcFailRequest): Promise<GrpcFailResponse> {
    return promisify(this.client, this.client.Fail, params, this.metadata);
  }

  /**
   * Renew a job's lease
   */
  async renewLease(params: GrpcRenewLeaseRequest): Promise<GrpcRenewLeaseResponse> {
    return promisify(this.client, this.client.RenewLease, params, this.metadata);
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<GrpcGetJobResponse> {
    return promisify(this.client, this.client.GetJob, { jobId }, this.metadata);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<GrpcGetQueueStatsResponse> {
    return promisify(this.client, this.client.GetQueueStats, { queueName }, this.metadata);
  }

  /**
   * Stream jobs from a queue (server-side streaming)
   *
   * @example
   * ```typescript
   * const stream = client.grpc.queue.streamJobs({
   *   queueName: 'my-queue',
   *   workerId: 'worker-1',
   * });
   *
   * for await (const job of stream) {
   *   console.log('Received job:', job.id);
   * }
   * ```
   */
  streamJobs(params: GrpcStreamJobsRequest, options?: StreamOptions): JobStream {
    const call = this.client.StreamJobs(params, this.metadata);
    return createJobStream(call, options);
  }

  /**
   * Open a bidirectional stream for processing jobs
   *
   * @example
   * ```typescript
   * const stream = client.grpc.queue.processJobs();
   *
   * // Request jobs
   * stream.send({ dequeue: { queueName: 'my-queue', workerId: 'worker-1' } });
   *
   * // Process responses
   * for await (const response of stream.receive()) {
   *   if (response.job) {
   *     // Process the job
   *     stream.send({ complete: { jobId: response.job.id, workerId: 'worker-1' } });
   *   }
   * }
   *
   * stream.end();
   * ```
   */
  processJobs(options?: StreamOptions): ProcessJobsStream {
    const call = this.client.ProcessJobs(this.metadata);
    return createProcessJobsStream(call, options);
  }
}

/**
 * Worker operations for the gRPC client
 */
export class GrpcWorkerOperations {
  constructor(
    private readonly client: WorkerServiceClient,
    private readonly metadata: grpc.Metadata
  ) {}

  /**
   * Register a new worker
   */
  async register(params: GrpcRegisterWorkerRequest): Promise<GrpcRegisterWorkerResponse> {
    return promisify(this.client, this.client.Register, params, this.metadata);
  }

  /**
   * Send heartbeat
   */
  async heartbeat(params: GrpcHeartbeatRequest): Promise<GrpcHeartbeatResponse> {
    return promisify(this.client, this.client.Heartbeat, params, this.metadata);
  }

  /**
   * Deregister a worker
   */
  async deregister(workerId: string): Promise<GrpcDeregisterResponse> {
    return promisify(this.client, this.client.Deregister, { workerId }, this.metadata);
  }
}

/**
 * Spooled gRPC Client
 *
 * Real gRPC client for high-performance job queue operations.
 *
 * @example
 * ```typescript
 * const client = new SpooledGrpcClient({
 *   address: 'grpc.spooled.cloud:50051',
 *   apiKey: 'sk_live_...',
 * });
 *
 * // Enqueue a job
 * const { jobId } = await client.queue.enqueue({
 *   queueName: 'my-queue',
 *   payload: { message: 'Hello!' },
 * });
 *
 * // Stream jobs
 * for await (const job of client.queue.streamJobs({
 *   queueName: 'my-queue',
 *   workerId: 'worker-1',
 * })) {
 *   console.log('Job:', job);
 * }
 * ```
 */
export class SpooledGrpcClient {
  private readonly queueClient: QueueServiceClient;
  private readonly workerClient: WorkerServiceClient;
  private readonly metadata: grpc.Metadata;

  /** Queue operations */
  readonly queue: GrpcQueueOperations;

  /** Worker operations */
  readonly workers: GrpcWorkerOperations;

  constructor(options: GrpcClientOptions) {
    const { address, apiKey, useTls, credentials, channelOptions } = options;

    // Create credentials
    const creds = credentials ?? (shouldUseTls(address, useTls)
      ? grpc.credentials.createSsl()
      : grpc.credentials.createInsecure());

    // Create metadata with API key
    this.metadata = new grpc.Metadata();
    this.metadata.add('x-api-key', apiKey);

    // Load proto definition
    const proto = loadProtoDefinition();

    // Create service clients
    this.queueClient = new proto.spooled.v1.QueueService(
      address,
      creds,
      channelOptions
    ) as unknown as QueueServiceClient;

    this.workerClient = new proto.spooled.v1.WorkerService(
      address,
      creds,
      channelOptions
    ) as unknown as WorkerServiceClient;

    // Initialize operation namespaces
    this.queue = new GrpcQueueOperations(this.queueClient, this.metadata);
    this.workers = new GrpcWorkerOperations(this.workerClient, this.metadata);
  }

  /**
   * Close all gRPC connections
   */
  close(): void {
    this.queueClient.close();
    this.workerClient.close();
  }

  /**
   * Wait for the clients to be ready
   */
  async waitForReady(deadline?: Date): Promise<void> {
    const d = deadline ?? new Date(Date.now() + 10000);
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        this.queueClient.waitForReady(d, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
      new Promise<void>((resolve, reject) => {
        this.workerClient.waitForReady(d, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    ]);
  }

  /**
   * Get the current connection state
   */
  getState(tryToConnect?: boolean): grpc.connectivityState {
    return this.queueClient.getChannel().getConnectivityState(tryToConnect ?? false);
  }
}
