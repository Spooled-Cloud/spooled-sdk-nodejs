# gRPC Guide

Spooled provides a high-performance gRPC API for scenarios requiring maximum throughput and streaming capabilities.

## Performance

The gRPC API is **~28x faster** than the HTTP API when Redis caching is enabled:

- **HTTP API**: ~1400ms per request (first) → ~100ms (cached)
- **gRPC API**: ~50ms per request (cached)
- **Throughput**: Suitable for 1000+ jobs/second per worker

Performance optimizations:

- ✅ **Redis API key caching** eliminates bcrypt verification on cache hits
- ✅ **Batch operations** reduce round trips
- ✅ **Connection pooling** reuses HTTP/2 streams
- ✅ **Binary serialization** with Protobuf

## Plan Limits

All gRPC operations automatically enforce tier-based limits:

- ✅ **Enqueue operations** check daily and active job limits
- ✅ **Worker registration** enforces worker limits
- ✅ **Batch operations** validate all jobs in the batch

When limits are exceeded, you'll receive a `RESOURCE_EXHAUSTED` status:

```typescript
try {
  await grpcClient.queue.enqueue({
    /* ... */
  });
} catch (error) {
  if (error.code === grpc.status.RESOURCE_EXHAUSTED) {
    console.log("Plan limit exceeded:", error.details);
    // Example: "active jobs limit reached (10/10). Upgrade to starter for higher limits."
  }
}
```

## When to Use gRPC

| Use Case                   | Recommended API |
| -------------------------- | --------------- |
| Web/mobile apps            | REST            |
| Dashboard/admin interfaces | REST            |
| High-throughput workers    | **gRPC**        |
| Streaming job delivery     | **gRPC**        |
| Low-latency operations     | **gRPC**        |
| Batch processing           | **gRPC**        |

## SDK gRPC Client (recommended)

`@spooled/sdk` ships a typed gRPC client, `SpooledGrpcClient`, that loads the bundled proto, converts
`payload` and `result` to and from `google.protobuf.Struct`, applies the client timeout as a
deadline and maps gRPC status codes to the SDK's error classes.

```typescript
import { SpooledGrpcClient } from "@spooled/sdk";

const grpcClient = new SpooledGrpcClient({
  address: "grpc.spooled.cloud:443",
  apiKey: process.env.SPOOLED_API_KEY!,
});

// A stable workerId (proto field 7) makes a restart update the same worker
// instead of adding one that counts against the plan's worker limit.
const { workerId } = await grpcClient.workers.register({
  queueName: "emails",
  hostname: "worker-1",
  workerId: "emails-worker-01",
});

await grpcClient.queue.enqueue({
  queueName: "emails",
  payload: { to: "user@example.com" },
});

const { jobs } = await grpcClient.queue.dequeue({
  queueName: "emails",
  workerId,
  batchSize: 10,
  leaseDurationSecs: 300,
});

for (const job of jobs) {
  const leaseId = job.leaseId as string; // required on complete/fail/renewLease
  try {
    await grpcClient.queue.complete({
      jobId: job.id,
      workerId,
      leaseId,
      result: { sent: true },
    });
  } catch (error) {
    await grpcClient.queue.fail({
      jobId: job.id,
      workerId,
      leaseId,
      error: String(error),
      // retry defaults to true: retried until maxRetries run out.
      // retry: false dead-letters the job now.
    });
  }
}
```

### Settlement Rules

- **`leaseId` is required** on `Complete`, `Fail` and `RenewLease`: a call without it fails with
  `INVALID_ARGUMENT` (`ValidationError`), and a stale lease with `FAILED_PRECONDITION`.
- **`Fail.retry` is `optional bool` (field 4).** Omitted or `true`: the job is retried until its
  `maxRetries` run out, the same as REST. `false`: the job goes to the dead-letter queue now. The SDK
  sends `retry: true` when you do not set it, because servers before API 0.1.118 declared a plain
  `bool` and read an absent field as `false`. With raw `@grpc/proto-loader`, load the current
  `proto/spooled.proto` so an explicit `false` is encoded with presence.
- **Omitted lease = 300 s.** `leaseDurationSecs` 0 or omitted uses the server default (300 s on
  Spooled Cloud); otherwise 5-3600 s.

