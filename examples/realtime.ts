/**
 * Realtime Example
 *
 * This example demonstrates how to use realtime event streaming.
 *
 * Run with: npx ts-node examples/realtime.ts
 */

import { SpooledClient } from '../src/index.js';

async function main() {
  // Create a client
  const client = new SpooledClient({
    apiKey: process.env.SPOOLED_API_KEY || 'sk_test_example',
    baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
    debug: true,
  });

  console.log('=== Spooled Realtime Example ===\n');

  // Create realtime connection
  const realtime = await client.realtime();

  // Listen for connection state changes
  realtime.onStateChange((state) => {
    console.log(`Connection state: ${state}`);
  });

  // Listen for all events
  realtime.onEvent((event) => {
    console.log(`Event: ${event.type}`, event);
  });

  // Listen for specific events
  realtime.on('job.created', (data) => {
    console.log(`\n📬 New job created: ${data.jobId}`);
    console.log(`   Queue: ${data.queueName}`);
    console.log(`   Priority: ${data.priority}`);
  });

  realtime.on('job.completed', (data) => {
    console.log(`\n✅ Job completed: ${data.jobId}`);
    console.log(`   Duration: ${data.durationMs}ms`);
  });

  realtime.on('job.failed', (data) => {
    console.log(`\n❌ Job failed: ${data.jobId}`);
    console.log(`   Error: ${data.error}`);
    console.log(`   Will retry: ${data.willRetry}`);
  });

  realtime.on('queue.paused', (data) => {
    console.log(`\n⏸️  Queue paused: ${data.queueName}`);
  });

  realtime.on('queue.resumed', (data) => {
    console.log(`\n▶️  Queue resumed: ${data.queueName}`);
  });

  // Connect to the server
  console.log('Connecting to realtime server...');
  await realtime.connect();
  console.log('Connected!\n');

  // Subscribe to events from a specific queue
  console.log('Subscribing to email-notifications queue...');
  await realtime.subscribe({ queueName: 'email-notifications' });
  console.log('Subscribed!\n');

  console.log('Listening for events. Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nDisconnecting...');
    realtime.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
