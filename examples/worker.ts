/**
 * Worker Example
 *
 * This example demonstrates how to process jobs with SpooledWorker.
 *
 * Run with: npx ts-node examples/worker.ts
 */

import { SpooledClient, SpooledWorker } from '../src/index.js';

async function main() {
  // Create a client
  const client = new SpooledClient({
    apiKey: process.env.SPOOLED_API_KEY || 'sk_test_example',
    baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
    debug: true,
  });

  console.log('=== Spooled Worker Example ===\n');

  // Create a worker
  const worker = new SpooledWorker(client, {
    queueName: 'email-notifications',
    concurrency: 5, // Process up to 5 jobs at a time
    pollInterval: 1000, // Poll every second
    leaseDuration: 30, // 30 second lease
  });

  // Set up event handlers
  worker.on('started', ({ workerId, queueName }) => {
    console.log(`Worker ${workerId} started processing queue: ${queueName}`);
  });

  worker.on('job:claimed', ({ jobId }) => {
    console.log(`Claimed job: ${jobId}`);
  });

  worker.on('job:completed', ({ jobId, result }) => {
    console.log(`Completed job: ${jobId}`, result);
  });

  worker.on('job:failed', ({ jobId, error, willRetry }) => {
    console.log(`Failed job: ${jobId}, error: ${error}, will retry: ${willRetry}`);
  });

  worker.on('stopped', ({ reason }) => {
    console.log(`Worker stopped: ${reason}`);
  });

  // Define job handler
  worker.process(async (ctx) => {
    console.log(`\nProcessing job ${ctx.jobId}...`);
    console.log(`Payload:`, ctx.payload);
    console.log(`Retry count: ${ctx.retryCount}/${ctx.maxRetries}`);

    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check for abort signal (graceful shutdown)
    if (ctx.signal.aborted) {
      throw new Error('Job aborted');
    }

    // Return result (optional)
    return {
      processed: true,
      timestamp: new Date().toISOString(),
    };
  });

  // Start the worker
  await worker.start();
  console.log('Worker is running. Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, stopping worker...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, stopping worker...');
    await worker.stop();
    process.exit(0);
  });
}

main().catch(console.error);
