/**
 * Compile-only type tests for the worker payload type parameter.
 *
 * Nothing here runs: `npm run typecheck` compiles this file through
 * `tsconfig.types.json`. It pins that `process<TPayload>()` types
 * `ctx.payload`, that an annotated context infers it, and that handlers
 * written for 1.6.0 (no type argument, `ctx.payload` is `JsonValue`) still
 * compile.
 */

import { expectTypeOf } from "vitest";
import { SpooledClient } from "../../src/index.js";
import { SpooledWorker } from "../../src/worker/index.js";
import type { JobContext, JobHandler } from "../../src/worker/index.js";
import type { JsonValue } from "../../src/index.js";

declare const client: SpooledClient;
const worker = new SpooledWorker(client, { queueName: "emails" });

interface EmailPayload {
  to: string;
  subject: string;
}

// Explicit type argument: destructuring the payload compiles.
worker.process<EmailPayload>(async (ctx) => {
  expectTypeOf(ctx.payload).toEqualTypeOf<EmailPayload>();
  const { to, subject } = ctx.payload;
  return { sent: `${to}:${subject}` };
});

// Inferred from an annotated context.
worker.process(async (ctx: JobContext<EmailPayload>) => {
  expectTypeOf(ctx.payload.to).toEqualTypeOf<string>();
});

// 1.6.0 shape: no type argument, payload is any JSON.
worker.process(async (ctx) => {
  expectTypeOf(ctx.payload).toEqualTypeOf<JsonValue>();
  return null;
});

// The defaults are unchanged.
expectTypeOf<JobContext["payload"]>().toEqualTypeOf<JsonValue>();
expectTypeOf<JobHandler>().toEqualTypeOf<JobHandler<JsonValue>>();
