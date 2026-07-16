/**
 * gRPC Client
 *
 * Real gRPC client using @grpc/grpc-js for HTTP/2 + Protobuf communication.
 * Supports unary calls, server streaming, and bidirectional streaming.
 */

import * as grpc from "@grpc/grpc-js";
import { loadProtoDefinition } from "./loader.js";
import {
  createJobStream,
  createProcessJobsStream,
  type JobStream,
  type ProcessJobsStream,
  type StreamOptions,
} from "./streaming.js";
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
} from "./types.js";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "../errors.js";

// Type definitions for dynamic gRPC clients
type UnaryCallback<T> = (error: grpc.ServiceError | null, response: T) => void;
type UnaryMethod<TReq, TRes> = {
  (request: TReq, metadata: grpc.Metadata, callback: UnaryCallback<TRes>): void;
  (
    request: TReq,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: UnaryCallback<TRes>,
  ): void;
};

type ProtobufValue =
  | { nullValue: 0 }
  | { numberValue: number }
  | { stringValue: string }
  | { boolValue: boolean }
  | { structValue: ProtobufStruct }
  | { listValue: { values: ProtobufValue[] } };

interface ProtobufStruct {
  fields: Record<string, ProtobufValue>;
}

function encodeStruct(
  value: Record<string, unknown> | null | undefined,
): ProtobufStruct | undefined {
  if (value == null) {
    return undefined;
  }
  return {
    fields: Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]),
    ),
  };
}

function encodeValue(value: unknown): ProtobufValue {
  if (value == null) {
    return { nullValue: 0 };
  }
  if (Array.isArray(value)) {
    return { listValue: { values: value.map(encodeValue) } };
  }
  switch (typeof value) {
    case "number":
      return { numberValue: value };
    case "string":
      return { stringValue: value };
    case "boolean":
      return { boolValue: value };
    case "object":
      return { structValue: encodeStruct(value as Record<string, unknown>)! };
    default:
      return { stringValue: String(value) };
  }
}

function decodeStruct(
  value: unknown,
): Record<string, unknown> | null | undefined {
  if (!value || typeof value !== "object" || !("fields" in value)) {
    return value as Record<string, unknown> | null | undefined;
  }
  const fields = (value as ProtobufStruct).fields ?? {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, entry]) => [key, decodeValue(entry)]),
  );
}

function decodeValue(value: ProtobufValue): unknown {
  if ("nullValue" in value) {
    return null;
  }
  if ("numberValue" in value) {
    return value.numberValue;
  }
  if ("stringValue" in value) {
    return value.stringValue;
  }
  if ("boolValue" in value) {
    return value.boolValue;
  }
  if ("structValue" in value) {
    return decodeStruct(value.structValue);
  }
  if ("listValue" in value) {
    return (value.listValue.values ?? []).map(decodeValue);
  }
  return undefined;
}

function encodeEnqueueRequest(params: GrpcEnqueueRequest): GrpcEnqueueRequest {
  // Omit unset numeric fields so proto-loader `defaults: true` does not force
  // wire zeros for maxRetries/timeoutSeconds (server treats 0 as its default).
  const encoded: Record<string, unknown> = {
    queueName: params.queueName,
    payload: encodeStruct(params.payload),
  };
  if (params.priority !== undefined) {
    encoded.priority = params.priority;
  }
  if (params.maxRetries !== undefined) {
    encoded.maxRetries = params.maxRetries;
  }
  if (params.timeoutSeconds !== undefined) {
    encoded.timeoutSeconds = params.timeoutSeconds;
  }
  if (params.idempotencyKey !== undefined && params.idempotencyKey !== "") {
    encoded.idempotencyKey = params.idempotencyKey;
  }
  if (params.scheduledAt !== undefined) {
    encoded.scheduledAt = params.scheduledAt;
  }
  if (params.tags !== undefined) {
    encoded.tags = params.tags;
  }
  return encoded as unknown as GrpcEnqueueRequest;
}

function encodeCompleteRequest(
  params: GrpcCompleteRequest,
): GrpcCompleteRequest {
  return {
    ...params,
    result: encodeStruct(params.result) as unknown as Record<string, unknown>,
  };
}

function decodeJob(job: GrpcJob): GrpcJob {
  return {
    ...job,
    payload: decodeStruct(job.payload),
    result: decodeStruct(job.result),
  };
}

