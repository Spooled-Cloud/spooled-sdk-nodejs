/**
 * gRPC request encoding shared by the unary client and the ProcessJobs stream.
 */

import type { GrpcFailRequest } from "./types.js";

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
