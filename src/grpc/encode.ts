/**
 * gRPC request encoding shared by the unary client and the ProcessJobs stream.
 */

import type { GrpcFailRequest } from "./types.js";

/**
 * proto3 `retry` is false when unset, and the server reads false as "do not
 * retry": a fail without it dead-letters the job on its first failure however
 * many `maxRetries` it has left. Default it to true (callers opt out with an
 * explicit `retry: false`).
 */
export function encodeFailRequest(params: GrpcFailRequest): GrpcFailRequest {
  return { ...params, retry: params.retry ?? true };
}
