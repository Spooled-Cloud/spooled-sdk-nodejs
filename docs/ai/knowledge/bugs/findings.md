# Findings (Node SDK)

| ID    | Sev | Summary                                                                                   | Evidence                            | Status                            |
| ----- | --- | ----------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------- |
| NS-01 | P2  | proto-loader `defaults: true` may send int zeros on gRPC enqueue                          | `src/grpc/loader.ts`                | fixed (omit unset ints; `1.0.38`) |
| NS-02 | P3  | Worker `progress` no-op                                                                   | `src/worker/worker.ts` ~360–363     | fixed in `1.0.40` (local debug)   |
| NS-03 | P3  | UA string `@spooled/sdk-nodejs` ≠ npm name `@spooled/sdk`                                 | intentional; keep sync with version | open                              |
| NS-04 | P1  | Bundled `dist/` gRPC proto path used `../../proto` → ENOENT (resolved above package root) | `src/grpc/loader.ts` `getProtoPath` | fixed in `1.0.39`                 |
| NS-05 | P3  | Publish workflow printed npm config files                                                 | `.github/workflows/publish.yml`     | fixed in `1.0.40`                 |
| NS-06 | P1  | Release identity regex missed double-quoted version literals                              | `.github/workflows/publish.yml`     | fixed in `1.0.40`                 |
| NS-07 | P2  | gRPC unary calls ignored configured timeout and rejected raw `ServiceError`               | `src/grpc/client.ts`                | fixed in `1.0.40`                 |
| NS-08 | P2  | Workflow examples used stale response fields                                              | `examples/workflow-dag.ts`          | fixed in `1.0.40`                 |
| NS-09 | P1  | ~~`startEmailLogin` typed `success` the API never sends; `checkEmail` dropped `available`/`signupEnabled`~~ **FIXED** | `src/resources/auth.ts` | working tree |
| NS-10 | P2  | ~~`getDependencies` typed `status`/`dependencyType`; dropped `queueName`/`dependenciesMet`~~ **FIXED** | `src/types/workflows.ts` | working tree |
| NS-11 | P1  | ~~`getWebhookToken` typed `token`; API sends `webhook_token`/`webhook_url`~~ **FIXED** | `src/types/organizations.ts` | working tree |
| NS-12 | P1  | ~~`schedules.trigger` typed `scheduledAt`; API sends `triggered_at`~~ **FIXED** | `src/types/schedules.ts` | working tree |
| NS-13 | P1  | ~~`JobSummary.retryCount` always undefined; list JSON sends `attempt`~~ **FIXED** | `src/types/jobs.ts` | working tree |
| NS-14 | P1  | ~~`workflows.get()` left `totalJobs`/`completedJobs`/`failedJobs` undefined~~ **FIXED** | `src/resources/workflows.ts`; GET detail puts counts under `progress` | working tree |
| NS-15 | P2  | ~~`JobSummary` omitted `jobType` from `GET /jobs`~~ **FIXED** | `src/types/jobs.ts`; `src/resources/jobs.ts` | working tree |
| NS-16 | P2  | ~~`jobs.retry` left `jobType` undefined; GET maps it from payload~~ **FIXED** | `src/resources/jobs.ts` | working tree |
| NS-17 | P2  | ~~`JobSummary` omitted `lastError` from list/DLQ~~ **FIXED** | `src/types/jobs.ts` | working tree |
| NS-18 | P1  | ~~`auth.validate` typed `claims.organizationId`/`message`; API sends `org_id`/`error`~~ **FIXED** | `src/resources/auth.ts`; POST `/auth/validate` is `{valid,error,claims}` |
| NS-19 | P1  | ~~`clearWebhookToken` POSTed an empty body (422); API requires `{confirm:true}`~~ **FIXED** | `src/resources/organizations.ts` |
| NS-20 | P1  | ~~`ingest.custom` returned `void` and dropped `jobId` after backend started sending `WebhookResponse`~~ **FIXED** | `src/resources/webhook-ingestion.ts` |

See `findings.jsonl`.