### Payload and Result Are `google.protobuf.Struct`

Over gRPC `payload` and `result` are `google.protobuf.Struct` messages, which limits them compared
with REST (documented server limitation, BEGRPC-05):

- **Only a JSON object travels.** A job whose payload is an array, string, number, boolean or `null`
  (possible over REST) arrives over gRPC as an empty object, and the SDK's `enqueue` types only
  accept an object.
- **Numbers are doubles.** Integers at or above 2^53 lose precision over gRPC (REST keeps them):
  send such ids as strings.

Use REST (`client.jobs.*`) for jobs that need non-object payloads or exact large integers.

### Forward Compatibility

A `Job.status` enum value newer than the SDK's proto arrives as its number in a string (for example
`"42"`), never as an error. Handle a `default` case when you switch over it.

## Prerequisites

The rest of this guide calls `@grpc/grpc-js` directly, for languages or setups that cannot use the
SDK client.

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

The proto file is included in the SDK package at `node_modules/@spooled/sdk/proto/spooled.proto`.

## Basic Setup

```typescript
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { join } from "path";

// Load the proto file
const PROTO_PATH = join(
  require.resolve("@spooled/sdk"),
  "../../proto/spooled.proto",
);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const spooled = grpc.loadPackageDefinition(packageDefinition).spooled.v1 as any;

// Create clients
// For Spooled Cloud:
const GRPC_ADDRESS = "grpc.spooled.cloud:443";
// For self-hosted: 'your-server.com:443' or 'localhost:50051'

const queueClient = new spooled.QueueService(
  GRPC_ADDRESS,
  grpc.credentials.createSsl(),
);

const workerClient = new spooled.WorkerService(
  GRPC_ADDRESS,
  grpc.credentials.createSsl(),
);

// For local development without TLS:
// const localClient = new spooled.QueueService(
//   'localhost:50051',
//   grpc.credentials.createInsecure()
// );

// Create metadata with API key
function createMetadata(apiKey: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.add("x-api-key", apiKey);
  return metadata;
}

const metadata = createMetadata("sp_live_your_api_key");

// payload/result are google.protobuf.Struct messages. proto-loader does not
// convert plain objects, so encode and decode them yourself (or use
// SpooledGrpcClient, which does this for you).
function toValue(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: 0 };
  if (Array.isArray(v)) return { listValue: { values: v.map(toValue) } };
  switch (typeof v) {
    case "number":
      return { numberValue: v };
    case "string":
      return { stringValue: v };
    case "boolean":
      return { boolValue: v };
    default:
      return { structValue: toStruct(v as Record<string, unknown>) };
  }
}
function toStruct(obj: Record<string, unknown>): any {
  return {
    fields: Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, toValue(v)]),
    ),
  };
}
function fromValue(v: any): unknown {
  if (v.structValue) return fromStruct(v.structValue);
  if (v.listValue) return (v.listValue.values ?? []).map(fromValue);
  if ("stringValue" in v) return v.stringValue;
  if ("numberValue" in v) return v.numberValue;
  if ("boolValue" in v) return v.boolValue;
  return null;
}
function fromStruct(s: any): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(s?.fields ?? {}).map(([k, v]) => [k, fromValue(v)]),
  );
}
```

## Enqueue Jobs

```typescript
// Single job
queueClient.Enqueue(
  {
    queueName: "emails",
    payload: toStruct({ to: "user@example.com", subject: "Hello" }),
    priority: 5,
    maxRetries: 3,
  },
  metadata,
  (error, response) => {
    if (error) {
      console.error("Enqueue failed:", error);
      return;
    }
    console.log("Job ID:", response.jobId);
    console.log("Created:", response.created);
  },
);
```

### Promise Wrapper

```typescript
function enqueue(request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    queueClient.Enqueue(request, metadata, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

// Usage
const result = await enqueue({
  queueName: "emails",
  payload: toStruct({ to: "user@example.com" }),
});
```

## Dequeue Jobs (Batch)

```typescript
queueClient.Dequeue(
  {
    queueName: "emails",
    workerId: "worker-1",
    batchSize: 10,
    leaseDurationSecs: 300,
  },
  metadata,
  (error, response) => {
    if (error) {
      console.error("Dequeue failed:", error);
      return;
    }

    for (const job of response.jobs) {
      console.log(`Job ${job.id}:`, fromStruct(job.payload));
      processJob(job);
    }
  },
);
```

