/**
 * Workflow DAG Example
 *
 * This example demonstrates building complex workflows with job dependencies.
 * It shows a data pipeline (ETL) pattern with fan-out and fan-in.
 *
 * Run with: npx ts-node examples/workflow-dag.ts
 */

import { SpooledClient, SpooledWorker } from '../src/index.js';

// Configuration
const API_KEY = process.env.SPOOLED_API_KEY || 'sk_test_example';
const BASE_URL = process.env.SPOOLED_API_URL || 'https://api.spooled.cloud';

async function main() {
  const client = new SpooledClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  console.log('=== Workflow DAG Example ===\n');

  // ============================================
  // Example 1: Simple Linear Pipeline (ETL)
  // ============================================
  console.log('1. Creating Simple ETL Pipeline...\n');

  const etlWorkflow = await client.workflows.create({
    name: 'ETL Pipeline',
    jobs: [
      {
        key: 'extract',
        queueName: 'etl',
        payload: {
          step: 'extract',
          source: 's3://data-bucket/input.csv',
        },
      },
      {
        key: 'transform',
        queueName: 'etl',
        payload: {
          step: 'transform',
          operations: ['clean', 'normalize', 'validate'],
        },
        dependsOn: ['extract'],
      },
      {
        key: 'load',
        queueName: 'etl',
        payload: {
          step: 'load',
          destination: 'postgres://db/analytics',
        },
        dependsOn: ['transform'],
      },
    ],
  });

  console.log(`   Workflow ID: ${etlWorkflow.workflowId}`);
  console.log('   Job Mappings:');
  for (const [key, jobId] of Object.entries(etlWorkflow.jobMappings)) {
    console.log(`     ${key}: ${jobId}`);
  }
  console.log();

  // ============================================
  // Example 2: Fan-Out Pattern (Parallel Processing)
  // ============================================
  console.log('2. Creating Fan-Out Workflow...\n');

  const fanOutWorkflow = await client.workflows.create({
    name: 'Parallel Image Processing',
    jobs: [
      {
        key: 'download',
        queueName: 'io',
        payload: {
          step: 'download',
          imageUrl: 'https://example.com/image.jpg',
        },
      },
      // These three jobs run in parallel after download completes
      {
        key: 'resize-small',
        queueName: 'cpu',
        payload: { step: 'resize', size: '100x100' },
        dependsOn: ['download'],
      },
      {
        key: 'resize-medium',
        queueName: 'cpu',
        payload: { step: 'resize', size: '500x500' },
        dependsOn: ['download'],
      },
      {
        key: 'resize-large',
        queueName: 'cpu',
        payload: { step: 'resize', size: '1000x1000' },
        dependsOn: ['download'],
      },
    ],
  });

  console.log(`   Workflow ID: ${fanOutWorkflow.workflowId}`);
  console.log('   Structure: download -> [resize-small, resize-medium, resize-large]');
  console.log();

  // ============================================
  // Example 3: Fan-In Pattern (Aggregation)
  // ============================================
  console.log('3. Creating Fan-In Workflow (Map-Reduce)...\n');

  const mapReduceWorkflow = await client.workflows.create({
    name: 'Map-Reduce Word Count',
    jobs: [
      // Map phase (parallel)
      {
        key: 'map-partition-1',
        queueName: 'workers',
        payload: { step: 'map', partition: 1, data: 'chunk1.txt' },
      },
      {
        key: 'map-partition-2',
        queueName: 'workers',
        payload: { step: 'map', partition: 2, data: 'chunk2.txt' },
      },
      {
        key: 'map-partition-3',
        queueName: 'workers',
        payload: { step: 'map', partition: 3, data: 'chunk3.txt' },
      },
      // Reduce phase (waits for all map jobs)
      {
        key: 'reduce',
        queueName: 'workers',
        payload: { step: 'reduce', operation: 'sum' },
        dependsOn: ['map-partition-1', 'map-partition-2', 'map-partition-3'],
      },
    ],
  });

  console.log(`   Workflow ID: ${mapReduceWorkflow.workflowId}`);
  console.log('   Structure: [map-1, map-2, map-3] -> reduce');
  console.log();

  // ============================================
  // Example 4: Complex Diamond Pattern
  // ============================================
  console.log('4. Creating Diamond Workflow...\n');

  const diamondWorkflow = await client.workflows.create({
    name: 'CI/CD Pipeline',
    jobs: [
      { key: 'checkout', queueName: 'ci', payload: { step: 'checkout', repo: 'github.com/...' } },
      { key: 'install', queueName: 'ci', payload: { step: 'install' }, dependsOn: ['checkout'] },
      { key: 'build', queueName: 'ci', payload: { step: 'build' }, dependsOn: ['install'] },

      // Parallel test phase
      { key: 'unit-tests', queueName: 'ci', payload: { step: 'test', type: 'unit' }, dependsOn: ['build'] },
      { key: 'integration-tests', queueName: 'ci', payload: { step: 'test', type: 'integration' }, dependsOn: ['build'] },
      { key: 'e2e-tests', queueName: 'ci', payload: { step: 'test', type: 'e2e' }, dependsOn: ['build'] },

      // Deploy after all tests pass
      {
        key: 'deploy',
        queueName: 'cd',
        payload: { step: 'deploy', env: 'production' },
        dependsOn: ['unit-tests', 'integration-tests', 'e2e-tests'],
      },

      // Notify after deploy
      { key: 'notify', queueName: 'notifications', payload: { step: 'notify', channel: 'slack' }, dependsOn: ['deploy'] },
    ],
  });

  console.log(`   Workflow ID: ${diamondWorkflow.workflowId}`);
  console.log('   Structure:');
  console.log('     checkout -> install -> build');
  console.log('                              |');
  console.log('              [unit, integration, e2e] (parallel)');
  console.log('                              |');
  console.log('                           deploy');
  console.log('                              |');
  console.log('                           notify');
  console.log();

  // ============================================
  // Example 5: Dynamic Workflow Building
  // ============================================
  console.log('5. Creating Dynamic Batch Workflow...\n');

  const items = ['item-a', 'item-b', 'item-c', 'item-d', 'item-e'];
  const batchWorkflow = await createBatchWorkflow(client, items);

  console.log(`   Workflow ID: ${batchWorkflow.workflowId}`);
  console.log(`   Processing ${items.length} items in parallel with final aggregation`);
  console.log();

  // ============================================
  // Monitor Workflows
  // ============================================
  console.log('6. Checking Workflow Status...\n');

  const status = await client.workflows.get(etlWorkflow.workflowId);
  console.log(`   ETL Workflow Status: ${status.status}`);
  console.log('   Jobs:');
  for (const job of status.jobs || []) {
    console.log(`     - ${job.key}: ${job.status}`);
  }
  console.log();

  console.log('=== Workflow DAG Example Complete ===');
}

