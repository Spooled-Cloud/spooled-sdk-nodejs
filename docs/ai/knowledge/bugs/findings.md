# Findings (Node SDK)

| ID | Sev | Summary | Evidence |
|----|-----|---------|----------|
| NS-01 | P2 | proto-loader `defaults: true` may send int zeros on gRPC enqueue | `src/grpc/loader.ts` |
| NS-02 | P3 | Worker `progress` no-op | `src/worker/worker.ts` ~360–363 |
| NS-03 | P3 | UA string `@spooled/sdk-nodejs` ≠ npm name `@spooled/sdk` | intentional; keep sync with version |

See `findings.jsonl`.