## Streaming Jobs (Server-Side Streaming)

The most powerful feature: receive jobs as a continuous stream.

```typescript
const stream = queueClient.StreamJobs(
  {
    queueName: "emails",
    workerId: "worker-1",
    leaseDurationSecs: 300,
  },
  metadata,
);

stream.on("data", (job) => {
  console.log(`Received job: ${job.id}`);
  const payload = fromStruct(job.payload);

  processJob(job.id, payload)
    .then((result) => completeJob(job.id, "worker-1", job.leaseId, result))
    .catch((error) => failJob(job.id, "worker-1", job.leaseId, error.message));
});

stream.on("error", (error) => {
  console.error("Stream error:", error);
});

stream.on("end", () => {
  console.log("Stream ended");
});

// Cancel stream when done
// stream.cancel();
```

**`StreamJobs` delivers one job at a time per stream.** The server sends the next job only after
the previous one on that stream is completed, failed, released, or its lease has run out, so settle
every job with `Complete` or `Fail`. To process several jobs at once, open one stream per job slot
(at most 100 open streams per organization per server). A lease is whatever you send in
`leaseDurationSecs` (5-3600 s); when it is omitted or `0` the server's default applies (300 s on
Spooled Cloud). A job that may run longer than its lease must be renewed with `RenewLease`
(`jobId`, `workerId`, `leaseId`, `extensionSecs`) before it expires.

## Bidirectional Streaming (ProcessJobs)

Full duplex streaming on `QueueService.ProcessJobs`. Each request is one of `dequeue`, `complete`,
`fail` or `renewLease`; each response one of `job`, `complete`, `fail`, `renewLease` or `error`:

```typescript
const call = queueClient.ProcessJobs(metadata);

// Handle incoming jobs from server
call.on("data", (response) => {
  if (response.job) {
    console.log(`Received job: ${response.job.id}`);

    processJobAsync(response.job)
      .then((result) => {
        // Send completion back to server
        call.write({
          complete: {
            jobId: response.job.id,
            workerId: "worker-1",
            leaseId: response.job.leaseId, // required by the server
            result: toStruct(result),
          },
        });
      })
      .catch((error) => {
        // Send failure back to server
        call.write({
          fail: {
            jobId: response.job.id,
            workerId: "worker-1",
            leaseId: response.job.leaseId, // required by the server
            error: error.message,
            retry: true, // false dead-letters the job now
          },
        });
      });
  }

  if (response.error) {
    console.error("Stream request failed:", response.error.message);
  }
});

// Ask for jobs (repeat after settling them)
call.write({
  dequeue: {
    queueName: "emails",
    workerId: "worker-1",
    leaseDurationSecs: 300,
    batchSize: 10,
  },
});

// Worker heartbeats are a separate unary call: WorkerService.Heartbeat.

// Handle stream events
call.on("error", (error) => {
  console.error("Stream error:", error);
});

call.on("end", () => {
  console.log("Stream ended");
});
```

## Complete and Fail Jobs

```typescript
function completeJob(
  jobId: string,
  workerId: string,
  leaseId: string,
  result?: any,
): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.Complete(
      {
        jobId,
        workerId,
        leaseId, // required by the server
        result: result ? toStruct(result) : undefined,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

function failJob(
  jobId: string,
  workerId: string,
  leaseId: string,
  errorMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.Fail(
      {
        jobId,
        workerId,
        leaseId, // required by the server
        error: errorMessage,
        // optional bool: true (or omitted, on API 0.1.118+) retries until
        // maxRetries run out; false dead-letters the job now.
        retry: true,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}
```

## Renew Lease

Keep jobs alive during long processing. Preserve the dequeued job's `leaseId` and send it with every renew/complete/fail operation; a stale token is rejected with gRPC `FAILED_PRECONDITION`.

