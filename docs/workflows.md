# Workflows Guide

This guide covers building complex workflows with job dependencies (DAGs - Directed Acyclic Graphs).

## What are Workflows?

Workflows allow you to orchestrate multiple jobs with dependencies. Jobs only execute when their dependencies complete successfully.

```
         ┌─────────┐
         │ Extract │
         └────┬────┘
              │
         ┌────▼────┐
         │Transform│
         └────┬────┘
              │
         ┌────▼────┐
         │  Load   │
         └─────────┘
```

## Creating a Workflow

```typescript
import { SpooledClient } from '@spooled/sdk';

const client = new SpooledClient({ apiKey: 'sk_live_...' });

const workflow = await client.workflows.create({
  name: 'ETL Pipeline',
  jobs: [
    {
      key: 'extract',
      queueName: 'etl',
      payload: { source: 's3://bucket/data.csv' },
    },
    {
      key: 'transform',
      queueName: 'etl',
      payload: { operations: ['clean', 'normalize'] },
      dependsOn: ['extract'],
    },
    {
      key: 'load',
      queueName: 'etl',
      payload: { destination: 'postgres://db/table' },
      dependsOn: ['transform'],
    },
  ],
});

console.log(`Workflow ID: ${workflow.workflowId}`);
console.log('Jobs:', workflow.jobMappings);
// { extract: 'job_abc', transform: 'job_def', load: 'job_ghi' }
```

## Complex DAG Patterns

### Fan-Out (Parallel Processing)

```typescript
const workflow = await client.workflows.create({
  name: 'Parallel Processing',
  jobs: [
    { key: 'fetch', queueName: 'data', payload: { url: '...' } },

    // These run in parallel after 'fetch' completes
    { key: 'process-a', queueName: 'cpu', payload: { type: 'a' }, dependsOn: ['fetch'] },
    { key: 'process-b', queueName: 'cpu', payload: { type: 'b' }, dependsOn: ['fetch'] },
    { key: 'process-c', queueName: 'cpu', payload: { type: 'c' }, dependsOn: ['fetch'] },
  ],
});
```

```
           ┌───────┐
           │ Fetch │
           └───┬───┘
       ┌───────┼───────┐
       ▼       ▼       ▼
  ┌────────┐┌────────┐┌────────┐
  │Process ││Process ││Process │
  │   A    ││   B    ││   C    │
  └────────┘└────────┘└────────┘
```

### Fan-In (Aggregation)

```typescript
const workflow = await client.workflows.create({
  name: 'Map-Reduce',
  jobs: [
    // Parallel map phase
    { key: 'map-1', queueName: 'workers', payload: { partition: 1 } },
    { key: 'map-2', queueName: 'workers', payload: { partition: 2 } },
    { key: 'map-3', queueName: 'workers', payload: { partition: 3 } },

    // Reduce phase - waits for all map jobs
    {
      key: 'reduce',
      queueName: 'workers',
      payload: { operation: 'aggregate' },
      dependsOn: ['map-1', 'map-2', 'map-3'],
    },
  ],
});
```

```
  ┌───────┐  ┌───────┐  ┌───────┐
  │ Map 1 │  │ Map 2 │  │ Map 3 │
  └───┬───┘  └───┬───┘  └───┬───┘
      └──────────┼──────────┘
                 ▼
            ┌────────┐
            │ Reduce │
            └────────┘
```

### Diamond Pattern

```typescript
const workflow = await client.workflows.create({
  name: 'Diamond Workflow',
  jobs: [
    { key: 'start', queueName: 'pipeline', payload: {} },

    { key: 'path-a', queueName: 'pipeline', payload: {}, dependsOn: ['start'] },
    { key: 'path-b', queueName: 'pipeline', payload: {}, dependsOn: ['start'] },

    { key: 'merge', queueName: 'pipeline', payload: {}, dependsOn: ['path-a', 'path-b'] },
  ],
});
```

```
       ┌───────┐
       │ Start │
       └───┬───┘
      ┌────┴────┐
      ▼         ▼
  ┌───────┐ ┌───────┐
  │Path A │ │Path B │
  └───┬───┘ └───┬───┘
      └────┬────┘
           ▼
       ┌───────┐
       │ Merge │
       └───────┘
```

### Multi-Stage Pipeline

```typescript
const workflow = await client.workflows.create({
  name: 'CI/CD Pipeline',
  jobs: [
    // Stage 1: Build
    { key: 'checkout', queueName: 'ci', payload: { repo: 'github.com/...' } },
    { key: 'install', queueName: 'ci', payload: {}, dependsOn: ['checkout'] },
    { key: 'build', queueName: 'ci', payload: {}, dependsOn: ['install'] },

    // Stage 2: Test (parallel)
    { key: 'unit-tests', queueName: 'ci', payload: {}, dependsOn: ['build'] },
    { key: 'integration-tests', queueName: 'ci', payload: {}, dependsOn: ['build'] },
    { key: 'e2e-tests', queueName: 'ci', payload: {}, dependsOn: ['build'] },

    // Stage 3: Deploy (after all tests pass)
    {
      key: 'deploy',
      queueName: 'cd',
      payload: { env: 'production' },
      dependsOn: ['unit-tests', 'integration-tests', 'e2e-tests'],
    },

    // Stage 4: Notify
    { key: 'notify', queueName: 'notifications', payload: {}, dependsOn: ['deploy'] },
  ],
});
```

## Monitoring Workflows

### Get Workflow Status

