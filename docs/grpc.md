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
  await grpcClient.queue.enqueue({ /* ... */ });
} catch (error) {
  if (error.code === grpc.status.RESOURCE_EXHAUSTED) {
    console.log('Plan limit exceeded:', error.details);
    // Example: "active jobs limit reached (10/10). Upgrade to starter for higher limits."
  }
}
```

## When to Use gRPC

| Use Case | Recommended API |
|----------|-----------------|
| Web/mobile apps | REST |
| Dashboard/admin interfaces | REST |
| High-throughput workers | **gRPC** |
| Streaming job delivery | **gRPC** |
| Low-latency operations | **gRPC** |
| Batch processing | **gRPC** |

## Prerequisites

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

The proto file is included in the SDK package at `node_modules/@spooled/sdk/proto/spooled.proto`.

## Basic Setup

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

// Load the proto file
const PROTO_PATH = join(
  require.resolve('@spooled/sdk'),
  '../../proto/spooled.proto'
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
const GRPC_ADDRESS = 'grpc.spooled.cloud:443';
// For self-hosted: 'your-server.com:443' or 'localhost:50051'

const queueClient = new spooled.QueueService(
  GRPC_ADDRESS,
  grpc.credentials.createSsl()
);

const workerClient = new spooled.WorkerService(
  GRPC_ADDRESS,
  grpc.credentials.createSsl()
);

// For local development without TLS:
// const localClient = new spooled.QueueService(
//   'localhost:50051',
//   grpc.credentials.createInsecure()
// );

// Create metadata with API key
function createMetadata(apiKey: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.add('x-api-key', apiKey);
  return metadata;
}

const metadata = createMetadata('sk_live_your_api_key');
```

## Enqueue Jobs

```typescript
// Single job
queueClient.Enqueue(
  {
    queueName: 'emails',
    payload: JSON.stringify({ to: 'user@example.com', subject: 'Hello' }),
    priority: 5,
    maxRetries: 3,
  },
  metadata,
  (error, response) => {
    if (error) {
      console.error('Enqueue failed:', error);
      return;
    }
    console.log('Job ID:', response.jobId);
    console.log('Created:', response.created);
  }
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
  queueName: 'emails',
  payload: JSON.stringify({ to: 'user@example.com' }),
});
```

## Dequeue Jobs (Batch)

```typescript
queueClient.Dequeue(
  {
    queueName: 'emails',
    workerId: 'worker-1',
    limit: 10,
    leaseDurationSecs: 300,
  },
  metadata,
  (error, response) => {
    if (error) {
      console.error('Dequeue failed:', error);
      return;
    }

    for (const job of response.jobs) {
      console.log(`Job ${job.id}:`, JSON.parse(job.payload));
      processJob(job);
    }
  }
);
```

## Streaming Jobs (Server-Side Streaming)

The most powerful feature: receive jobs as a continuous stream.

```typescript
const stream = queueClient.StreamJobs(
  {
    queueName: 'emails',
    workerId: 'worker-1',
    leaseDurationSecs: 300,
  },
  metadata
);

stream.on('data', (job) => {
  console.log(`Received job: ${job.id}`);
  const payload = JSON.parse(job.payload);

  processJob(job.id, payload)
    .then(() => completeJob(job.id))
    .catch((error) => failJob(job.id, error.message));
});

stream.on('error', (error) => {
  console.error('Stream error:', error);
});

stream.on('end', () => {
  console.log('Stream ended');
});

// Cancel stream when done
// stream.cancel();
```

## Bidirectional Streaming (ProcessJobs)

Full duplex streaming for the highest performance:

```typescript
const call = workerClient.ProcessJobs(metadata);

// Handle incoming jobs from server
call.on('data', (response) => {
  if (response.job) {
    console.log(`Received job: ${response.job.id}`);

    processJobAsync(response.job).then((result) => {
      // Send completion back to server
      call.write({
        complete: {
          jobId: response.job.id,
          result: JSON.stringify(result),
        },
      });
    }).catch((error) => {
      // Send failure back to server
      call.write({
        fail: {
          jobId: response.job.id,
          error: error.message,
        },
      });
    });
  }

  if (response.heartbeatAck) {
    console.log('Heartbeat acknowledged');
  }
});

// Request jobs
call.write({
  subscribe: {
    queueName: 'emails',
    workerId: 'worker-1',
    leaseDurationSecs: 300,
    maxConcurrent: 10,
  },
});

// Send periodic heartbeats
setInterval(() => {
  call.write({
    heartbeat: {
      workerId: 'worker-1',
    },
  });
}, 10000);

// Handle stream events
call.on('error', (error) => {
  console.error('Stream error:', error);
});

call.on('end', () => {
  console.log('Stream ended');
});
```

