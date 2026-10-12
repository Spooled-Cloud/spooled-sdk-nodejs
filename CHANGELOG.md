# Changelog

All notable changes to the Spooled Node.js SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-12

Support for Spooled API 0.1.122 and fixes from the final production
verification of 2026-10-12 (findings SDKNP-32 to SDKNP-39). Everything is
additive for SDK users: new methods, fields and optional parameters; no method,
type or field was renamed or removed. Servers older than API 0.1.122 ignore the
new list filters and do not send the new fields, which are optional in the
types.

### Fixed

- **Rate-limit 429s no longer open the circuit breaker.** The breaker counted
  every retryable error, and a per-second 429 is retryable, so a burst above
  the plan limit opened it after five 429s: every call on the client, including
  the retries that `Retry-After` had already scheduled, then failed with
  `CircuitBreakerOpenError` for 30 s. No 429 counts toward the breaker now; the
  retry layer handles rate limiting. Network errors, timeouts, 408 and 5xx still
  count. The default predicate is exported as `isCircuitBreakerFailure`; an
  `isFailure` you pass yourself (to `new CircuitBreaker()`,
  `createCircuitBreaker()` or the client's `circuitBreaker` option) still
  replaces it and is still called as a method of those options, as in 1.3.0.
  (SDKNP-32)
- **gRPC proto matches the backend.** `proto/spooled.proto` is the backend's
  file again: `FailRequest.retry` is `optional bool`, so `fail({ retry: false })`
  is sent with field presence and dead-letters the job whatever its
  `maxRetries`, and `RegisterWorkerRequest.worker_id` (field 7) exists, so
  `workers.register({ workerId })` keeps a stable id instead of dropping it.
  `fail()` still sends `retry: true` when you leave it out. (SDKNP-33)
- **gRPC streams decode like the unary calls.** `streamJobs()` and
  `processJobs().receive()` returned the raw protobuf `Struct`
  (`{ fields: { ... } }`) as `payload` and `result`; they now return plain
  objects, as `dequeue()` and `getJob()` do. `processJobs().send({ complete })`
  encodes `result` as a `Struct`; it was sent as a plain object and lost.
  A stream that receives an item it cannot decode is cancelled before the
  iterator throws the decode error; the call used to stay open. The CANCELLED
  error that the cancel causes does not replace the decode error or reach
  `onError`. (SDKNP-39)
- A gRPC job status newer than the SDK's proto is returned as a string (`"42"`)
  instead of a number. (SDKNP-38)
- `jobs.list()` sends a `Date` filter as ISO 8601; `String(date)` is not
  RFC 3339 and the API answered 400. An empty status list sends no filter.
  (SDKNP-34)
- `require("@spooled/sdk/package.json")` works: `./package.json` is in the
  `exports` map. (SDKNP-35)

### Added

- **Job search** (API 0.1.122): `jobs.list()` and `jobs.dlq.list()` take `q`,
  `jobType`, `createdAfter` and `createdBefore`, and `jobs.list()` a status list
  (`status: ["failed", "deadletter"]`). `jobs.listPage()` and
  `jobs.dlq.listPage()` return `{ data, hasMore }` with `hasMore` from the
  `X-Has-More` header. New types `JobSearchParams` and `ListPage<T>`.
- **Job history:** `jobs.history(id, { order, limit, offset })` and
  `jobs.historyPage()` for `GET /jobs/{id}/history` (`JobHistoryEvent`,
  `JobHistoryParams`, `JobHistoryEventType`).
- **Worker counters:** `jobsProcessed` and `jobsFailed` on `Worker` and
  `WorkerSummary`.
- **Webhook events and formats:** `WebhookEventType` has `job.deadlettered`,
  `job.retried`, `workflow.completed` and `workflow.failed`; webhooks take and
  return `format` (`WebhookFormat`: `json`, `slack`, `discord`, `teams`).
- **Inbound webhook log:** `ingest.listDeliveries()` for
  `GET /webhooks/deliveries`, filtered by `status`, `since` and `queueName`
  (`InboundWebhookDelivery`, `ListInboundDeliveriesParams`).
- **Rate-limit info:** `client.getRateLimitInfo()` returns `X-RateLimit-Limit`,
  `-Remaining`, `-Reset` (Unix seconds, as a `Date`) and `-Scope` from the most
  recent response that carried them; `RateLimitInfo.scope` is new and is also
  filled on `RateLimitError.rateLimitInfo`.
- `GrpcRegisterWorkerRequest.workerId`.
- **Circuit breaker types:** `CircuitBreakerOptions` and `CircuitStateChange`
  are exported. `createCircuitBreaker()` and the client's `circuitBreaker`
  option accept `isFailure` and `onStateChange` in their types; both were
  honoured at run time, but a TypeScript object literal carrying them was
  rejected. `ResolvedConfig["circuitBreaker"]` is now `CircuitBreakerOptions`.
  These types are only widened, so 1.3.0 code that uses them compiles unchanged.

### Documentation

- README and docs: the API sends `X-RateLimit-*` headers (they said it did
  not); `leaseId` is required on `complete`, `fail` and `heartbeat` (a call
  without it is a 422, since 2026-07); the new events, `format`, job search,
  history, worker counters and inbound log; the gRPC `Struct` payload limits
  (only a JSON object travels, integers at or above 2^53 lose precision); `/metrics` is
  token-protected on Spooled Cloud. `docs/grpc.md` gained an SDK client section
  and its raw `@grpc/grpc-js` examples now encode `Struct` payloads, use
  `batchSize` and the real `ProcessJobs` messages. (SDKNP-36)
- `examples/grpc-streaming.ts` uses `SpooledGrpcClient`; the raw version sent
  JSON strings as `Struct` payloads and settled jobs without `workerId` and
  `leaseId`, so it failed against the API. `examples/workflow-dag.ts` compiles
  against `JsonValue` payloads again (`npm run typecheck:examples` passes).

### Tooling

- `npm run typecheck` also compiles `tests/types` (`tsconfig.types.json`), the
  compile-only tests for the circuit breaker option types.
- `scripts/test-local.ts` matches the current API: it sends `leaseId`, accepts
  `sp_` keys, expects a token-protected `/metrics`, checks the API 0.1.122
  surface and the gRPC `retry: false` dead-letter, and skips unauthenticated
  organization sign-up and email login unless `RUN_UNSAFE=1` (on by default only
  for a localhost `BASE_URL`). `scripts/test-production.ts` starts it through a
  shell on Windows, and `scripts/verify-production.ts` accepts `sp_live_` and
  `sp_test_` keys. (SDKNP-37)

## [1.3.0] - 2026-10-10

A reliability pass on the worker and the HTTP layer, from the 2026-10-10 deep
bug hunt (findings SDKNP-01 to SDKNP-28). It changes shutdown, ack and timeout
behaviour, hence the minor bump.

### Changed (behaviour)

- **`worker.stop()` drains.** It stops claiming, then lets running handlers
  finish for up to `shutdownTimeout`. A handler that returns is completed and
  one that throws is failed, even though a stop was requested meanwhile; before,
  every in-flight result was dropped and the deregister re-queued the job, so it
  ran twice. `ctx.signal` is no longer aborted merely because a stop was
  requested: it is aborted only for handlers still running when
  `shutdownTimeout` ends, and those are failed with "Worker shutdown timeout".
  The worker heartbeat keeps running while it drains, a claim already on the
  wire is drained too, and the worker deregisters last. (SDKNP-01)
- **`timeoutSeconds` is enforced.** A handler that runs longer than the job's
  `timeoutSeconds` is aborted, the worker emits `job:timeout` (declared but never
  emitted before) and fails the job with "Job timeout exceeded" instead of
  extending its lease forever. (SDKNP-16)
- **Acks are retried.** `jobs.complete`, `jobs.fail`, `jobs.heartbeat` and
  `workers.heartbeat` now retry network errors, timeouts, 5xx and 408 within the
  configured retry budget; the server answers a replay with 409, so it is safe.
  An ack that still fails after the retries emits the worker `error` event.
  `jobs.create` with an `idempotencyKey` is retried the same way. (SDKNP-05,
  SDKNP-22)
- **Failure text is always accepted.** `jobs.fail` (and so the worker) sends
  "Job failed" for empty text and truncates text over 2048 characters (by
  character, never mid-surrogate); the API rejects both with a 400 that left the
  job processing until its lease expired.
- **Plan quotas are not retried.** A 429 with code `QUOTA_EXCEEDED` (or the
  older plain-text "... limit reached" without `Retry-After`) is a quota:
  `RateLimitError.isQuota` is `true`, it is never retried and no longer counts
  toward the circuit breaker, so an enqueue over the daily cap can no longer
  block every other call on the client. (SDKNP-06)
- **gRPC `fail` retries by default.** `retry` now defaults to `true` (unary
  `fail` and `ProcessJobs`); omitting it sent proto3 `false`, which dead-lettered
  the job on its first failure whatever `maxRetries` said. Pass `retry: false`
  to dead-letter on purpose. (SDKNP-17)
- Realtime SSE: a stream the server ends after a terminal job status (or an
  `error` frame) is no longer reconnected, so the terminal event is no longer
  replayed forever. A connection must stay up for 30 s before it refills the
  reconnect budget, so `maxReconnectAttempts` is reachable; a new token is minted
  only after a 401/403, not on every retry. (SDKNP-15, SDKNP-23)

### Fixed

- `client.realtime()` no longer replaces the REST bearer. The realtime JWT used
  to be installed as the HTTP client's token, so an API-key client started
  failing every REST call with 401 once that JWT expired (24 h). The realtime
  layer keeps its own cached JWT and re-mints it near expiry. (SDKNP-02)
- Concurrent 401s with a refresh token all recover through one shared refresh;
  before, only one request did and the rest threw `AuthenticationError`.
  (SDKNP-07)
- `queues.pause(name)` without a reason no longer sends `Content-Type:
application/json` with an empty body (the API answered 400). Requests without
  a body now send no `Content-Type`. (SDKNP-08)
- HTTP 422 is mapped to `ValidationError` (its `statusCode` stays 422). (SDKNP-14)
- `queues.delete(name, { deleteJobs: true })` sends `delete_jobs=true`, which the
  API requires for a queue without a stored config or with pending jobs. (SDKNP-09)
- `workflows.jobs.list/get/getStatus` no longer fabricate `key: ""`. The API does
  not return a job's key, so `key` is now optional and `undefined`; take the
  key to job ID mapping from `workflows.create()`. (SDKNP-18)
- gRPC `leaseId` is required in `GrpcCompleteRequest`, `GrpcFailRequest` and
  `GrpcRenewLeaseRequest` (the server rejects a settlement without it).
  (SDKNP-17)
- A clean `worker.stop()` leaves no 30 s timer holding the process open, the
  `stopped` event carries the real `workerId`, and a failed `autoStart` is an
  `error` event instead of an unhandled rejection. (SDKNP-19, SDKNP-20, SDKNP-21)
- gRPC TLS detection treats `[::1]:port` and `::1` as local. (SDKNP-24)
- Admin-only clients (`new SpooledClient({ adminKey })`) can be constructed.
  (SDKNP-28)
- `CreateJobParams.completionWebhookSecret` is supported. (SDKNP-25)
- README: the organization usage example matches the real response shape.
  (SDKNP-27)

### Deprecated

- `ingest.github()`, `ingest.stripe()` and `organizations.clearWebhookToken()`
  call routes the API removed or always rejects. They now throw the new
  `UnsupportedOperationError` (code `UNSUPPORTED_OPERATION`) without a network
  call, with a message that names the replacement (`ingest.custom`,
  `organizations.regenerateWebhookToken`). They are marked `@deprecated` and
  will be removed in the next major release. (SDKNP-10, SDKNP-26)

### Added

- `UnsupportedOperationError`, `RateLimitError.isQuota`, `DeleteQueueOptions`,
  `CreateJobParams.completionWebhookSecret`, and the `idempotent` /
  `skipAuthRefresh` options on `HttpClient` requests.

## [1.2.1] - 2026-09-26

### Fixed

- **SSE realtime received nothing.** The API names every SSE frame
  (`event: job.completed`), and an `EventSource` hands named frames only to
  `addEventListener(name, ...)`; the client listened on `onmessage` alone, so
  `realtime({ type: 'sse' }).on(...)` never fired. It now listens for every
  event name the API sends.
- **`subscribe({ queueName })` over SSE streams job events.** It connected to
  `/events/queues/{name}`, which only carries `queue.stats`; it now uses
  `/events?queue={name}`, so `on('job.created')` fires for that queue. Needs
  API 0.1.114+, where `/api/v1/events` started forwarding job events.

## [1.2.0] - 2026-09-10

A contract-parity pass against the backend: every fix below is a place where
this SDK's route, request shape, or response typing disagreed with what the API
actually serves. Pair it with backend `0.1.112`, which supplies the response
fields several of these now read.

### Fixed

- Schedule `payloadTemplate` / `tags` / `metadata` are now `JsonValue`.
  They were typed `JsonObject`, so a string, array, or boolean from
  create/get did not type-check (backend `serde_json::Value`).
- Job `payload` / `result` / `tags` (and claim/complete) are now `JsonValue`.
  They were typed `JsonObject`, so a string, array, or boolean from
  `GET /jobs/{id}` did not type-check (backend `serde_json::Value`).
- `ingest.custom` now maps OpenAPI `WebhookResponse` (`jobId`, `queueName`,
  `status`). It previously returned `void`, so the created job id was dropped.
  An empty 200 still maps to an empty object.
- `auth.validate` now maps `claims.orgId` (`org_id`) onto
  `claims.organizationId` and `error` onto `message`. POST `/auth/validate`
  never sends top-level `organizationId` or `message`, so a valid token's org
  looked undefined and an invalid token's reason was dropped.
- `auth.startEmailLogin` now reads `message` and `emailSentTo` from
  `POST /auth/email/start`. It previously typed a `success` field the API never
  sends, so a successful send looked like a failure to anyone checking
  `result.success`.
- `auth.checkEmail` now types `available` and `signupEnabled` from
  `GET /auth/check-email`, which the handler always sends.
- `workflows.jobs.getDependencies` now types `dependents`, `dependenciesMet`,
  and `queueName` on each edge from `GET /jobs/{id}/dependencies`. It previously
  typed a parent `status` and per-edge `dependencyType` the API never sends.
- `organizations.getWebhookToken` / `regenerateWebhookToken` now type
  `webhookToken` and `webhookUrl`. They previously typed a `token` field the
  API never sends (`webhook_token` camelCases to `webhookToken`), so
  `result.token` was always undefined.
- `schedules.trigger` now types `triggeredAt` from `POST /schedules/{id}/trigger`.
  It previously typed `scheduledAt`, which the API never sends
  (`triggered_at` camelCases to `triggeredAt`), so `result.scheduledAt` was
  always undefined.
- `jobs.list` / `jobs.dlq.list` now type `attempt` and `maxRetries` from
  `GET /jobs` and `GET /jobs/dlq`. They previously typed `retryCount`, which
  those list bodies never send (`attempt` is already camelCase), so the count
  was always undefined. They also read the `jobType` and `lastError` that
  backend `0.1.112` adds to `JobSummary`.
- `organizations.update` sends `confirm: true` when clearing the webhook token,
  which the endpoint requires.

## [1.1.0] - 2026-08-16

### Added

- Optional stable `worker_id` on worker registration. Supplying the same id
  across restarts makes registration an upsert, so a restarting worker reuses
  its row instead of leaving the old one against the plan worker cap until the
  stale-worker reaper clears it (~2 minutes). Omitting it keeps the previous
  behaviour of a server-minted UUID. An id owned by another organization
  returns 409.
- `auto_disabled` in the outgoing-webhook `last_status` domain. The backend now
  disables a webhook after 20 consecutive failed deliveries; re-enable it by
  setting `enabled: true`, which is charged against the plan webhook cap and can
  therefore return `429 QUOTA_EXCEEDED`.

### Changed

- Webhook updates can now express clearing the signing secret distinctly from
  leaving it alone. Backend 0.1.111 treats an explicit `null` as a destructive
  clear, so an untouched secret must be omitted rather than serialised.
- `failure_count` on outgoing webhooks is now counted once per delivery rather
  than once per retry attempt, so for the same failures it is roughly 5x smaller
  than before.
- Documented that `last_used` on API keys is coarse (written at most once per
  key per five minutes) and that webhook delivery history is retained by plan
  rather than kept indefinitely.

### Note

- Backend 0.1.111 no longer accepts API keys in the query string on REST
  endpoints. This SDK sends credentials as an `Authorization` header on REST;
  SSE and WebSocket connections continue to use the query string, which the
  backend still supports for those routes.

## [1.0.40] - 2026-07-19

### Added

- Worker detail type now includes optional `queueNames` and `updatedAt`, matching the stable public REST worker detail response.

### Fixed

- Release workflow diagnostics no longer print user or project `.npmrc` contents.
- Worker docs now reflect the current SDK version default.
- Release identity verification handles both single- and double-quoted TypeScript literals.
- gRPC unary calls now use the configured client timeout and map `ServiceError` statuses into SDK error classes instead of rejecting raw gRPC errors.
- Worker `progress()` now emits local debug output instead of silently no-oping.
- `Worker.workerType` and `Worker.version` are typed `string | null` to match the backend, which serializes explicit `null` for unset values.
- Workflow examples now typecheck against the current workflow response and job-list APIs.

## [1.0.39] - 2026-07-15

### Fixed

- gRPC proto path resolution from bundled `dist/` (`getProtoPath` tries `../proto` then `../../proto`). Constructing `client.grpc` no longer ENOENT when the package root is not two levels above the module file.

## [1.0.38] - 2026-07-15

### Fixed

- gRPC `enqueue` omits unset `maxRetries` / `timeoutSeconds` so proto-loader defaults do not force wire zeros.

### Added

- Agent knowledge base under `docs/ai/knowledge/` (+ KB sync Cursor rule).

## [1.0.37] - 2026-07-14

### Changed

- Docs: stop recommending historical `./certs/` PEM paths for gRPC TLS; use the Compose-managed volume flow.

## [1.0.36] - 2026-07-13

### Fixed

- Preserve Node 18 install compatibility by using an EventSource release that supports the declared engine range.
- Reject failed WebSocket upgrades instead of leaving `connect()` pending forever.
- Continue reconnect attempts after token-provider failures instead of stopping after one failed attempt.
- Prevent custom retry predicates from replaying unsafe write requests unless the request is idempotent.
- Convert plain JavaScript payload and result objects to and from `google.protobuf.Struct` for gRPC calls.

## [1.0.35] - 2026-07-12

### Fixed

- **Worker execution identity is now lease-exact.** Overlapping executions of the
  same job are tracked by job ID plus immutable lease ID, so an older handler or
  heartbeat timer cannot borrow, cancel, delete, or settle a replacement lease.
  Cleanup removes only its captured execution and clears its own interval.
- **Lease nullability matches REST responses.** `Job.leaseId` and
  `ClaimedJob.leaseId` now accept `null`; the worker omits null lease IDs when
  calling complete, fail, or heartbeat to preserve legacy behavior.
- **Release/runtime metadata is synchronized.** Package, lockfile, SDK
  User-Agent, and default worker registration now consistently report `1.0.35`.

### Tests

- Added deterministic same-job/two-lease out-of-order worker coverage, exact
  REST request body assertions, and protobuf wire assertions for lease IDs and
  their preserved field numbers.

## [1.0.34] - 2026-07-11

### Added

- **Lease fencing (`lease_id`).** `claim()` now surfaces the backend's lease
  fencing token as `ClaimedJob.leaseId`, and the worker runtime echoes it back
  on complete/fail/heartbeat (`CompleteJobParams`/`FailJobParams`/
  `HeartbeatJobParams` accept an optional `leaseId`). When sent, the backend
  (v0.1.94+) applies the operation only if the token matches the job's current
  lease and rejects stale leases with 409 `LEASE_EXPIRED`, so a worker whose
  lease expired and was reclaimed can no longer clobber another worker's run
  (audit F9). Omitting the token preserves legacy behavior.
- **gRPC proto updated with `lease_id` fields** on `Job`, `CompleteRequest`,
  `FailRequest`, and `RenewLeaseRequest`; the TypeScript mirror types
  (`GrpcJob`, `GrpcCompleteRequest`, `GrpcFailRequest`,
  `GrpcRenewLeaseRequest`) expose it as `leaseId`.

## [1.0.33] - 2026-07-09

### Fixed

- **Realtime typed event handlers now fire.** The backend sends events tagged
  with the PascalCase enum variant name (`JobCompleted`, `JobStatusChange`,
  `QueueStats`, `WorkerHeartbeat`, ...), but the SDK dispatched by its dotted
  public names (`job.completed`, `job.status_changed`, ...), so
  `realtime.on('job.completed', cb)` never fired — only the untyped
  `onEvent()`/catch-all worked. Inbound events are now translated from the
  backend variant name to the SDK's dotted name before dispatch (covering every
  variant of the backend `RealtimeEvent` enum), for both the WebSocket and SSE
  clients. Payload fields are still camelCased on the envelope while
  `result`/`payload` blobs are preserved verbatim.
