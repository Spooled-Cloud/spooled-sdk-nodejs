/**
 * gRPC Streaming Example
 *
 * This example demonstrates high-performance job processing using gRPC streaming.
 * Use this approach for maximum throughput in worker scenarios.
 *
 * It uses the SDK's `SpooledGrpcClient`, which loads the bundled proto,
 * converts payloads and results to and from `google.protobuf.Struct`, and maps
 * gRPC errors to the SDK's error classes.
 *
 * Run with: npx tsx examples/grpc-streaming.ts [enqueue|batch|stream|stats|dequeue|demo]
 */

import { SpooledGrpcClient } from "../src/index.js";
import type { GrpcJob } from "../src/index.js";

// Configuration
const API_KEY = process.env.SPOOLED_API_KEY || "sp_test_example";
const GRPC_ADDRESS =
  process.env.SPOOLED_GRPC_ADDRESS || "grpc.spooled.cloud:443";
const QUEUE_NAME = process.env.SPOOLED_QUEUE || "grpc-demo";
// A stable worker id: re-registering after a restart updates the same worker
// instead of adding one that counts against the plan's worker limit.
const WORKER_ID = process.env.SPOOLED_WORKER_ID || `${QUEUE_NAME}-worker-1`;

// ============================================
// Example 1: Simple Enqueue via gRPC
// ============================================
async function enqueueExample(client: SpooledGrpcClient) {
  console.log("=== gRPC Enqueue Example ===\n");

  // payload must be a JSON object: it travels as google.protobuf.Struct
  const response = await client.queue.enqueue({
    queueName: QUEUE_NAME,
    payload: { message: "Hello from gRPC!", timestamp: Date.now() },
    priority: 5,
    maxRetries: 3,
  });

  console.log("Job enqueued successfully!");
  console.log(`  Job ID: ${response.jobId}`);
  console.log(`  Created: ${response.created}`);
  console.log();
}

// ============================================
// Example 2: Batch Enqueue
// ============================================
async function batchEnqueueExample(client: SpooledGrpcClient) {
  console.log("=== gRPC Batch Enqueue Example ===\n");

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      client.queue.enqueue({
        queueName: QUEUE_NAME,
        payload: { index: i, data: `batch-item-${i}` },
        priority: i % 3, // Vary priority
      }),
    ),
  );

  console.log(`Enqueued ${results.length} jobs:`);
  results.forEach((r, i) => console.log(`  ${i}: ${r.jobId}`));
  console.log();
}

// ============================================
// Example 3: Server-Side Streaming (StreamJobs)
// ============================================
async function streamJobsExample(client: SpooledGrpcClient) {
  console.log("=== gRPC StreamJobs Example ===\n");
  console.log("Listening for jobs (press Ctrl+C to stop)...\n");

  const { workerId } = await client.workers.register({
    queueName: QUEUE_NAME,
    hostname: `example-${process.pid}`,
    workerId: WORKER_ID,
  });

  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    controller.abort();
  });

  // One stream delivers one job at a time: the next job comes after this one
  // is completed or failed. Open more streams to run jobs in parallel.
  const stream = client.queue.streamJobs(
    { queueName: QUEUE_NAME, workerId, leaseDurationSecs: 300 },
    { signal: controller.signal },
  );

  try {
    for await (const job of stream) {
      console.log(`[${new Date().toISOString()}] Received job: ${job.id}`);
      await processJob(client, workerId, job);
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    await client.workers.deregister(workerId).catch(() => {});
  }
}

/** Process one job, renewing its lease while it runs, and settle it. */
async function processJob(
  client: SpooledGrpcClient,
  workerId: string,
  job: GrpcJob,
) {
  // complete/fail/renewLease all require the lease token from the job
  const leaseId = job.leaseId as string;
  const renewal = setInterval(() => {
    client.queue
      .renewLease({ jobId: job.id, workerId, leaseId, extensionSecs: 300 })
      .catch((err: Error) =>
        console.error(`Lease renewal failed for ${job.id}:`, err.message),
      );
  }, 60000);

  try {
    console.log(`  Payload:`, job.payload);

    // Simulate processing time
    await sleep(Math.random() * 2000 + 500);

    await client.queue.complete({
      jobId: job.id,
      workerId,
      leaseId,
      result: { processed: true, timestamp: Date.now() },
    });
    console.log(`  Completed: ${job.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // retry defaults to true (retried until maxRetries run out);
    // retry: false would dead-letter the job now.
    await client.queue
      .fail({ jobId: job.id, workerId, leaseId, error: message })
      .catch((err: Error) => console.error(`  Fail failed: ${err.message}`));
    console.log(`  Failed: ${job.id} - ${message}`);
  } finally {
    clearInterval(renewal);
  }
}

// ============================================
// Example 4: Queue Statistics
// ============================================
async function queueStatsExample(client: SpooledGrpcClient) {
  console.log("=== gRPC Queue Stats Example ===\n");

  const response = await client.queue.getQueueStats(QUEUE_NAME);
  console.log(`Queue: ${response.queueName}`);
  console.log(`  Pending: ${response.pending}`);
  console.log(`  Processing: ${response.processing}`);
  console.log(`  Completed: ${response.completed}`);
  console.log(`  Failed: ${response.failed}`);
  console.log();
}

// ============================================
// Example 5: Dequeue Batch (Poll-based)
// ============================================
async function dequeueBatchExample(client: SpooledGrpcClient) {
  console.log("=== gRPC Dequeue Batch Example ===\n");

  const { workerId } = await client.workers.register({
    queueName: QUEUE_NAME,
    hostname: `example-${process.pid}`,
    workerId: WORKER_ID,
  });

  try {
    const { jobs } = await client.queue.dequeue({
      queueName: QUEUE_NAME,
      workerId,
      batchSize: 5,
      leaseDurationSecs: 300,
    });
    console.log(`Dequeued ${jobs.length} jobs:`);

    for (const job of jobs) {
      console.log(`  Processing ${job.id}...`);
      console.log(`    Payload:`, job.payload);
      await client.queue.complete({
        jobId: job.id,
        workerId,
        leaseId: job.leaseId as string,
        result: { ok: true },
      });
      console.log(`    Completed!`);
    }
    console.log();
  } finally {
    await client.workers.deregister(workerId).catch(() => {});
  }
}

// ============================================
// Main
// ============================================
async function main() {
  console.log(`Connecting to ${GRPC_ADDRESS}...`);

  // TLS is used automatically except for localhost addresses.
  const client = new SpooledGrpcClient({
    address: GRPC_ADDRESS,
    apiKey: API_KEY,
  });
  await client.waitForReady(new Date(Date.now() + 10000));

  console.log("Connected!\n");

  // Parse command line args
  const command = process.argv[2] || "demo";

  try {
    switch (command) {
      case "enqueue":
        await enqueueExample(client);
        break;

      case "batch":
        await batchEnqueueExample(client);
        break;

      case "stream":
        await streamJobsExample(client);
        break;

      case "stats":
        await queueStatsExample(client);
        break;

      case "dequeue":
        await dequeueBatchExample(client);
        break;

      case "demo":
      default:
        // Run a quick demo of all features
        await enqueueExample(client);
        await batchEnqueueExample(client);
        await queueStatsExample(client);
        console.log(
          'Demo complete! Run with "stream" argument for streaming example.',
        );
        break;
    }
  } finally {
    client.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