## Complete and Fail Jobs

```typescript
function completeJob(jobId: string, result?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.Complete(
      {
        jobId,
        result: result ? JSON.stringify(result) : undefined,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function failJob(jobId: string, errorMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.Fail(
      {
        jobId,
        error: errorMessage,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}
```

## Renew Lease

Keep jobs alive during long processing:

```typescript
function renewLease(jobId: string, durationSecs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    queueClient.RenewLease(
      {
        jobId,
        leaseDurationSecs: durationSecs,
      },
      metadata,
      (error, response) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

// Usage: Renew lease every 30 seconds during processing
async function processWithLeaseRenewal(job: any) {
  const renewalInterval = setInterval(() => {
    renewLease(job.id, 60).catch(console.error);
  }, 30000);

  try {
    await longRunningProcess(job);
    await completeJob(job.id);
  } finally {
    clearInterval(renewalInterval);
  }
}
```

## Queue Statistics

```typescript
queueClient.GetQueueStats(
  { queueName: 'emails' },
  metadata,
  (error, response) => {
    if (error) {
      console.error('GetQueueStats failed:', error);
      return;
    }

    console.log('Queue:', response.queueName);
    console.log('Pending:', response.pending);
    console.log('Processing:', response.processing);
    console.log('Completed:', response.completed);
    console.log('Failed:', response.failed);
  }
);
```

## Error Handling

gRPC errors have status codes:

```typescript
import { status } from '@grpc/grpc-js';

stream.on('error', (error: any) => {
  switch (error.code) {
    case status.UNAUTHENTICATED:
      console.error('Invalid API key');
      break;
    case status.PERMISSION_DENIED:
      console.error('Access denied');
      break;
    case status.UNAVAILABLE:
      console.error('Service unavailable, retrying...');
      reconnect();
      break;
    case status.DEADLINE_EXCEEDED:
      console.error('Request timed out');
      break;
    default:
      console.error('gRPC error:', error.message);
  }
});
```

## Connection Management

### Keepalive Settings

```typescript
const channelOptions = {
  'grpc.keepalive_time_ms': 30000,           // Send keepalive every 30s
  'grpc.keepalive_timeout_ms': 10000,        // Wait 10s for keepalive ack
  'grpc.keepalive_permit_without_calls': 1,  // Allow keepalive without active calls
  'grpc.http2.min_time_between_pings_ms': 10000,
};

const queueClient = new spooled.QueueService(
  'grpc.spooled.cloud:443',
  grpc.credentials.createSsl(),
  channelOptions
);
```

### Connection Retry

```typescript
function createClientWithRetry(maxRetries = 5) {
  let retries = 0;

  function connect() {
    const client = new spooled.QueueService(
      'grpc.spooled.cloud:443',
      grpc.credentials.createSsl()
    );

    // Check connection health
    client.waitForReady(Date.now() + 5000, (error) => {
      if (error) {
        if (retries < maxRetries) {
          retries++;
          console.log(`Connection failed, retry ${retries}/${maxRetries}`);
          setTimeout(connect, 1000 * retries);
        } else {
          console.error('Max retries exceeded');
        }
      } else {
        retries = 0;
        console.log('Connected to gRPC server');
      }
    });

    return client;
  }

  return connect();
}
```

## Full Streaming Worker Example

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

