# Transport

- REST base default `https://api.spooled.cloud`; timeout 30s; HTTP retry maxRetries 3 (`src/config.ts`).
- Auth: `Authorization: Bearer` (`src/utils/http.ts`); admin `X-Admin-Key`.
- gRPC: `grpc.spooled.cloud:443`, metadata `x-api-key` (`src/grpc/client.ts`). Unary calls inherit the configured client timeout as a gRPC deadline; streaming calls remain opt-in via stream options.
- Proto loader `defaults: true` (`src/grpc/loader.ts`) — encodeEnqueue omits unset ints (1.0.39); backend maps wire 0 → QUEUE*DEFAULT*\* since 0.1.107.

- `getProtoPath` resolves `proto/spooled.proto` from both `dist/` and `src/grpc/` layouts (1.0.39 / NS-04).

## Retry, auth and acks (1.3.0)

- POST/PATCH are not retried on network/timeout/5xx unless the call is marked `idempotent` (`HttpRequestOptions.idempotent`): `jobs.complete/fail/heartbeat`, `workers.heartbeat` (lease-fenced, the server answers a replay with 409) and `jobs.create` with an `idempotencyKey`. 408 is retryable; other 4xx never.
- A quota 429 (`RateLimitError.isQuota`) is never retried (also not for GET) and is not counted by the circuit breaker.
- No 429 counts toward the circuit breaker (1.4.0, SDKNP-32): `isCircuitBreakerFailure` (the default `isFailure`, also passed by `createCircuitBreaker`) returns false for every `RateLimitError`. Rate-limit 429s are retried by `withRetry` after `Retry-After`; counting them opened the breaker on a burst above the plan limit and failed every call for 30 s.
- A 401 with a refresh function shares ONE in-flight refresh (`HttpClient.refreshInFlight`); a request whose 401 predates the new token is only replayed. `auth.login/refresh` pass `skipAuthRefresh` so the refresh itself cannot wait on itself.
- Requests with no body send no `Content-Type` (an empty body claiming JSON makes axum's optional-body extractors 400).
- `client.realtime()` mints its JWT into `SpooledClient.cachedJwt` only; the REST bearer stays the API key. The realtime layer re-mints near expiry via `tokenProvider`.

## Worker lifecycle (1.3.0)

- `stop()` drains: stop polling, await a claim already on the wire, wait up to `shutdownTimeout` for handlers, ack every returned/thrown handler, then abort+fail (`Worker shutdown timeout`) only the stragglers, await in-flight acks, stop the worker heartbeat, deregister LAST (deregister re-queues held jobs). `ctx.signal` is not aborted by a stop request.
- `ActiveJob.settled` marks an execution whose outcome is decided (acked or force-failed); a late handler result is dropped. `ActiveJob.ack` is the in-flight ack the shutdown awaits.
- `timeoutSeconds > 0`: handler raced against a timer; on expiry abort (`reason` "Job timeout exceeded"), emit `job:timeout`, fail "Job timeout exceeded".
- Failure text goes through `coerceFailureMessage` (`src/utils/failure.ts`): empty -> "Job failed", > 2048 code points truncated.
- Ack failures (after HTTP retries) emit the worker `error` event.
- SSE: a job stream ends after a terminal `job.status` (or an `error` frame) and is not reconnected; a connection must stay up 30 s before it refills `maxReconnectAttempts`; a new token is forced only after a 401/403.
