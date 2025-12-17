/**
 * gRPC Streaming Example
 *
 * This example demonstrates high-performance job processing using gRPC streaming.
 * Use this approach for maximum throughput in worker scenarios.
 *
 * Prerequisites:
 *   npm install @grpc/grpc-js @grpc/proto-loader
 *
 * Run with: npx ts-node examples/grpc-streaming.ts
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Configuration
const API_KEY = process.env.SPOOLED_API_KEY || 'sk_test_example';
const GRPC_ADDRESS = process.env.SPOOLED_GRPC_ADDRESS || 'grpc.spooled.cloud:443';
const QUEUE_NAME = process.env.SPOOLED_QUEUE || 'grpc-demo';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find proto file (in SDK package or local)
const PROTO_PATH = join(__dirname, '../proto/spooled.proto');

// Proto loader options
const PROTO_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

interface GrpcClients {
  QueueService: any;
  WorkerService: any;
}

async function loadProto(): Promise<GrpcClients> {
  const packageDefinition = await protoLoader.load(PROTO_PATH, PROTO_OPTIONS);
  const spooled = grpc.loadPackageDefinition(packageDefinition).spooled as any;
  return spooled.v1;
}

function createMetadata(apiKey: string): grpc.Metadata {
  const metadata = new grpc.Metadata();
  metadata.add('x-api-key', apiKey);
  return metadata;
}

// ============================================
// Example 1: Simple Enqueue via gRPC
// ============================================
async function enqueueExample(client: any, metadata: grpc.Metadata) {
  console.log('=== gRPC Enqueue Example ===\n');

  return new Promise<void>((resolve, reject) => {
    client.Enqueue(
      {
        queueName: QUEUE_NAME,
        payload: JSON.stringify({
          message: 'Hello from gRPC!',
          timestamp: Date.now(),
        }),
        priority: 5,
        maxRetries: 3,
      },
      metadata,
      (error: Error | null, response: any) => {
        if (error) {
          console.error('Enqueue failed:', error.message);
          reject(error);
          return;
        }
        console.log('Job enqueued successfully!');
        console.log(`  Job ID: ${response.jobId}`);
        console.log(`  Created: ${response.created}`);
        console.log();
        resolve();
      }
    );
  });
}

// ============================================
// Example 2: Batch Enqueue
// ============================================
async function batchEnqueueExample(client: any, metadata: grpc.Metadata) {
  console.log('=== gRPC Batch Enqueue Example ===\n');

  const jobs = Array.from({ length: 10 }, (_, i) => ({
    queueName: QUEUE_NAME,
    payload: JSON.stringify({ index: i, data: `batch-item-${i}` }),
    priority: i % 3, // Vary priority
  }));

  // Enqueue all jobs in parallel
  const results = await Promise.all(
    jobs.map(
      (job) =>
        new Promise<string>((resolve, reject) => {
          client.Enqueue(job, metadata, (error: Error | null, response: any) => {
            if (error) reject(error);
            else resolve(response.jobId);
          });
        })
    )
  );

  console.log(`Enqueued ${results.length} jobs:`);
  results.forEach((id, i) => console.log(`  ${i}: ${id}`));
  console.log();
}

// ============================================
// Example 3: Server-Side Streaming (StreamJobs)
// ============================================
async function streamJobsExample(client: any, metadata: grpc.Metadata) {
  console.log('=== gRPC StreamJobs Example ===\n');
  console.log('Listening for jobs (press Ctrl+C to stop)...\n');

  const workerId = `worker-${process.pid}-${Date.now()}`;

  const stream = client.StreamJobs(
    {
      queueName: QUEUE_NAME,
      workerId,
      leaseDurationSecs: 300,
    },
    metadata
  );

  // Track active jobs for lease renewal
  const activeJobs = new Map<string, NodeJS.Timeout>();

  stream.on('data', async (job: any) => {
    console.log(`[${new Date().toISOString()}] Received job: ${job.id}`);

    // Start lease renewal timer
    const renewalTimer = setInterval(() => {
      client.RenewLease(
        { jobId: job.id, leaseDurationSecs: 300 },
        metadata,
        (err: Error | null) => {
          if (err) console.error(`Lease renewal failed for ${job.id}:`, err.message);
        }
      );
    }, 60000); // Renew every 60 seconds
    activeJobs.set(job.id, renewalTimer);

    try {
      // Parse and process the job
      const payload = JSON.parse(job.payload);
      console.log(`  Payload:`, payload);

      // Simulate processing time
      await sleep(Math.random() * 2000 + 500);

      // Complete the job
      client.Complete(
        {
          jobId: job.id,
          result: JSON.stringify({ processed: true, timestamp: Date.now() }),
        },
        metadata,
        (err: Error | null) => {
          if (err) {
            console.error(`  Complete failed: ${err.message}`);
          } else {
            console.log(`  Completed: ${job.id}`);
          }
        }
      );
    } catch (error: any) {
      // Fail the job
      client.Fail(
        { jobId: job.id, error: error.message },
        metadata,
        (err: Error | null) => {
          if (err) {
            console.error(`  Fail failed: ${err.message}`);
          } else {
            console.log(`  Failed: ${job.id} - ${error.message}`);
          }
        }
      );
    } finally {
      // Clean up renewal timer
      clearInterval(activeJobs.get(job.id));
      activeJobs.delete(job.id);
    }
  });

  stream.on('error', (error: Error) => {
    console.error('Stream error:', error.message);
  });

  stream.on('end', () => {
    console.log('Stream ended');
    activeJobs.forEach((timer) => clearInterval(timer));
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stream.cancel();
    activeJobs.forEach((timer) => clearInterval(timer));
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {}); // Never resolves
}

// ============================================
// Example 4: Queue Statistics
// ============================================
async function queueStatsExample(client: any, metadata: grpc.Metadata) {
  console.log('=== gRPC Queue Stats Example ===\n');

  return new Promise<void>((resolve, reject) => {
    client.GetQueueStats({ queueName: QUEUE_NAME }, metadata, (error: Error | null, response: any) => {
      if (error) {
        console.error('GetQueueStats failed:', error.message);
        reject(error);
        return;
      }

      console.log(`Queue: ${response.queueName}`);
      console.log(`  Pending: ${response.pending}`);
      console.log(`  Processing: ${response.processing}`);
      console.log(`  Completed: ${response.completed}`);
      console.log(`  Failed: ${response.failed}`);
      console.log();
      resolve();
    });
  });
}

// ============================================
// Example 5: Dequeue Batch (Poll-based)
// ============================================
async function dequeueBatchExample(client: any, metadata: grpc.Metadata) {
  console.log('=== gRPC Dequeue Batch Example ===\n');

  const workerId = `batch-worker-${process.pid}`;

  return new Promise<void>((resolve, reject) => {
    client.Dequeue(
      {
        queueName: QUEUE_NAME,
        workerId,
        limit: 5,
        leaseDurationSecs: 300,
      },
      metadata,
      async (error: Error | null, response: any) => {
        if (error) {
          console.error('Dequeue failed:', error.message);
          reject(error);
          return;
        }

        const jobs = response.jobs || [];
        console.log(`Dequeued ${jobs.length} jobs:`);

        for (const job of jobs) {
          console.log(`  Processing ${job.id}...`);

          try {
            const payload = JSON.parse(job.payload);
            console.log(`    Payload:`, payload);

            // Complete the job
            await new Promise<void>((res, rej) => {
              client.Complete(
                { jobId: job.id, result: JSON.stringify({ ok: true }) },
                metadata,
                (err: Error | null) => (err ? rej(err) : res())
              );
            });
            console.log(`    Completed!`);
          } catch (err: any) {
            console.error(`    Error: ${err.message}`);
          }
        }

        console.log();
        resolve();
      }
    );
  });
}

// ============================================
// Main
// ============================================
async function main() {
  console.log('Loading proto file...');
  const spooled = await loadProto();

  console.log(`Connecting to ${GRPC_ADDRESS}...`);

  // Create client with TLS (for production)
  // For local development without TLS, use grpc.credentials.createInsecure()
  const credentials = GRPC_ADDRESS.includes('localhost')
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();

  const client = new spooled.QueueService(GRPC_ADDRESS, credentials);
  const metadata = createMetadata(API_KEY);

  console.log('Connected!\n');

  // Parse command line args
  const command = process.argv[2] || 'demo';

  switch (command) {
    case 'enqueue':
      await enqueueExample(client, metadata);
      break;

    case 'batch':
      await batchEnqueueExample(client, metadata);
      break;

    case 'stream':
      await streamJobsExample(client, metadata);
      break;

    case 'stats':
      await queueStatsExample(client, metadata);
      break;

    case 'dequeue':
      await dequeueBatchExample(client, metadata);
      break;

    case 'demo':
    default:
      // Run a quick demo of all features
      await enqueueExample(client, metadata);
      await batchEnqueueExample(client, metadata);
      await queueStatsExample(client, metadata);
      console.log('Demo complete! Run with "stream" argument for streaming example.');
      break;
  }

  // Close client
  client.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
