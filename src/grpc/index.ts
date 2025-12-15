/**
 * gRPC Module
 *
 * Real gRPC client for high-performance Spooled operations.
 */

// Main client
export { SpooledGrpcClient, GrpcQueueOperations, GrpcWorkerOperations } from './client.js';

// Types
export * from './types.js';

// Streaming utilities
export {
  asyncIterableFromStream,
  createJobStream,
  createProcessJobsStream,
  type StreamOptions,
  type JobStream,
  type ProcessJobsStream,
} from './streaming.js';

// Proto loader (for advanced users)
export {
  loadProtoDefinition,
  loadProtoDefinitionAsync,
  clearProtoCache,
  PROTO_LOADER_OPTIONS,
  type SpooledProtoDefinition,
} from './loader.js';
