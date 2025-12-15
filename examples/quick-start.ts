/**
 * Quick Start Example
 *
 * This example demonstrates the basic usage of the Spooled SDK.
 *
 * Run with: npx ts-node examples/quick-start.ts
 */

import { SpooledClient } from '../src/index.js';

async function main() {
  // Create a client with your API key
  const client = new SpooledClient({
    apiKey: process.env.SPOOLED_API_KEY || 'sk_test_example',
    baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
  });

  console.log('=== Spooled SDK Quick Start ===\n');

  // 1. Create a job
  console.log('1. Creating a job...');
  const { id, created } = await client.jobs.create({
    queueName: 'email-notifications',
    payload: {
      to: 'user@example.com',
      subject: 'Welcome!',
      body: 'Thanks for signing up.',
    },
    priority: 5,
    maxRetries: 3,
  });
  console.log(`   Created job: ${id} (new: ${created})\n`);

  // 2. Get job details
  console.log('2. Fetching job details...');
  const job = await client.jobs.get(id);
  console.log(`   Status: ${job.status}`);
  console.log(`   Queue: ${job.queueName}`);
  console.log(`   Priority: ${job.priority}\n`);

  // 3. List jobs
  console.log('3. Listing recent jobs...');
  const jobs = await client.jobs.list({ limit: 5 });
  console.log(`   Found ${jobs.length} jobs:`);
  for (const j of jobs) {
    console.log(`   - ${j.id}: ${j.status} (queue: ${j.queueName})`);
  }
  console.log();

  // 4. Get job statistics
  console.log('4. Getting job statistics...');
  const stats = await client.jobs.getStats();
  console.log(`   Pending: ${stats.pending}`);
  console.log(`   Processing: ${stats.processing}`);
  console.log(`   Completed: ${stats.completed}`);
  console.log(`   Failed: ${stats.failed}\n`);

  // 5. List queues
  console.log('5. Listing queues...');
  const queues = await client.queues.list();
  console.log(`   Found ${queues.length} queues:`);
  for (const q of queues) {
    console.log(`   - ${q.queueName} (enabled: ${q.enabled})`);
  }
  console.log();

  console.log('=== Quick Start Complete ===');
}

main().catch(console.error);
