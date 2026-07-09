/**
 * Backend → SDK realtime event-name mapping.
 *
 * The backend's `RealtimeEvent` enum is serialized with
 * `#[serde(tag = "type", content = "data")]`, so events arrive on the wire as
 * `{ "type": "<PascalCaseVariant>", "data": { ...snake_case fields } }`, e.g.
 * `{ "type": "JobCompleted", "data": { "job_id": "…", "duration_ms": 12 } }`.
 *
 * The SDK's public event API, however, uses dotted names (`job.completed`,
 * `queue.stats`, …). Without translation, `rt.on('job.completed', …)` never
 * fires because the transport dispatches under the raw wire name
 * (`JobCompleted`). This map bridges the two: every variant of the backend enum
 * maps to its dotted SDK name.
 */
export const BACKEND_EVENT_TYPE_MAP: Record<string, string> = {
  JobStatusChange: 'job.status_changed',
  JobCreated: 'job.created',
  JobCompleted: 'job.completed',
  JobFailed: 'job.failed',
  QueueStats: 'queue.stats',
  WorkerHeartbeat: 'worker.heartbeat',
  WorkerRegistered: 'worker.registered',
  WorkerDeregistered: 'worker.deregistered',
  SystemHealth: 'system.health',
  Ping: 'ping',
  Error: 'error',
};

/**
 * Translate a wire event `type` to the SDK's dotted event name.
 *
 * Names that are already dotted (or otherwise unknown) pass through unchanged,
 * so this is safe to call on every inbound message and keeps working if the
 * backend ever starts sending pre-dotted names.
 */
export function mapEventType(type: string): string {
  return BACKEND_EVENT_TYPE_MAP[type] ?? type;
}