interface QueueServiceClient extends grpc.Client {
  Enqueue: UnaryMethod<GrpcEnqueueRequest, GrpcEnqueueResponse>;
  Dequeue: UnaryMethod<GrpcDequeueRequest, GrpcDequeueResponse>;
  Complete: UnaryMethod<GrpcCompleteRequest, GrpcCompleteResponse>;
  Fail: UnaryMethod<GrpcFailRequest, GrpcFailResponse>;
  RenewLease: UnaryMethod<GrpcRenewLeaseRequest, GrpcRenewLeaseResponse>;
  GetJob: UnaryMethod<GrpcGetJobRequest, GrpcGetJobResponse>;
  GetQueueStats: UnaryMethod<
    GrpcGetQueueStatsRequest,
    GrpcGetQueueStatsResponse
  >;
  StreamJobs(
    request: GrpcStreamJobsRequest,
    metadata: grpc.Metadata,
  ): grpc.ClientReadableStream<GrpcJob>;
  ProcessJobs(
    metadata: grpc.Metadata,
  ): grpc.ClientDuplexStream<GrpcProcessRequest, GrpcProcessResponse>;
}

interface WorkerServiceClient extends grpc.Client {
  Register: UnaryMethod<GrpcRegisterWorkerRequest, GrpcRegisterWorkerResponse>;
  Heartbeat: UnaryMethod<GrpcHeartbeatRequest, GrpcHeartbeatResponse>;
  Deregister: UnaryMethod<GrpcDeregisterRequest, GrpcDeregisterResponse>;
}

/**
 * Wrap a callback-based gRPC call in a Promise
 */
function promisify<TReq, TRes>(
  client: grpc.Client,
  method: UnaryMethod<TReq, TRes>,
  request: TReq,
  metadata: grpc.Metadata,
  timeoutMs?: number,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    const callback: UnaryCallback<TRes> = (error, response) => {
      if (error) {
        reject(mapGrpcError(error, timeoutMs));
      } else {
        resolve(response);
      }
    };

    method.call(
      client,
      request,
      metadata,
      createUnaryCallOptions(timeoutMs),
      callback,
    );
  });
}

function createUnaryCallOptions(timeoutMs?: number): grpc.CallOptions {
  if (timeoutMs === undefined) {
    return {};
  }
  return { deadline: new Date(Date.now() + timeoutMs) };
}

function mapGrpcError(error: grpc.ServiceError, timeoutMs?: number): Error {
  const message = error.details || error.message || "gRPC request failed";

  switch (error.code) {
    case grpc.status.DEADLINE_EXCEEDED:
      return new TimeoutError(message, timeoutMs ?? 0);
    case grpc.status.UNAUTHENTICATED:
      return new AuthenticationError(message, "AUTHENTICATION_FAILED");
    case grpc.status.PERMISSION_DENIED:
      return new AuthorizationError(message, "ACCESS_DENIED");
    case grpc.status.NOT_FOUND:
      return new NotFoundError(message, "NOT_FOUND");
    case grpc.status.INVALID_ARGUMENT:
    case grpc.status.OUT_OF_RANGE:
      return new ValidationError(message, "VALIDATION_ERROR");
    case grpc.status.ALREADY_EXISTS:
    case grpc.status.ABORTED:
    case grpc.status.FAILED_PRECONDITION:
      return new ConflictError(message, "CONFLICT");
    case grpc.status.RESOURCE_EXHAUSTED:
      return new RateLimitError(message, "RATE_LIMIT_EXCEEDED");
    case grpc.status.UNAVAILABLE:
    case grpc.status.CANCELLED:
      return new NetworkError(message, error);
    default:
      if (error.code >= grpc.status.INTERNAL) {
        return new ServerError(message, 500, "GRPC_SERVER_ERROR");
      }
      return new ServerError(message, 500, "GRPC_ERROR");
  }
}

/**
 * Determine if TLS should be used based on address
 */
function shouldUseTls(address: string, explicitTls?: boolean): boolean {
  if (explicitTls !== undefined) {
    return explicitTls;
  }
  // Default to insecure for localhost/127.0.0.1
  const host = address.split(":")[0].toLowerCase();
  return (
    host !== "localhost" && host !== "127.0.0.1" && !host.startsWith("[::1]")
  );
}