- **`realtime.subscribe()` / `unsubscribe()` no longer hang for ~10s.** They sent
  `{type, filter, requestId}` and then blocked waiting for a
  `{type:'subscribed', requestId}` acknowledgement that the server never sends,
  timing out after 10 seconds. They now send the backend command shape
  (`{cmd, queue, job_id}`) and resolve as soon as the command is written to the
  socket. Subscriptions are still tracked locally and replayed on reconnect.
- **Non-JSON error responses keep their body text.** When an error response body
  is not valid JSON (a plain-text or HTML page, or a malformed body served with
  `Content-Type: application/json`), the raw body text is now used as the error
  message instead of being discarded in favour of the bare status text.

### Changed

- **`SDK_VERSION` / User-Agent synced to the release version.** They were stuck
  at `1.0.31`; both now report `1.0.33`.

## [1.0.32] - 2026-07-09

### Fixed

- **Credentials are trimmed of surrounding whitespace.** API keys, access tokens,
  and refresh tokens read from a file or environment variable often carry a
  trailing newline; the client now trims them at config resolution (an
  all-whitespace value is treated as unset). Prevents a cryptic failure such as
  Go's `net/http: invalid header field value` on a newline-tainted key.

## [1.0.31] - 2026-07-08

### Fixed

- **Realtime no longer re-logs-in on every WebSocket (re)connect.** The token
  provider handed to `client.realtime()` minted a brand-new JWT via
  `POST /api/v1/auth/login` on each connect and reconnect. Under a reconnect
  storm this quickly tripped the login rate limit (HTTP 429), after which
  realtime could never recover. The client now caches the JWT (at the client
  level, shared across reconnects) and reuses it until it is within ~60s of its
  `exp`. It decodes the `exp` claim directly (base64url-decode of the payload,
  no signature verification) to decide when to refresh, and only re-logs-in when
  the cached token is absent, near expiry, or explicitly force-refreshed.
  Concurrent logins (e.g. WebSocket and SSE reconnecting together) are
  deduplicated into a single request. The happy path is unchanged — just
  without the redundant logins.
