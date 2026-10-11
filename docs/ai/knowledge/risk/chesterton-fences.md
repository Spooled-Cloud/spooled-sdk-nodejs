# Fences

- Keep `SDK_VERSION` and User-Agent tied to package version (historical stickiness bugs).
- Do not switch REST auth to `X-API-Key` — backend rejects it on REST.
- Do not call `http.setAuthToken` from the realtime login path: an API-key client has no refresh function, so a 24 h realtime JWT would silently replace the API key for REST (SDKNP-02).
- Do not abort `ctx.signal` when `stop()` is requested, and do not skip complete/fail because a signal is aborted: the abort is only for timeouts and for stragglers after `shutdownTimeout`; a returned handler must always be acked (SDKNP-01).
- Do not retry a quota 429 or let it trip the circuit breaker (SDKNP-06); do not blind-retry POSTs that are not lease-fenced or keyed (job creation without `idempotencyKey`).
- Do not default gRPC `fail.retry` to false/omitted (proto3 false dead-letters on the first failure).