/**
 * Queue operations for the gRPC client
 */
export class GrpcQueueOperations {
  constructor(
    private readonly client: QueueServiceClient,
    private readonly metadata: grpc.Metadata,
    private readonly timeoutMs?: number,
  ) {}

  /**
   * Enqueue a new job
   */
  async enqueue(params: GrpcEnqueueRequest): Promise<GrpcEnqueueResponse> {
    return promisify(
      this.client,
      this.client.Enqueue,
      encodeEnqueueRequest(params),
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Dequeue a job (for workers)
   */
  async dequeue(params: GrpcDequeueRequest): Promise<GrpcDequeueResponse> {
    const response = await promisify(
      this.client,
      this.client.Dequeue,
      params,
      this.metadata,
      this.timeoutMs,
    );
    return { ...response, jobs: response.jobs.map(decodeJob) };
  }

  /**
   * Complete a job successfully
   */
  async complete(params: GrpcCompleteRequest): Promise<GrpcCompleteResponse> {
    return promisify(
      this.client,
      this.client.Complete,
      encodeCompleteRequest(params),
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Fail a job
   */
  async fail(params: GrpcFailRequest): Promise<GrpcFailResponse> {
    return promisify(
      this.client,
      this.client.Fail,
      params,
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Renew a job's lease
   */
  async renewLease(
    params: GrpcRenewLeaseRequest,
  ): Promise<GrpcRenewLeaseResponse> {
    return promisify(
      this.client,
      this.client.RenewLease,
      params,
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<GrpcGetJobResponse> {
    const response = await promisify(
      this.client,
      this.client.GetJob,
      { jobId },
      this.metadata,
      this.timeoutMs,
    );
    return {
      ...response,
      job: response.job ? decodeJob(response.job) : response.job,
    };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<GrpcGetQueueStatsResponse> {
    return promisify(
      this.client,
      this.client.GetQueueStats,
      { queueName },
      this.metadata,
      this.timeoutMs,
    );
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
  streamJobs(
    params: GrpcStreamJobsRequest,
    options?: StreamOptions,
  ): JobStream {
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
    private readonly metadata: grpc.Metadata,
    private readonly timeoutMs?: number,
  ) {}

  /**
   * Register a new worker
   */
  async register(
    params: GrpcRegisterWorkerRequest,
  ): Promise<GrpcRegisterWorkerResponse> {
    return promisify(
      this.client,
      this.client.Register,
      params,
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Send heartbeat
   */
  async heartbeat(
    params: GrpcHeartbeatRequest,
  ): Promise<GrpcHeartbeatResponse> {
    return promisify(
      this.client,
      this.client.Heartbeat,
      params,
      this.metadata,
      this.timeoutMs,
    );
  }

  /**
   * Deregister a worker
   */
  async deregister(workerId: string): Promise<GrpcDeregisterResponse> {
    return promisify(
      this.client,
      this.client.Deregister,
      { workerId },
      this.metadata,
      this.timeoutMs,
    );
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
 *   address: 'grpc.spooled.cloud:443',
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
    const { address, apiKey, useTls, credentials, channelOptions, timeout } =
      options;

    // Create credentials
    const creds =
      credentials ??
      (shouldUseTls(address, useTls)
        ? grpc.credentials.createSsl()
        : grpc.credentials.createInsecure());

    // Create metadata with API key
    this.metadata = new grpc.Metadata();
    this.metadata.add("x-api-key", apiKey);

    // Load proto definition
    const proto = loadProtoDefinition();

    // Create service clients
    this.queueClient = new proto.spooled.v1.QueueService(
      address,
      creds,
      channelOptions,
    ) as unknown as QueueServiceClient;

    this.workerClient = new proto.spooled.v1.WorkerService(
      address,
      creds,
      channelOptions,
    ) as unknown as WorkerServiceClient;

    // Initialize operation namespaces
    this.queue = new GrpcQueueOperations(
      this.queueClient,
      this.metadata,
      timeout,
    );
    this.workers = new GrpcWorkerOperations(
      this.workerClient,
      this.metadata,
      timeout,
    );
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
    return this.queueClient
      .getChannel()
      .getConnectivityState(tryToConnect ?? false);
  }
}