```typescript
const status = await client.workflows.get(workflow.workflowId);

console.log('Workflow status:', status.status);
// 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

console.log('Jobs:');
for (const job of status.jobs) {
  console.log(`  ${job.key}: ${job.status}`);
}
```

### Check Individual Job Dependencies

```typescript
const deps = await client.workflows.jobs.getDependencies(jobId);

console.log('Depends on:', deps.dependsOn);
console.log('Required by:', deps.dependedOnBy);
```

## Cancelling Workflows

Cancel an entire workflow (cancels all pending/running jobs):

```typescript
await client.workflows.cancel(workflow.workflowId);
```

## Error Handling in Workflows

### Workflow Failure Behavior

When a job in a workflow fails:

1. The failed job follows its retry policy
2. If all retries exhausted, the job is marked `failed`
3. Downstream dependent jobs are **not** started
4. The workflow status becomes `failed`

### Retry Failed Workflows

The simplest way to retry a failed workflow is to use the `retry` method:

```typescript
// Get the failed workflow
const status = await client.workflows.get(workflowId);

if (status.status === 'failed') {
  // Retry all failed jobs in one call
  const workflow = await client.workflows.retry(workflowId);
  console.log(`Workflow ${workflow.status}`); // 'running'
}
```

This will:
- Reset all failed/deadletter jobs back to pending
- Clear retry counts and error messages
- Resume the workflow (status changes to 'running')
- Notify workers that jobs are ready for processing

### Partial Workflow Recovery

For more granular control, you can retry individual jobs:

```typescript
// Re-run only a specific failed job and its dependents
const failedJobKey = 'transform';
const jobId = workflow.jobMappings[failedJobKey];

await client.jobs.retry(jobId);
// This will re-run 'transform' and once complete, 'load' will start
```

## Processing Workflow Jobs

Workers process workflow jobs like any other job:

```typescript
const worker = new SpooledWorker(client, {
  queueName: 'etl',
  concurrency: 5,
});

worker.process(async (ctx) => {
  // Access workflow context from payload (if needed)
  const { step, workflowId } = ctx.payload;

  switch (step) {
    case 'extract':
      return await extractData(ctx.payload.source);

    case 'transform':
      return await transformData(ctx.payload.operations);

    case 'load':
      return await loadData(ctx.payload.destination);

    default:
      throw new Error(`Unknown step: ${step}`);
  }
});

await worker.start();
```

### Passing Data Between Jobs

Job results are available to downstream jobs via the result field:

```typescript
// In the 'transform' job worker:
worker.process(async (ctx) => {
  if (ctx.payload.step === 'transform') {
    // Get result from the 'extract' job
    const extractJobId = ctx.payload.dependencies?.extract;
    if (extractJobId) {
      const extractJob = await client.jobs.get(extractJobId);
      const extractedData = extractJob.result;

      // Use the extracted data
      return transformData(extractedData);
    }
  }
});
```

## Dynamic Workflow Building

Create workflows programmatically based on input:

```typescript
function createBatchWorkflow(items: string[]) {
  const jobs = [];

  // Create parallel processing jobs
  for (let i = 0; i < items.length; i++) {
    jobs.push({
      key: `process-${i}`,
      queueName: 'batch',
      payload: { item: items[i], index: i },
    });
  }

  // Add aggregation job that depends on all processing jobs
  jobs.push({
    key: 'aggregate',
    queueName: 'batch',
    payload: { totalItems: items.length },
    dependsOn: items.map((_, i) => `process-${i}`),
  });

  return client.workflows.create({
    name: `Batch Processing ${items.length} items`,
    jobs,
  });
}

// Usage
const workflow = await createBatchWorkflow(['a', 'b', 'c', 'd', 'e']);
```

## Best Practices

### 1. Keep Jobs Atomic

Each job should be self-contained and idempotent:

```typescript
// Good: Each job has a clear, single responsibility
{ key: 'download', payload: { url: '...' } }
{ key: 'parse', payload: { format: 'json' }, dependsOn: ['download'] }
{ key: 'validate', payload: { schema: '...' }, dependsOn: ['parse'] }

// Avoid: Overloaded jobs that do too much
{ key: 'download-parse-validate', payload: { ... } } // Too many responsibilities
```

### 2. Use Meaningful Keys

Job keys should be descriptive and follow a consistent naming convention:

```typescript
// Good
{ key: 'extract-user-data', ... }
{ key: 'transform-to-csv', ... }
{ key: 'upload-to-s3', ... }

// Avoid
{ key: 'step1', ... }
{ key: 'job2', ... }
```

### 3. Handle Partial Failures

Design workflows to be resumable:

```typescript
worker.process(async (ctx) => {
  // Check if work was partially done (for retries)
  const checkpoint = await getCheckpoint(ctx.jobId);

  if (checkpoint) {
    // Resume from checkpoint
    return await resumeFromCheckpoint(checkpoint, ctx.payload);
  }

  // Full processing
  return await fullProcess(ctx.payload);
});
```

### 4. Set Appropriate Timeouts

Different stages may need different timeouts:

```typescript
const workflow = await client.workflows.create({
  name: 'Data Pipeline',
  jobs: [
    {
      key: 'download',
      queueName: 'io',
      payload: {},
      timeoutSeconds: 300, // 5 minutes for download
    },
    {
      key: 'process',
      queueName: 'cpu',
      payload: {},
      timeoutSeconds: 3600, // 1 hour for heavy processing
      dependsOn: ['download'],
    },
  ],
});
```

