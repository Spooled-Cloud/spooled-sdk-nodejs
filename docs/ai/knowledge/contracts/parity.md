# Parity notes (Node)

- Full gRPC including StreamJobs/ProcessJobs.
- Worker `progress` is a **no-op** (unlike Go).
- No public webhook signature **validate** helpers (PHP has).
- Job `maxRetries`/`timeoutSeconds` optional on REST → server defaults when omitted.
