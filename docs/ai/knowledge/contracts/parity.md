# Parity notes (Node)

- Full gRPC including StreamJobs/ProcessJobs.
- Worker `progress` emits local debug output only. The Go SDK exposes a `JobsResource.UpdateProgress` call targeting `POST /api/v1/jobs/{id}/progress`, but the backend does not implement that endpoint (it would 404); no SDK has backend-persisted job progress.
- No public webhook signature **validate** helpers (PHP has).
- Job `maxRetries`/`timeoutSeconds` optional on REST → server defaults when omitted.
- Worker detail types include optional `queueNames` / `updatedAt` (REST public names).
- Workflow job list/get/status are not their own REST routes. The backend only exposes `GET /workflows/{id}` (jobs + dependencies inline). `client.workflows.jobs.list` reads that document. `POST /jobs/{id}/dependencies` takes `depends_on` + `dependency_mode` and returns `dependencies_added` / `dependencies_met`.
- `GET /workflows/{id}` is `WorkflowDetailResponse`: job counts are under `progress` (`total`/`completed`/`failed`), not top-level `total_jobs` like list/cancel/retry. `workflows.get` maps those onto `totalJobs`/`completedJobs`/`failedJobs`/`progressPercent`.
- `GET /jobs/{id}/dependencies` is `{ jobId, dependencies, dependents, dependenciesMet }` with `{ jobId, queueName, status }` edges, not a parent `status` or per-edge `dependencyType`.
- Email login start is `POST /auth/email/start` → `{ message, email_sent_to }`, not `{ success, message }`. Email availability is `GET /auth/check-email?email=` → `{ available, exists, signup_enabled }`.
- `POST /auth/validate` is `{ valid, error?, claims? }`. Claims use `org_id` (camelCased `orgId`), not `organizationId`. Invalid tokens send `error`, not `message`. `auth.validate` maps those onto `claims.organizationId` and `message`.
- Org webhook token is `GET/POST /organizations/webhook-token` → `{ webhook_token, webhook_url }`, not `{ token }`.
- Clear is `POST /organizations/webhook-token/clear` with `{ confirm: true }`. An empty body 422s. The handler currently rejects the operation (use regenerate).
- Schedule trigger is `POST /schedules/{id}/trigger` → `{ job_id, triggered_at }`, not `{ job_id, scheduled_at }`.
- Job list/DLQ summaries send `attempt` and `max_retries`, not `retry_count`. Detail `GET /jobs/{id}` still uses `retry_count`.
- `GET /jobs` summaries include `job_type` from `payload.job_type`. `JobSummary.jobType` maps that field; `jobs.get` and `jobs.retry` copy it from `payload` when the top-level field is absent. List/DLQ summaries also send `last_error`.
