# Changelog

All notable changes to the Spooled Node.js SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
