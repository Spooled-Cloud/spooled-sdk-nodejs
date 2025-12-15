/**
 * Schedules Example
 *
 * This example demonstrates how to work with cron schedules.
 *
 * Run with: npx ts-node examples/schedules.ts
 */

import { SpooledClient } from '../src/index.js';

async function main() {
  const client = new SpooledClient({
    apiKey: process.env.SPOOLED_API_KEY || 'sk_test_example',
    baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
  });

  console.log('=== Spooled Schedules Example ===\n');

  // 1. Create a schedule
  console.log('1. Creating a schedule...');
  const schedule = await client.schedules.create({
    name: 'Daily Report',
    description: 'Generate daily usage report',
    cronExpression: '0 0 9 * * *', // Every day at 9:00 AM
    timezone: 'America/New_York',
    queueName: 'reports',
    payloadTemplate: {
      type: 'daily',
      format: 'pdf',
    },
    priority: 10,
    maxRetries: 2,
    tags: { team: 'analytics' },
  });
  console.log(`   Created schedule: ${schedule.id}`);
  console.log(`   Next run: ${schedule.nextRunAt}\n`);

  // 2. List schedules
  console.log('2. Listing schedules...');
  const schedules = await client.schedules.list();
  console.log(`   Found ${schedules.length} schedules:`);
  for (const s of schedules) {
    console.log(`   - ${s.name}: ${s.cronExpression} (active: ${s.isActive})`);
  }
  console.log();

  // 3. Get schedule details
  console.log('3. Getting schedule details...');
  const details = await client.schedules.get(schedule.id);
  console.log(`   Name: ${details.name}`);
  console.log(`   Cron: ${details.cronExpression}`);
  console.log(`   Queue: ${details.queueName}`);
  console.log(`   Run count: ${details.runCount}\n`);

  // 4. Update schedule
  console.log('4. Updating schedule...');
  const updated = await client.schedules.update(schedule.id, {
    description: 'Generate and email daily usage report',
    cronExpression: '0 0 8 * * *', // Change to 8:00 AM
  });
  console.log(`   Updated next run: ${updated.nextRunAt}\n`);

  // 5. Pause and resume
  console.log('5. Pausing schedule...');
  const paused = await client.schedules.pause(schedule.id);
  console.log(`   Active: ${paused.isActive}`);

  console.log('   Resuming schedule...');
  const resumed = await client.schedules.resume(schedule.id);
  console.log(`   Active: ${resumed.isActive}\n`);

  // 6. Manual trigger
  console.log('6. Manually triggering schedule...');
  const triggered = await client.schedules.trigger(schedule.id);
  console.log(`   Created job: ${triggered.jobId}\n`);

  // 7. Get execution history
  console.log('7. Getting execution history...');
  const history = await client.schedules.getHistory(schedule.id, 5);
  console.log(`   Last ${history.length} runs:`);
  for (const run of history) {
    console.log(`   - ${run.status}: ${run.startedAt}`);
  }
  console.log();

  // 8. Clean up
  console.log('8. Deleting schedule...');
  await client.schedules.delete(schedule.id);
  console.log('   Deleted!\n');

  console.log('=== Schedules Example Complete ===');
}

main().catch(console.error);
