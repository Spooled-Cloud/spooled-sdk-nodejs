# gRPC Guide

Spooled provides a high-performance gRPC API for scenarios requiring maximum throughput and streaming capabilities.

## When to Use gRPC

| Use Case | Recommended API |
|----------|-----------------|
| Web/mobile apps | REST |
| Dashboard/admin interfaces | REST |
| High-throughput workers | gRPC |
| Streaming job delivery | gRPC |
| Low-latency operations | gRPC |

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
const queueClient = new spooled.QueueService(
  'grpc.spooled.cloud:443',
  grpc.credentials.createSsl()
);

const workerClient = new spooled.WorkerService(
  'grpc.spooled.cloud:443',
  grpc.credentials.createSsl()
);

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

## Proto File Reference

The full proto file is available at:
- SDK: `node_modules/@spooled/sdk/proto/spooled.proto`
- GitHub: [spooled-backend/proto/spooled.proto](https://github.com/Spooled-Cloud/spooled-backend/blob/main/proto/spooled.proto)

Key services:
- `QueueService`: Enqueue, Dequeue, StreamJobs, Complete, Fail, RenewLease
- `WorkerService`: ProcessJobs (bidirectional streaming)

