/**
 * Spooled Cloud SDK for Node.js
 *
 * @example
 * ```typescript
 * import { SpooledClient } from '@spooled/sdk';
 *
 * const client = new SpooledClient({
 *   apiKey: 'sk_live_...'
 * });
 *
 * // Create a job
 * const { id } = await client.jobs.create({
 *   queueName: 'my-queue',
 *   payload: { message: 'Hello!' }
 * });
 *
 * // Process jobs with a worker
 * const worker = new SpooledWorker(client, {
 *   queueName: 'my-queue',
 *   concurrency: 10,
 * });
 *
 * worker.process(async (ctx) => {
 *   console.log('Processing:', ctx.payload);
 *   return { processed: true };
 * });
 *
 * await worker.start();
 * ```
 *
 * @module @spooled/sdk
 */

// Main client
export { SpooledClient, createClient } from './client.js';

// Configuration
export type {
  SpooledClientConfig,
  ResolvedConfig,
  RetryConfig,
  CircuitBreakerConfig,
  DebugFn,
} from './config.js';
export { resolveConfig, validateConfig, DEFAULT_CONFIG, SDK_VERSION, API_VERSION } from './config.js';

// Errors
export {
  SpooledError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  PayloadTooLargeError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  CircuitBreakerOpenError,
  isSpooledError,
  isRetryableError,
  parseRateLimitHeaders,
  createErrorFromResponse,
} from './errors.js';
export type { ApiErrorBody, RateLimitInfo } from './errors.js';

// Types
export * from './types/index.js';

// gRPC (HTTP/2 + Protobuf)
export * from './grpc/index.js';

// Resources
export {
  AuthResource,
  JobsResource,
  QueuesResource,
  WorkersResource,
  SchedulesResource,
  WorkflowsResource,
  WebhooksResource,
  ApiKeysResource,
  OrganizationsResource,
  BillingResource,
  DashboardResource,
  HealthResource,
  MetricsResource,
  AdminResource,
  WebhookIngestionResource,
} from './resources/index.js';

// Realtime
export { SpooledRealtime, WebSocketRealtimeClient, SseRealtimeClient } from './realtime/index.js';
export type {
  SpooledRealtimeOptions,
  RealtimeConnectionOptions,
  RealtimeEvent,
  RealtimeEventType,
  RealtimeEventData,
  SubscriptionFilter,
  ConnectionState,
  JobCreatedEvent,
  JobStartedEvent,
  JobCompletedEvent,
  JobFailedEvent,
  JobProgressEvent,
  JobStatusChangedEvent,
  QueuePausedEvent,
  QueueResumedEvent,
  WorkerRegisteredEvent,
  WorkerDeregisteredEvent,
  ScheduleTriggeredEvent,
  HeartbeatEvent,
} from './realtime/index.js';

// Worker
export { SpooledWorker } from './worker/index.js';
export type {
  SpooledWorkerOptions,
  WorkerState,
  JobHandler,
  JobContext,
  JobResult,
  WorkerEvent,
  WorkerEventData,
} from './worker/index.js';

// Utilities (for advanced users)
export { CircuitBreaker, CircuitState, createCircuitBreaker } from './utils/circuit-breaker.js';
export { HttpClient, createHttpClient } from './utils/http.js';
export {
  withRetry,
  calculateDelay,
  shouldRetry,
  sleep,
  createRetryWrapper,
} from './utils/retry.js';
export {
  camelToSnake,
  snakeToCamel,
  toSnakeCase,
  toCamelCase,
  convertRequest,
  convertResponse,
  convertQueryParams,
} from './utils/casing.js';
