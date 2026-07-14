# Changelog

All notable changes to the Spooled Node.js SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  and `maxReconnectDelay` were defaulted *before* the `...options` spread, so the
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
