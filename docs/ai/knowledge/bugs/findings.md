# Findings (Node SDK)

| ID    | Sev | Summary                                                                                   | Evidence                            | Status                            |
| ----- | --- | ----------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| NS-01 | P2  | proto-loader `defaults: true` may send int zeros on gRPC enqueue                          | `src/grpc/loader.ts`                | fixed (omit unset ints; `1.0.38`) |
| NS-02 | P3  | Worker `progress` no-op                                                                   | `src/worker/worker.ts` ~360–363     | open                              |
| NS-03 | P3  | UA string `@spooled/sdk-nodejs` ≠ npm name `@spooled/sdk`                                 | intentional; keep sync with version | open                              |
| NS-04 | P1  | Bundled `dist/` gRPC proto path used `../../proto` → ENOENT (resolved above package root) | `src/grpc/loader.ts` `getProtoPath` | fixed in `1.0.39`                 |
| NS-05 | P3  | Publish workflow printed npm config files                                                 | `.github/workflows/publish.yml`     | fixed working tree                |

See `findings.jsonl`.
