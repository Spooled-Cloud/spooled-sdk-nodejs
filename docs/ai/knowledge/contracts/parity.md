# Parity notes (Node)

- Full gRPC including StreamJobs/ProcessJobs.
- Worker `progress` emits local debug output only. The Go SDK exposes a `JobsResource.UpdateProgress` call targeting `POST /api/v1/jobs/{id}/progress`, but the backend does not implement that endpoint (it would 404); no SDK has backend-persisted job progress.
- No public webhook signature **validate** helpers (PHP has).
- Job `maxRetries`/`timeoutSeconds` optional on REST → server defaults when omitted.
- Worker detail types include optional `queueNames` / `updatedAt` (REST public names).
