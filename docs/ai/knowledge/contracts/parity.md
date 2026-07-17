# Parity notes (Node)

- Full gRPC including StreamJobs/ProcessJobs.
- Worker `progress` emits local debug output only; Go remains the SDK with backend-persisted `POST /jobs/{id}/progress`.
- No public webhook signature **validate** helpers (PHP has).
- Job `maxRetries`/`timeoutSeconds` optional on REST → server defaults when omitted.
- Worker detail types include optional `queueNames` / `updatedAt` (REST public names).