- **Rejected tokens force a single refresh.** When the server rejects the token
  on the WebSocket upgrade (HTTP 401/403), the transport now asks the provider
  to force-refresh on the next reconnect, so a stale or revoked token is
  replaced instead of being replayed into a reconnect loop.

## [1.0.30] - 2026-07-08

### Fixed

- **Realtime is usable without a `debug` option** (regression in 1.0.29). Building
  a client without `debug` — the normal, default case — made `client.realtime()`
  throw `TypeError: this.options.debug is not a function` on connect. The
  `SpooledRealtime` wrapper forwards `debug: undefined`, and the WebSocket/SSE
  constructors spread `...options` after their no-op `debug` default, so that
  explicit `undefined` overwrote the no-op. The constructors now coalesce
  `debug` to a no-op after the spread (`options.debug ?? (() => {})`), so
  `debug` is always callable regardless of the caller. `SpooledClient.realtime()`
  also no longer forwards an explicit `debug: undefined`.
- **Auto-reconnect now actually defaults on** (same clobber-by-`undefined` class
  as the `debug` bug). `autoReconnect`, `maxReconnectAttempts`, `reconnectDelay`,
  and `maxReconnectDelay` were defaulted _before_ the `...options` spread, so the
  `undefined` values `SpooledRealtime` forwards overwrote them — `autoReconnect`
  resolved to `undefined` (falsy), silently disabling reconnect despite the
  documented default of `true`. These defaults are now applied after the spread.

### Changed

- **`CreateScheduleParams.payloadTemplate`** documentation now states the field
  is required — the API returns HTTP 422 for a create without it. The field
  remains typed as non-optional so omissions are caught at compile time.

## [1.0.29] - 2026-07-08

### Fixed

- **Realtime WebSocket authentication**: the SDK now mints a fresh JWT (via the
  login/refresh path) for every WebSocket (re)connect and passes it in `?token=`;
  reconnects after token expiry recover instead of failing.
- **Realtime event payloads** are now key-case converted like the rest of the API
  (user `payload`/`result` preserved), so typed fields are populated.
- **Non-idempotent POSTs** (job enqueue, worker complete/fail) are no longer retried
  on ambiguous network/timeout/5xx failures unless an idempotency key is present,
  preventing duplicate jobs.
- **Auto token refresh** on 401 is now wired into the HTTP layer.
- `logout()` sends the refresh token so the session is revoked.
- Worker heartbeat timers no longer leak when jobs are force-failed on shutdown.
- A failed initial SSE connect no longer leaks an auto-reconnecting EventSource.
- Reconnect backoff has jitter; JWTs are redacted from debug logs; the
  `{error, code, details}` error shape is parsed.
