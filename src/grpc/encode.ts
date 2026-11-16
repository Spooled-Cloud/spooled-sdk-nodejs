/**
 * gRPC message encoding and decoding shared by the unary client and the
 * StreamJobs / ProcessJobs streams.
 */

import type {
  GrpcCompleteRequest,
  GrpcEnqueueRequest,
  GrpcFailRequest,
  GrpcGetQueueStatsResponse,
  GrpcJob,
  GrpcProcessRequest,
  GrpcProcessResponse,
} from "./types.js";

/**
 * Default `retry` to true (callers opt out with an explicit `retry: false`).
 *
 * The proto declares `optional bool retry = 4`, so an explicit `false` goes on
 * the wire with presence and dead-letters the job now, and `true` retries it
 * until its `maxRetries` run out. The default is sent explicitly rather than
 * left off: servers before API 0.1.118 declared a plain `bool`, read an absent
 * field as `false` and dead-lettered the job on its first failure.
 */
export function encodeFailRequest(params: GrpcFailRequest): GrpcFailRequest {
  return { ...params, retry: params.retry ?? true };
}

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

export function encodeEnqueueRequest(
  params: GrpcEnqueueRequest,
): GrpcEnqueueRequest {
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

export function encodeCompleteRequest(
  params: GrpcCompleteRequest,
): GrpcCompleteRequest {
  return {
    ...params,
    result: encodeStruct(params.result) as unknown as Record<string, unknown>,
  };
}

export function decodeJob(job: GrpcJob): GrpcJob {
  return {
    ...job,
    // proto-loader keeps an enum number it does not know (a status added to
    // the server's proto after this SDK) as a number; keep it a string so
    // `status` always matches its type.
    status: typeof job.status === "number" ? String(job.status) : job.status,
    payload: decodeStruct(job.payload),
    result: decodeStruct(job.result),
  };
}

/**
 * Encode a ProcessJobs request: a `fail` gets the `retry` default and a
 * `complete` its `result` as a `google.protobuf.Struct`, as on the unary calls.
 */
export function encodeProcessRequest(
  request: GrpcProcessRequest,
): GrpcProcessRequest {
  if (request.fail) {
    return { ...request, fail: encodeFailRequest(request.fail) };
  }
  if (request.complete) {
    return { ...request, complete: encodeCompleteRequest(request.complete) };
  }
  return request;
}

/**
 * An int64 the proto loader returns as a string (`longs: String`), as a number
 * when it fits exactly. A value above `Number.MAX_SAFE_INTEGER` stays a string
 * so no digit is lost.
 */
function decodeInt64<T extends number | string | null | undefined>(
  value: T,
): T | number {
  if (typeof value !== "string") {
    return value;
  }
  const parsed = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(parsed) ? parsed : value;
}

/** Decode GetQueueStats: the int64 counters as numbers (see `decodeInt64`). */
export function decodeQueueStats(
  stats: GrpcGetQueueStatsResponse,
): GrpcGetQueueStatsResponse {
  return {
    ...stats,
    pending: decodeInt64(stats.pending),
    scheduled: decodeInt64(stats.scheduled),
    processing: decodeInt64(stats.processing),
    completed: decodeInt64(stats.completed),
    failed: decodeInt64(stats.failed),
    deadletter: decodeInt64(stats.deadletter),
    total: decodeInt64(stats.total),
    maxAgeMs: decodeInt64(stats.maxAgeMs),
  };
}

/** Decode a ProcessJobs response: its `job` like a unary Dequeue job. */
export function decodeProcessResponse(
  response: GrpcProcessResponse,
): GrpcProcessResponse {
  return response.job
    ? { ...response, job: decodeJob(response.job) }
    : response;
}