/**
 * Helper function to create a dynamic batch processing workflow
 */
async function createBatchWorkflow(client: SpooledClient, items: string[]) {
  const jobs: Array<{
    key: string;
    queueName: string;
    payload: Record<string, unknown>;
    dependsOn?: string[];
  }> = [];

  // Create parallel processing jobs for each item
  for (let i = 0; i < items.length; i++) {
    jobs.push({
      key: `process-${i}`,
      queueName: 'batch',
      payload: {
        step: 'process',
        item: items[i],
        index: i,
      },
    });
  }

  // Add aggregation job that waits for all processing jobs
  jobs.push({
    key: 'aggregate',
    queueName: 'batch',
    payload: {
      step: 'aggregate',
      totalItems: items.length,
    },
    dependsOn: items.map((_, i) => `process-${i}`),
  });

  return client.workflows.create({
    name: `Batch Processing ${items.length} items`,
    jobs,
  });
}

// ============================================
// Example Worker for Processing Workflow Jobs
// ============================================
async function runWorker() {
  const client = new SpooledClient({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
  });

  const worker = new SpooledWorker(client, {
    queueName: 'etl',
    concurrency: 5,
  });

  worker.process(async (ctx) => {
    const { step } = ctx.payload as { step: string };

    console.log(`[Worker] Processing ${step} job: ${ctx.jobId}`);

    switch (step) {
      case 'extract':
        // Simulate data extraction
        await sleep(1000);
        return { rowsExtracted: 10000, source: ctx.payload.source };

      case 'transform':
        // Simulate data transformation
        await sleep(2000);
        return { rowsTransformed: 9500, operations: ctx.payload.operations };

      case 'load':
        // Simulate data loading
        await sleep(1500);
        return { rowsLoaded: 9500, destination: ctx.payload.destination };

      default:
        throw new Error(`Unknown step: ${step}`);
    }
  });

  worker.on('job:completed', ({ jobId, result }) => {
    console.log(`[Worker] Completed ${jobId}:`, result);
  });

  worker.on('job:failed', ({ jobId, error }) => {
    console.error(`[Worker] Failed ${jobId}:`, error);
  });

  console.log('[Worker] Starting ETL worker...');
  await worker.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Worker] Shutting down...');
    await worker.stop();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the main example
// To run the worker instead, call: runWorker().catch(console.error);
main().catch(console.error);