async function main() {
  // Load proto
  const packageDefinition = protoLoader.loadSync('spooled.proto', {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const spooled = grpc.loadPackageDefinition(packageDefinition).spooled.v1 as any;

  // Create client
  const client = new spooled.QueueService(
    'grpc.spooled.cloud:443',
    grpc.credentials.createSsl()
  );

  const metadata = new grpc.Metadata();
  metadata.add('x-api-key', process.env.SPOOLED_API_KEY!);

  // Start streaming
  const stream = client.StreamJobs(
    {
      queueName: 'emails',
      workerId: `worker-${process.pid}`,
      leaseDurationSecs: 300,
    },
    metadata
  );

  const activeJobs = new Map<string, NodeJS.Timeout>();

  stream.on('data', async (job: any) => {
    console.log(`Received job: ${job.id}`);

    // Start lease renewal
    const renewalTimer = setInterval(() => {
      client.RenewLease(
        { jobId: job.id, leaseDurationSecs: 300 },
        metadata,
        () => {}
      );
    }, 60000);
    activeJobs.set(job.id, renewalTimer);

    try {
      const payload = JSON.parse(job.payload);
      const result = await processEmail(payload);

      client.Complete(
        { jobId: job.id, result: JSON.stringify(result) },
        metadata,
        (err) => {
          if (err) console.error(`Complete failed for ${job.id}:`, err);
          else console.log(`Completed: ${job.id}`);
        }
      );
    } catch (error: any) {
      client.Fail(
        { jobId: job.id, error: error.message },
        metadata,
        (err) => {
          if (err) console.error(`Fail failed for ${job.id}:`, err);
          else console.log(`Failed: ${job.id}`);
        }
      );
    } finally {
      clearInterval(activeJobs.get(job.id));
      activeJobs.delete(job.id);
    }
  });

  stream.on('error', (error) => {
    console.error('Stream error:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    stream.cancel();
    activeJobs.forEach((timer) => clearInterval(timer));
    client.close();
  });
}

async function processEmail(payload: any) {
  // Your email sending logic
  console.log('Sending email to:', payload.to);
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
  'grpc.your-company.com:443',
  grpc.credentials.createSsl()
);

// Self-hosted without TLS (development only)
const devClient = new spooled.QueueService(
  'localhost:50051',
  grpc.credentials.createInsecure()
);

// With custom root certificate
const fs = require('fs');
const rootCert = fs.readFileSync('/path/to/ca.pem');
const credentials = grpc.credentials.createSsl(rootCert);
const customTlsClient = new spooled.QueueService(
  'grpc.your-company.com:443',
  credentials
);
```

### Environment-Based Configuration

```typescript
const grpcAddress = process.env.SPOOLED_GRPC_ADDRESS || 'grpc.spooled.cloud:443';
const useTls = !grpcAddress.startsWith('localhost');

const client = new spooled.QueueService(
  grpcAddress,
  useTls ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
);
```

### gRPC TLS with Cloudflare Tunnel

If you're using Cloudflare Tunnel to expose your self-hosted gRPC server, there are two options:

#### Option A: Optimized (Recommended) - Disable Internal TLS

For best performance (~100ms latency savings), disable internal TLS and let Cloudflare handle encryption:

1. **Disable TLS on the backend**:
   ```yaml
   environment:
     GRPC_TLS_ENABLED: "false"
   ```

2. **Configure Cloudflare Tunnel**:
   - Service Type: `HTTP` (note: HTTP, not HTTPS)
   - URL: `backend:50051`
   - HTTP2 connection: `ON`

3. **Connect with TLS from SDK** (Cloudflare provides the TLS):
   ```typescript
   const client = new spooled.QueueService(
     'grpc.your-domain.com:443',
     grpc.credentials.createSsl()
   );
   ```

#### Option B: Legacy - Internal TLS

If you need end-to-end encryption within your network:

1. **Enable TLS on the backend** (default in `docker-compose.prod.yml`):
   ```yaml
   environment:
     GRPC_TLS_ENABLED: "true"
   ```

2. **Configure Cloudflare Tunnel**:
   - Service Type: `HTTPS`
   - URL: `backend:50051`
   - HTTP2 connection: `ON`
   - No TLS Verify: `ON` (accepts self-signed certs)

The backend includes self-signed certificates in `./certs/` that work with Cloudflare Tunnel's "No TLS Verify" option.

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
  'localhost:50051',
  grpc.credentials.createInsecure()
);
```

## Proto File Reference

The full proto file is available at:
- SDK: `node_modules/@spooled/sdk/proto/spooled.proto`
- GitHub: [spooled-backend/proto/spooled.proto](https://github.com/Spooled-Cloud/spooled-backend/blob/main/proto/spooled.proto)

Key services:
- `QueueService`: Enqueue, Dequeue, StreamJobs, Complete, Fail, RenewLease
- `WorkerService`: ProcessJobs (bidirectional streaming)