```typescript
function renewLease(
  jobId: string,
  workerId: string,
  leaseId: string,
  durationSecs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.RenewLease(
      {
        jobId,
        workerId,
        leaseId, // required by the server
        extensionSecs: durationSecs,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

// Usage: Renew lease every 30 seconds during processing
async function processWithLeaseRenewal(job: any) {
  const renewalInterval = setInterval(() => {
    renewLease(job.id, workerId, job.leaseId, 60).catch(console.error);
  }, 30000);

  try {
    await longRunningProcess(job);
    await completeJob(job.id, workerId, job.leaseId);
  } finally {
    clearInterval(renewalInterval);
  }
}
```

## Queue Statistics

```typescript
queueClient.GetQueueStats(
  { queueName: "emails" },
  metadata,
  (error, response) => {
    if (error) {
      console.error("GetQueueStats failed:", error);
      return;
    }

    console.log("Queue:", response.queueName);
    console.log("Pending:", response.pending);
    console.log("Processing:", response.processing);
    console.log("Completed:", response.completed);
    console.log("Failed:", response.failed);
  },
);
```

## Error Handling

gRPC errors have status codes:

```typescript
import { status } from "@grpc/grpc-js";

stream.on("error", (error: any) => {
  switch (error.code) {
    case status.UNAUTHENTICATED:
      console.error("Invalid API key");
      break;
    case status.PERMISSION_DENIED:
      console.error("Access denied");
      break;
    case status.UNAVAILABLE:
      console.error("Service unavailable, retrying...");
      reconnect();
      break;
    case status.DEADLINE_EXCEEDED:
      console.error("Request timed out");
      break;
    default:
      console.error("gRPC error:", error.message);
  }
});
```

## Connection Management

### Keepalive Settings

```typescript
const channelOptions = {
  "grpc.keepalive_time_ms": 30000, // Send keepalive every 30s
  "grpc.keepalive_timeout_ms": 10000, // Wait 10s for keepalive ack
  "grpc.keepalive_permit_without_calls": 1, // Allow keepalive without active calls
  "grpc.http2.min_time_between_pings_ms": 10000,
};

const queueClient = new spooled.QueueService(
  "grpc.spooled.cloud:443",
  grpc.credentials.createSsl(),
  channelOptions,
);
```

### Connection Retry

```typescript
function createClientWithRetry(maxRetries = 5) {
  let retries = 0;

  function connect() {
    const client = new spooled.QueueService(
      "grpc.spooled.cloud:443",
      grpc.credentials.createSsl(),
    );

    // Check connection health
    client.waitForReady(Date.now() + 5000, (error) => {
      if (error) {
        if (retries < maxRetries) {
          retries++;
          console.log(`Connection failed, retry ${retries}/${maxRetries}`);
          setTimeout(connect, 1000 * retries);
        } else {
          console.error("Max retries exceeded");
        }
      } else {
        retries = 0;
        console.log("Connected to gRPC server");
      }
    });

    return client;
  }

  return connect();
}
```

## Full Streaming Worker Example

```typescript
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

async function main() {
  // Load proto
  const packageDefinition = protoLoader.loadSync("spooled.proto", {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const spooled = grpc.loadPackageDefinition(packageDefinition).spooled
    .v1 as any;

  // Create client
  const client = new spooled.QueueService(
    "grpc.spooled.cloud:443",
    grpc.credentials.createSsl(),
  );

  const metadata = new grpc.Metadata();
  metadata.add("x-api-key", process.env.SPOOLED_API_KEY!);

  // Start streaming
  const stream = client.StreamJobs(
    {
      queueName: "emails",
      workerId: `worker-${process.pid}`,
      leaseDurationSecs: 300,
    },
    metadata,
  );

  const activeJobs = new Map<string, NodeJS.Timeout>();

  stream.on("data", async (job: any) => {
    console.log(`Received job: ${job.id}`);

    // Start lease renewal
    const renewalTimer = setInterval(() => {
      client.RenewLease(
        {
          jobId: job.id,
          workerId: `worker-${process.pid}`,
          leaseId: job.leaseId,
          extensionSecs: 300,
        },
        metadata,
        () => {},
      );
    }, 60000);
    activeJobs.set(job.id, renewalTimer);

    try {
      const payload = fromStruct(job.payload);
      const result = await processEmail(payload);

      client.Complete(
        {
          jobId: job.id,
          workerId: "worker-1",
          leaseId: job.leaseId, // required by the server
          result: toStruct(result),
        },
        metadata,
        (err) => {
          if (err) console.error(`Complete failed for ${job.id}:`, err);
          else console.log(`Completed: ${job.id}`);
        },
      );
    } catch (error: any) {
      client.Fail(
        {
          jobId: job.id,
          workerId: "worker-1",
          leaseId: job.leaseId, // required by the server
          error: error.message,
          retry: true, // false would dead-letter the job now
        },
        metadata,
        (err) => {
          if (err) console.error(`Fail failed for ${job.id}:`, err);
          else console.log(`Failed: ${job.id}`);
        },
      );
    } finally {
      clearInterval(activeJobs.get(job.id));
      activeJobs.delete(job.id);
    }
  });

  stream.on("error", (error) => {
    console.error("Stream error:", error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("Shutting down...");
    stream.cancel();
    activeJobs.forEach((timer) => clearInterval(timer));
    client.close();
  });
}

async function processEmail(payload: any) {
  // Your email sending logic
  console.log("Sending email to:", payload.to);
  await new Promise((r) => setTimeout(r, 1000)); // Simulate work
  return { sent: true };
}

main().catch(console.error);
```

## Self-Hosted gRPC

For self-hosted deployments, configure the gRPC address to point to your server:

```typescript
// Self-hosted with TLS
const client = new spooled.QueueService(
  "grpc.your-company.com:443",
  grpc.credentials.createSsl(),
);

// Self-hosted without TLS (development only)
const devClient = new spooled.QueueService(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);

// With custom root certificate
const fs = require("fs");
const rootCert = fs.readFileSync("/path/to/ca.pem");
const credentials = grpc.credentials.createSsl(rootCert);
const customTlsClient = new spooled.QueueService(
  "grpc.your-company.com:443",
  credentials,
);
```

### Environment-Based Configuration

```typescript
const grpcAddress =
  process.env.SPOOLED_GRPC_ADDRESS || "grpc.spooled.cloud:443";
const useTls = !grpcAddress.startsWith("localhost");

const client = new spooled.QueueService(
  grpcAddress,
  useTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure(),
);
```

### gRPC TLS with Cloudflare Tunnel

Cloudflare Tunnel **requires HTTPS** for HTTP/2 connections (which gRPC uses). You cannot use plaintext HTTP for gRPC through Cloudflare Tunnel.

#### Required Configuration

1. **Enable TLS on the backend** (default in `docker-compose.prod.yml`):

   ```yaml
   environment:
     GRPC_TLS_ENABLED: "true"
   ```

2. **Configure Cloudflare Tunnel**:
   - Service Type: `HTTPS`
   - URL: `backend:50051`
   - HTTP2 connection: `ON`
   - No TLS Verify: `ON` (required for self-signed certs)

3. **Connect with TLS from SDK**:
   ```typescript
   const client = new spooled.QueueService(
     "grpc.your-domain.com:443",
     grpc.credentials.createSsl(),
   );
   ```

Production Compose generates a private self-signed origin certificate into a Docker volume (`grpc_tls`) and renews it automatically. Historical `./certs/` PEMs in Git/images must not be reused. Cloudflare Tunnel "No TLS Verify" remains appropriate for that private origin cert.

### Disabling gRPC TLS

For local development or when TLS terminates at a load balancer:

```bash
# Backend
GRPC_TLS_ENABLED=false cargo run

# Or in docker-compose:
environment:
  GRPC_TLS_ENABLED: "false"
```

Then connect without TLS:

```typescript
const client = new spooled.QueueService(
  "localhost:50051",
  grpc.credentials.createInsecure(),
);
```

## Proto File Reference

The full proto file is available at:

- SDK: `node_modules/@spooled/sdk/proto/spooled.proto`
- GitHub: [spooled-backend/proto/spooled.proto](https://github.com/Spooled-Cloud/spooled-backend/blob/main/proto/spooled.proto)

Key services:

- `QueueService`: Enqueue, Dequeue, Complete, Fail, RenewLease, GetJob, GetQueueStats,
  StreamJobs (server streaming), ProcessJobs (bidirectional streaming)
- `WorkerService`: Register, Heartbeat, Deregister

The SDK's copy is the backend's `proto/spooled.proto` unchanged (`FailRequest.retry` and
`RegisterWorkerRequest.worker_id` are `optional`, so they carry field presence).
