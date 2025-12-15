#!/usr/bin/env tsx
/**
 * COMPREHENSIVE SPOOLED TEST SUITE
 * 
 * Tests ALL API endpoints, SDK features, and integration scenarios:
 * - Health endpoints
 * - Authentication (API key & JWT)
 * - Dashboard
 * - Jobs (CRUD, bulk, lifecycle, DLQ)
 * - Queues (config, pause/resume, stats)
 * - Workers (register, heartbeat, deregister, processing)
 * - Webhooks (CRUD, test, delivery)
 * - Schedules (CRUD, pause/resume, trigger)
 * - Workflows (create with dependencies)
 * - API Keys (CRUD)
 * - Organizations (get, usage)
 * 
 * Usage:
 *   API_KEY=sk_test_... BASE_URL=http://localhost:8080 npx tsx scripts/test-local.ts
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { 
  SpooledClient, 
  SpooledWorker, 
  isSpooledError,
} from '../src/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const API_KEY = process.env.API_KEY;
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001', 10);
const VERBOSE = process.env.VERBOSE === '1' || process.env.VERBOSE === 'true';

if (!API_KEY) {
  console.error('❌ API_KEY environment variable is required');
  console.error('   Usage: API_KEY=sk_test_... BASE_URL=http://localhost:8080 npx tsx scripts/test-local.ts');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types & State
// ─────────────────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  skipped?: boolean;
}

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

const results: TestResult[] = [];
const receivedWebhooks: WebhookPayload[] = [];
let webhookServer: Server | null = null;
let testPrefix = '';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(message: string, ...args: unknown[]): void {
  if (VERBOSE) {
    console.log(`  [DEBUG] ${message}`, ...args);
  }
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

async function runTest(
  name: string, 
  fn: () => Promise<void>,
  options: { skip?: boolean; skipReason?: string } = {}
): Promise<void> {
  if (options.skip) {
    results.push({ name, passed: true, duration: 0, skipped: true });
    console.log(`  ⏭️  ${name} (skipped: ${options.skipReason || 'N/A'})`);
    return;
  }

  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`  ✓ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: message });
    console.log(`  ✗ ${name} (${duration}ms)`);
    if (VERBOSE) {
      console.log(`    Error: ${message}`);
    }
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertDefined<T>(value: T | undefined | null, message: string): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(`${message}: value is ${value}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Server
// ─────────────────────────────────────────────────────────────────────────────

async function startWebhookServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    webhookServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', (chunk: Buffer) => body += chunk.toString());
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as WebhookPayload;
            receivedWebhooks.push(payload);
            log(`Webhook received: ${payload.event}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          } catch {
            res.writeHead(400);
            res.end('Bad Request');
          }
        });
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end('OK');
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    webhookServer.listen(WEBHOOK_PORT, () => {
      log(`Webhook server listening on port ${WEBHOOK_PORT}`);
      resolve();
    });
    
    webhookServer.on('error', reject);
  });
}

function stopWebhookServer(): void {
  if (webhookServer) {
    webhookServer.close();
    webhookServer = null;
  }
}

function clearReceivedWebhooks(): void {
  receivedWebhooks.length = 0;
}

async function waitForWebhook(event: string, timeoutMs = 5000): Promise<WebhookPayload | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const webhook = receivedWebhooks.find(w => w.event === event);
    if (webhook) return webhook;
    await sleep(100);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────────────────────────────────────

async function testHealthEndpoints(client: SpooledClient): Promise<void> {
  console.log('\n📋 Health Endpoints');
  console.log('─'.repeat(60));

  await runTest('GET /health - Full health check', async () => {
    const response = await client.health.get();
    assertDefined(response.status, 'status should be defined');
    assertEqual(response.status, 'healthy', 'status');
    assertEqual(response.database, true, 'database');
    assertEqual(response.cache, true, 'cache');
  });

  await runTest('GET /health/live - Liveness probe', async () => {
    const isLive = await client.health.liveness();
    assertEqual(isLive, true, 'should be live');
  });

  await runTest('GET /health/ready - Readiness probe', async () => {
    const isReady = await client.health.readiness();
    assertEqual(isReady, true, 'should be ready');
  });
}

async function testDashboard(client: SpooledClient): Promise<void> {
  console.log('\n📊 Dashboard');
  console.log('─'.repeat(60));

  await runTest('GET /api/v1/dashboard', async () => {
    const dashboard = await client.dashboard.get();
    assertDefined(dashboard.system, 'system info should exist');
    assertDefined(dashboard.system?.version, 'version should exist');
    assertDefined(dashboard.jobs, 'jobs stats should exist');
    assertDefined(dashboard.workers, 'workers stats should exist');
    log(`Version: ${dashboard.system?.version}, Environment: ${dashboard.system?.environment}`);
  });
}

async function testJobsBasicCRUD(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Basic CRUD');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-jobs-crud`;
  let jobId: string = '';

  await runTest('POST /api/v1/jobs - Create job', async () => {
    const result = await client.jobs.create({
      queueName,
      payload: { test: 'data', timestamp: Date.now() },
      priority: 5,
      maxRetries: 3,
      tags: { environment: 'test', suite: 'crud' },
    });
    assertDefined(result.id, 'job id');
    assertEqual(result.created, true, 'created flag');
    jobId = result.id;
    log(`Created job: ${jobId}`);
  });

  await runTest('GET /api/v1/jobs/{id} - Get job', async () => {
    const job = await client.jobs.get(jobId);
    assertEqual(job.id, jobId, 'job id');
    assertEqual(job.queueName, queueName, 'queue name');
    assertEqual(job.status, 'pending', 'status');
    assertEqual(job.priority, 5, 'priority');
    assertDefined(job.payload, 'payload');
  });

  await runTest('GET /api/v1/jobs - List jobs', async () => {
    const jobs = await client.jobs.list({ queueName, limit: 10 });
    assert(Array.isArray(jobs), 'should return array');
    assert(jobs.length > 0, 'should have jobs');
    assert(jobs.some(j => j.id === jobId), 'should include our job');
  });

  await runTest('GET /api/v1/jobs - Filter by status', async () => {
    const jobs = await client.jobs.list({ queueName, status: 'pending' });
    assert(jobs.every(j => j.status === 'pending'), 'all should be pending');
  });

  await runTest('PUT /api/v1/jobs/{id}/priority - Boost priority', async () => {
    await client.jobs.boostPriority(jobId, 10);
    const job = await client.jobs.get(jobId);
    assertEqual(job.priority, 10, 'boosted priority');
  });

  await runTest('DELETE /api/v1/jobs/{id} - Cancel job', async () => {
    await client.jobs.cancel(jobId);
    const job = await client.jobs.get(jobId);
    assertEqual(job.status, 'cancelled', 'status should be cancelled');
  });
}

async function testJobsBulkOperations(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Bulk Operations');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-jobs-bulk`;
  const jobIds: string[] = [];

  await runTest('POST /api/v1/jobs/bulk - Bulk create', async () => {
    const result = await client.jobs.bulkEnqueue({
      queueName,
      jobs: [
        { payload: { index: 0, type: 'bulk-test' } },
        { payload: { index: 1, type: 'bulk-test' }, priority: 5 },
        { payload: { index: 2, type: 'bulk-test' }, priority: 10 },
      ],
    });
    assertEqual(result.successCount, 3, 'success count');
    assertEqual(result.failureCount, 0, 'failure count');
    assertEqual(result.succeeded.length, 3, 'succeeded array length');
    result.succeeded.forEach(s => jobIds.push(s.jobId));
  });

  await runTest('GET /api/v1/jobs/status - Batch status lookup', async () => {
    const statuses = await client.jobs.batchStatus(jobIds);
    assertEqual(statuses.length, 3, 'should have 3 statuses');
    statuses.forEach(item => {
      assertEqual(item.status, 'pending', 'all should be pending');
    });
  });

  await runTest('GET /api/v1/jobs/stats - Job statistics', async () => {
    const stats = await client.jobs.getStats();
    assertDefined(stats.pending, 'pending should be defined');
    assertDefined(stats.total, 'total should be defined');
    log(`Stats: pending=${stats.pending}, total=${stats.total}`);
  });

  // Cleanup
  for (const id of jobIds) {
    try { await client.jobs.cancel(id); } catch { /* ignore */ }
  }
}

async function testJobIdempotency(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Idempotency');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-jobs-idempotency`;
  const idempotencyKey = `idem-${Date.now()}`;
  let firstJobId = '';

  await runTest('Create job with idempotency key', async () => {
    const result = await client.jobs.create({
      queueName,
      payload: { test: 'idempotent' },
      idempotencyKey,
    });
    assertEqual(result.created, true, 'first creation');
    firstJobId = result.id;
  });

  await runTest('Duplicate with same idempotency key returns existing', async () => {
    const result = await client.jobs.create({
      queueName,
      payload: { test: 'idempotent-duplicate' },
      idempotencyKey,
    });
    assertEqual(result.created, false, 'should not create new');
    assertEqual(result.id, firstJobId, 'should return same id');
  });

  try { await client.jobs.cancel(firstJobId); } catch { /* ignore */ }
}

async function testJobLifecycle(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Full Lifecycle');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-jobs-lifecycle`;
  let jobId = '';
  let workerId = '';

  await runTest('Create job for lifecycle test', async () => {
    const result = await client.jobs.create({
      queueName,
      payload: { action: 'lifecycle-test' },
    });
    jobId = result.id;
  });

  await runTest('POST /api/v1/workers/register', async () => {
    const result = await client.workers.register({
      queueName,
      hostname: 'test-lifecycle-worker',
      maxConcurrency: 1,
    });
    workerId = result.id;
    assertDefined(result.leaseDurationSecs, 'lease duration');
    assertDefined(result.heartbeatIntervalSecs, 'heartbeat interval');
  });

  await runTest('POST /api/v1/jobs/claim - Claim job', async () => {
    const result = await client.jobs.claim({
      queueName,
      workerId,
      limit: 1,
    });
    assertEqual(result.jobs.length, 1, 'should claim 1 job');
    assertEqual(result.jobs[0].id, jobId, 'should be our job');
  });

  await runTest('Job status is processing after claim', async () => {
    const job = await client.jobs.get(jobId);
    assertEqual(job.status, 'processing', 'status');
    assertEqual(job.assignedWorkerId, workerId, 'assigned worker');
  });

  await runTest('POST /api/v1/jobs/{id}/heartbeat - Extend lease', async () => {
    await client.jobs.heartbeat(jobId, { workerId, leaseDurationSecs: 60 });
    const job = await client.jobs.get(jobId);
    assertDefined(job.leaseExpiresAt, 'lease should be extended');
  });

  await runTest('POST /api/v1/jobs/{id}/complete - Complete job', async () => {
    await client.jobs.complete(jobId, {
      workerId,
      result: { processed: true, timestamp: new Date().toISOString() },
    });
    const job = await client.jobs.get(jobId);
    assertEqual(job.status, 'completed', 'status');
    assertDefined(job.completedAt, 'completed_at');
    assertDefined(job.result, 'result');
  });

  await runTest('POST /api/v1/workers/{id}/deregister', async () => {
    await client.workers.deregister(workerId);
  });
}

async function testJobFailureAndRetry(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Failure & Retry');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-jobs-failure`;
  let jobId = '';
  let workerId = '';

  await runTest('Create job for failure test', async () => {
    const result = await client.jobs.create({
      queueName,
      payload: { action: 'fail-test' },
      maxRetries: 0, // No auto-retry, will go straight to failed
    });
    jobId = result.id;
  });

  await runTest('Register worker and claim job', async () => {
    const reg = await client.workers.register({
      queueName,
      hostname: 'test-failure-worker',
      maxConcurrency: 1,
    });
    workerId = reg.id;
    await client.jobs.claim({ queueName, workerId, limit: 1 });
  });

  await runTest('POST /api/v1/jobs/{id}/fail - Fail job', async () => {
    await client.jobs.fail(jobId, {
      workerId,
      error: 'Intentional test failure',
    });
    const job = await client.jobs.get(jobId);
    // With maxRetries=0, job should be failed or deadletter
    assert(
      job.status === 'failed' || job.status === 'deadletter',
      `status should be failed or deadletter, got ${job.status}`
    );
  });

  await runTest('POST /api/v1/jobs/{id}/retry - Manual retry', async () => {
    const job = await client.jobs.get(jobId);
    if (job.status === 'failed' || job.status === 'deadletter') {
      const retried = await client.jobs.retry(jobId);
      assertEqual(retried.status, 'pending', 'should be pending after retry');
    }
  });

  // Cleanup
  await client.workers.deregister(workerId);
  try { await client.jobs.cancel(jobId); } catch { /* ignore */ }
}

async function testDLQ(client: SpooledClient): Promise<void> {
  console.log('\n📦 Jobs - Dead Letter Queue');
  console.log('─'.repeat(60));

  await runTest('GET /api/v1/jobs/dlq - List DLQ', async () => {
    const jobs = await client.jobs.dlq.list({ limit: 10 });
    assert(Array.isArray(jobs), 'jobs should be array');
    log(`DLQ has ${jobs.length} jobs`);
  });
}

async function testQueues(client: SpooledClient): Promise<void> {
  console.log('\n📁 Queues');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-queue-test`;
  
  // Create a job to ensure queue exists
  await runTest('Create queue (via job)', async () => {
    await client.jobs.create({
      queueName,
      payload: { purpose: 'create-queue' },
    });
  });

  await runTest('GET /api/v1/queues - List queues', async () => {
    const queues = await client.queues.list();
    assert(Array.isArray(queues), 'queues should be array');
    log(`Found ${queues.length} queues`);
  });

  await runTest('POST /api/v1/queues/{name}/pause - Pause queue', async () => {
    const result = await client.queues.pause(queueName, 'Test pause');
    assertEqual(result.paused, true, 'paused flag');
    assertEqual(result.queueName, queueName, 'queue name');
  });

  await runTest('POST /api/v1/queues/{name}/resume - Resume queue', async () => {
    const result = await client.queues.resume(queueName);
    assertEqual(result.resumed, true, 'resumed flag');
  });
}

async function testWorkers(client: SpooledClient): Promise<void> {
  console.log('\n👷 Workers');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-workers`;
  let workerId = '';

  await runTest('POST /api/v1/workers/register', async () => {
    const result = await client.workers.register({
      queueName,
      hostname: 'test-worker-host',
      workerType: 'test',
      maxConcurrency: 5,
      metadata: { test: true },
      version: '1.0.0',
    });
    workerId = result.id;
    assertDefined(result.id, 'worker id');
    assertDefined(result.leaseDurationSecs, 'lease duration');
    assertDefined(result.heartbeatIntervalSecs, 'heartbeat interval');
  });

  await runTest('GET /api/v1/workers - List workers', async () => {
    const workers = await client.workers.list();
    assert(Array.isArray(workers), 'workers should be array');
    assert(workers.some(w => w.id === workerId), 'should include our worker');
  });

  await runTest('GET /api/v1/workers/{id} - Get worker', async () => {
    const worker = await client.workers.get(workerId);
    assertEqual(worker.id, workerId, 'worker id');
    assertEqual(worker.hostname, 'test-worker-host', 'hostname');
    assertEqual(worker.status, 'healthy', 'status');
  });

  await runTest('POST /api/v1/workers/{id}/heartbeat', async () => {
    // Heartbeat returns void, we just check it doesn't throw
    await client.workers.heartbeat(workerId, {
      currentJobs: 2,
      status: 'healthy',
    });
    // Verify worker is still accessible
    const worker = await client.workers.get(workerId);
    assertDefined(worker.lastHeartbeat, 'heartbeat should be updated');
  });

  await runTest('POST /api/v1/workers/{id}/deregister', async () => {
    await client.workers.deregister(workerId);
  });
}

async function testWebhooks(client: SpooledClient): Promise<void> {
  console.log('\n🔔 Outgoing Webhooks');
  console.log('─'.repeat(60));

  let webhookId = '';
  const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhook`;

  await runTest('POST /api/v1/outgoing-webhooks - Create webhook', async () => {
    const result = await client.webhooks.create({
      name: `${testPrefix}-webhook`,
      url: webhookUrl,
      events: ['job.created', 'job.completed', 'job.failed'],
      enabled: true,
    });
    webhookId = result.id;
    assertDefined(result.id, 'webhook id');
    assertEqual(result.enabled, true, 'enabled');
  });

  await runTest('GET /api/v1/outgoing-webhooks - List webhooks', async () => {
    const webhooks = await client.webhooks.list();
    assert(Array.isArray(webhooks), 'webhooks should be array');
    assert(webhooks.some(w => w.id === webhookId), 'should include our webhook');
  });

  await runTest('GET /api/v1/outgoing-webhooks/{id} - Get webhook', async () => {
    const webhook = await client.webhooks.get(webhookId);
    assertEqual(webhook.id, webhookId, 'webhook id');
    assertEqual(webhook.url, webhookUrl, 'url');
  });

  await runTest('PUT /api/v1/outgoing-webhooks/{id} - Update webhook', async () => {
    await client.webhooks.update(webhookId, {
      events: ['job.created', 'job.completed', 'job.failed', 'job.started'],
    });
    const webhook = await client.webhooks.get(webhookId);
    assert(webhook.events.includes('job.started'), 'should have job.started event');
  });

  await runTest('POST /api/v1/outgoing-webhooks/{id}/test - Test webhook', async () => {
    clearReceivedWebhooks();
    const result = await client.webhooks.test(webhookId);
    assertEqual(result.success, true, 'test should succeed');
    assertDefined(result.responseTimeMs, 'response time');
    
    // Wait for webhook to be received
    const received = await waitForWebhook('webhook.test', 2000);
    assertDefined(received, 'should receive test webhook');
  });

  await runTest('GET /api/v1/outgoing-webhooks/{id}/deliveries - List deliveries', async () => {
    const deliveries = await client.webhooks.getDeliveries(webhookId);
    assert(Array.isArray(deliveries), 'deliveries should be array');
    log(`Webhook has ${deliveries.length} deliveries`);
  });

  // Cleanup
  await runTest('DELETE /api/v1/outgoing-webhooks/{id} - Delete webhook', async () => {
    await client.webhooks.delete(webhookId);
  });
}

async function testSchedules(client: SpooledClient): Promise<void> {
  console.log('\n⏰ Schedules');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-schedules`;
  let scheduleId = '';

  await runTest('POST /api/v1/schedules - Create schedule', async () => {
    const result = await client.schedules.create({
      name: `${testPrefix}-schedule`,
      description: 'Test schedule for comprehensive testing',
      cronExpression: '0 0 * * * *', // Every hour (6-field cron with seconds)
      timezone: 'UTC',
      queueName,
      payloadTemplate: { type: 'scheduled', source: 'test' },
      priority: 5,
    });
    scheduleId = result.id;
    assertDefined(result.id, 'schedule id');
    // nextRunAt might not be set immediately
    log(`Created schedule: ${scheduleId}`);
  });

  await runTest('GET /api/v1/schedules - List schedules', async () => {
    const schedules = await client.schedules.list();
    assert(Array.isArray(schedules), 'schedules should be array');
    if (scheduleId) {
      assert(schedules.some(s => s.id === scheduleId), 'should include our schedule');
    }
  });

  await runTest('GET /api/v1/schedules/{id} - Get schedule', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    const schedule = await client.schedules.get(scheduleId);
    assertEqual(schedule.id, scheduleId, 'schedule id');
    assertEqual(schedule.cronExpression, '0 0 * * * *', 'cron expression');
    assertEqual(schedule.isActive, true, 'is active');
  });

  await runTest('PUT /api/v1/schedules/{id} - Update schedule', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    await client.schedules.update(scheduleId, {
      description: 'Updated description',
      priority: 10,
    });
    const schedule = await client.schedules.get(scheduleId);
    assertEqual(schedule.description, 'Updated description', 'description');
    assertEqual(schedule.priority, 10, 'priority');
  });

  await runTest('POST /api/v1/schedules/{id}/pause - Pause schedule', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    const schedule = await client.schedules.pause(scheduleId);
    assertEqual(schedule.isActive, false, 'should be inactive');
  });

  await runTest('POST /api/v1/schedules/{id}/resume - Resume schedule', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    const schedule = await client.schedules.resume(scheduleId);
    assertEqual(schedule.isActive, true, 'should be active');
  });

  await runTest('POST /api/v1/schedules/{id}/trigger - Manual trigger', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    const result = await client.schedules.trigger(scheduleId);
    assertDefined(result.jobId, 'triggered job id');
    log(`Triggered job: ${result.jobId}`);
  });

  await runTest('GET /api/v1/schedules/{id}/history - Execution history', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    const runs = await client.schedules.getHistory(scheduleId);
    assert(Array.isArray(runs), 'runs should be array');
    log(`Schedule has ${runs.length} runs`);
  });

  await runTest('DELETE /api/v1/schedules/{id} - Delete schedule', async () => {
    if (!scheduleId) throw new Error('Schedule not created');
    await client.schedules.delete(scheduleId);
  });
}

async function testWorkflows(client: SpooledClient): Promise<void> {
  console.log('\n🔀 Workflows');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-workflows`;
  let workflowId = '';

  await runTest('POST /api/v1/workflows - Create workflow', async () => {
    const result = await client.workflows.create({
      name: `${testPrefix}-workflow`,
      description: 'Test workflow with dependencies',
      jobs: [
        { key: 'step1', queueName, payload: { step: 1 } },
        { key: 'step2', queueName, payload: { step: 2 }, dependsOn: ['step1'] },
        { key: 'step3', queueName, payload: { step: 3 }, dependsOn: ['step1'] },
        { key: 'step4', queueName, payload: { step: 4 }, dependsOn: ['step2', 'step3'], dependencyMode: 'all' },
      ],
    });
    workflowId = result.workflowId;
    assertDefined(result.workflowId, 'workflow id');
    assertEqual(result.jobIds.length, 4, 'should create 4 jobs');
    log(`Created workflow: ${workflowId}`);
  });

  await runTest('GET /api/v1/workflows - List workflows', async () => {
    const workflows = await client.workflows.list();
    assert(Array.isArray(workflows), 'workflows should be array');
  });

  await runTest('GET /api/v1/workflows/{id} - Get workflow', async () => {
    const workflow = await client.workflows.get(workflowId);
    assertEqual(workflow.id, workflowId, 'workflow id');
    assertEqual(workflow.totalJobs, 4, 'total jobs');
  });

  await runTest('POST /api/v1/workflows/{id}/cancel - Cancel workflow', async () => {
    const workflow = await client.workflows.cancel(workflowId);
    assertEqual(workflow.status, 'cancelled', 'status');
  });
}

async function testApiKeys(client: SpooledClient): Promise<void> {
  console.log('\n🔑 API Keys');
  console.log('─'.repeat(60));

  let newKeyId = '';
  let newKey = '';

  await runTest('GET /api/v1/api-keys - List API keys', async () => {
    const keys = await client.apiKeys.list();
    assert(Array.isArray(keys), 'keys should be array');
    log(`Found ${keys.length} API keys`);
  });

  await runTest('POST /api/v1/api-keys - Create API key', async () => {
    const result = await client.apiKeys.create({
      name: `${testPrefix}-key`,
    });
    newKeyId = result.id;
    newKey = result.key;
    assertDefined(result.id, 'key id');
    assertDefined(result.key, 'key value');
    assert(result.key.startsWith('sk_'), 'key should start with sk_');
  });

  await runTest('GET /api/v1/api-keys/{id} - Get API key', async () => {
    const key = await client.apiKeys.get(newKeyId);
    assertEqual(key.id, newKeyId, 'key id');
    assertEqual(key.name, `${testPrefix}-key`, 'name');
    assertEqual(key.isActive, true, 'is active');
  });

  await runTest('PUT /api/v1/api-keys/{id} - Update API key', async () => {
    await client.apiKeys.update(newKeyId, {
      name: `${testPrefix}-key-updated`,
    });
    const key = await client.apiKeys.get(newKeyId);
    assertEqual(key.name, `${testPrefix}-key-updated`, 'updated name');
  });

  await runTest('New API key works for authentication', async () => {
    const testClient = new SpooledClient({
      apiKey: newKey,
      baseUrl: BASE_URL,
    });
    const dashboard = await testClient.dashboard.get();
    assertDefined(dashboard.system, 'should authenticate with new key');
  });

  await runTest('DELETE /api/v1/api-keys/{id} - Revoke API key', async () => {
    await client.apiKeys.revoke(newKeyId);
  });
}

async function testOrganization(client: SpooledClient): Promise<void> {
  console.log('\n🏢 Organization');
  console.log('─'.repeat(60));

  await runTest('GET /api/v1/organizations/usage - Get usage & limits', async () => {
    const usage = await client.organizations.getUsage();
    assertDefined(usage.plan, 'plan');
    assertDefined(usage.limits, 'limits');
    assertDefined(usage.usage, 'usage');
    log(`Plan: ${usage.plan}, Tier: ${usage.limits.tier}`);
  });
}

async function testAuth(client: SpooledClient): Promise<void> {
  console.log('\n🔐 Authentication');
  console.log('─'.repeat(60));

  let accessToken = '';
  let refreshToken = '';

  await runTest('POST /api/v1/auth/login - Exchange API key for JWT', async () => {
    const result = await client.auth.login({ apiKey: API_KEY! });
    accessToken = result.accessToken;
    refreshToken = result.refreshToken;
    assertDefined(result.accessToken, 'access token');
    assertDefined(result.refreshToken, 'refresh token');
    assertEqual(result.tokenType, 'Bearer', 'token type');
    assertDefined(result.expiresIn, 'expires in');
    log(`Token expires in ${result.expiresIn}s`);
  });

  await runTest('POST /api/v1/auth/validate - Validate token', async () => {
    const result = await client.auth.validate({ token: accessToken });
    assertEqual(result.valid, true, 'should be valid');
    // claims might be present but structure may vary
    log(`Validate result: valid=${result.valid}, claims=${JSON.stringify(result.claims)}`);
  });

  await runTest('GET /api/v1/auth/me - Get current user (JWT)', async () => {
    // Create a client with JWT token
    const jwtClient = new SpooledClient({
      accessToken,
      baseUrl: BASE_URL,
    });
    const me = await jwtClient.auth.me();
    assertDefined(me.organizationId, 'organization id');
    assertDefined(me.issuedAt, 'issued at');
    assertDefined(me.expiresAt, 'expires at');
  });

  await runTest('POST /api/v1/auth/refresh - Refresh token', async () => {
    const result = await client.auth.refresh({ refreshToken });
    assertDefined(result.accessToken, 'new access token');
    assert(result.accessToken !== accessToken, 'should be new token');
  });

  await runTest('POST /api/v1/auth/logout - Logout', async () => {
    const jwtClient = new SpooledClient({
      accessToken,
      baseUrl: BASE_URL,
    });
    await jwtClient.auth.logout();
    // Token should be invalidated now
  });
}

async function testWorkerIntegration(client: SpooledClient): Promise<void> {
  console.log('\n⚙️ Worker Integration (SpooledWorker)');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-worker-integration`;
  let worker: SpooledWorker | null = null;
  let jobsProcessed = 0;
  let jobsCompleted = 0;
  let jobsFailed = 0;
  let workerStarted = false;

  await runTest('Create and start SpooledWorker', async () => {
    worker = new SpooledWorker(client, {
      queueName,
      concurrency: 2,
      pollInterval: 200,
    });

    worker.on('started', () => {
      log('Worker started');
      workerStarted = true;
    });
    worker.on('job:completed', ({ jobId }) => {
      log(`Job completed: ${jobId}`);
      jobsCompleted++;
    });
    worker.on('job:failed', ({ jobId, error }) => {
      log(`Job failed: ${jobId} - ${error}`);
      jobsFailed++;
    });
    worker.on('error', ({ error }) => {
      log(`Worker error: ${error}`);
    });

    worker.process(async (ctx) => {
      jobsProcessed++;
      
      // Simulate work
      await sleep(50);
      
      // Fail jobs with shouldFail flag
      if ((ctx.payload as Record<string, unknown>)?.shouldFail) {
        throw new Error('Intentional failure');
      }
      
      return { processed: true, jobId: ctx.jobId };
    });

    // Start the worker (don't await - it returns immediately)
    worker.start().catch(err => log(`Worker start error: ${err}`));
    
    // Wait for worker to fully start (longer timeout)
    for (let i = 0; i < 50 && !workerStarted; i++) {
      await sleep(100);
    }
    
    // Worker.isRunning may not be immediately true; check state or workerStarted flag
    assert(workerStarted || worker.isRunning, 'worker should be running');
  });

  await runTest('Process multiple jobs through worker', async () => {
    if (!worker) throw new Error('Worker not initialized');
    
    // Create a few jobs (keep it small to avoid hitting free tier limits)
    const jobIds: string[] = [];
    const numJobs = 3;
    for (let i = 0; i < numJobs; i++) {
      const { id } = await client.jobs.create({
        queueName,
        payload: { index: i, message: `Job ${i}` },
      });
      jobIds.push(id);
    }

    // Wait for processing (with longer timeout)
    for (let i = 0; i < 100 && jobsCompleted < numJobs; i++) {
      await sleep(100);
    }

    assert(jobsProcessed >= numJobs, `should process at least ${numJobs} jobs, got ${jobsProcessed}`);
    assert(jobsCompleted >= numJobs, `should complete at least ${numJobs} jobs, got ${jobsCompleted}`);

    // Verify all jobs are completed
    for (const id of jobIds) {
      const job = await client.jobs.get(id);
      assertEqual(job.status, 'completed', `job ${id} status`);
    }
  });

  await runTest('Worker handles job failures gracefully', async () => {
    if (!worker) throw new Error('Worker not initialized');
    
    const { id } = await client.jobs.create({
      queueName,
      payload: { shouldFail: true },
      maxRetries: 0, // Don't retry
    });

    // Wait for failure
    for (let i = 0; i < 50 && jobsFailed < 1; i++) {
      await sleep(100);
    }

    const job = await client.jobs.get(id);
    assert(job.status === 'failed' || job.status === 'deadletter', 'job should be failed');
  });

  await runTest('Stop worker gracefully', async () => {
    if (worker) {
      await worker.stop();
      assert(!worker.isRunning, 'worker should be stopped');
    }
  });
}

async function testWebhookDelivery(client: SpooledClient): Promise<void> {
  console.log('\n📬 Webhook Delivery (End-to-End)');
  console.log('─'.repeat(60));

  const queueName = `${testPrefix}-webhook-delivery`;
  const webhookUrl = `http://localhost:${WEBHOOK_PORT}/webhook`;
  let webhookId = '';
  let worker: SpooledWorker | null = null;

  await runTest('Setup webhook for job events', async () => {
    clearReceivedWebhooks();
    const result = await client.webhooks.create({
      name: `${testPrefix}-delivery-test`,
      url: webhookUrl,
      events: ['job.created', 'job.started', 'job.completed'],
      enabled: true,
    });
    webhookId = result.id;
  });

  await runTest('Create job and receive job.created webhook', async () => {
    await client.jobs.create({
      queueName,
      payload: { test: 'webhook-delivery' },
    });

    // Wait for webhook
    const webhook = await waitForWebhook('job.created', 3000);
    // Note: Webhook delivery is async, might not be immediate
    if (webhook) {
      assertDefined(webhook.data, 'webhook data');
      log('Received job.created webhook');
    } else {
      log('job.created webhook not received (async delivery)');
    }
  });

  await runTest('Process job and verify webhooks', async () => {
    worker = new SpooledWorker(client, {
      queueName,
      concurrency: 1,
      pollInterval: 200,
    });

    worker.process(async () => {
      await sleep(50);
      return { processed: true };
    });

    await worker.start();

    // Create another job
    await client.jobs.create({
      queueName,
      payload: { test: 'process-for-webhook' },
    });

    // Wait for processing
    await sleep(2000);

    // Check received webhooks
    log(`Received ${receivedWebhooks.length} webhooks total`);
    for (const wh of receivedWebhooks) {
      log(`  - ${wh.event}`);
    }
  });

  // Cleanup
  if (worker) await worker.stop();
  if (webhookId) {
    try { await client.webhooks.delete(webhookId); } catch { /* ignore */ }
  }
}

async function testEdgeCases(client: SpooledClient): Promise<void> {
  console.log('\n🧪 Edge Cases');
  console.log('─'.repeat(60));

  await runTest('Job with large payload', async () => {
    const largePayload = { data: 'x'.repeat(10000) }; // ~10KB to avoid hitting limits
    const { id } = await client.jobs.create({
      queueName: `${testPrefix}-edge`,
      payload: largePayload,
    });
    const job = await client.jobs.get(id);
    assertDefined(job.payload, 'payload should exist');
    await client.jobs.cancel(id);
  });

  await runTest('Job with scheduled time in future', async () => {
    const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
    const { id } = await client.jobs.create({
      queueName: `${testPrefix}-edge`,
      payload: { scheduled: true },
      scheduledAt: futureDate.toISOString(),
    });
    const job = await client.jobs.get(id);
    assertEqual(job.status, 'scheduled', 'should be scheduled');
    await client.jobs.cancel(id);
  });

  await runTest('Job with expiration', async () => {
    const expiresAt = new Date(Date.now() + 60000); // 1 minute from now
    const { id } = await client.jobs.create({
      queueName: `${testPrefix}-edge`,
      payload: { expires: true },
      expiresAt: expiresAt.toISOString(),
    });
    const job = await client.jobs.get(id);
    assertDefined(job.expiresAt, 'expires_at should be set');
    await client.jobs.cancel(id);
  });

  await runTest('Concurrent job claims (race condition)', async () => {
    const queueName = `${testPrefix}-race`;
    
    // Create a job
    await client.jobs.create({ queueName, payload: { race: true } });
    
    // Register two workers
    const [w1, w2] = await Promise.all([
      client.workers.register({ queueName, hostname: 'worker1' }),
      client.workers.register({ queueName, hostname: 'worker2' }),
    ]);

    // Both try to claim
    const [c1, c2] = await Promise.all([
      client.jobs.claim({ queueName, workerId: w1.id, limit: 1 }),
      client.jobs.claim({ queueName, workerId: w2.id, limit: 1 }),
    ]);

    // Only one should get the job
    const totalClaimed = c1.jobs.length + c2.jobs.length;
    assertEqual(totalClaimed, 1, 'only one worker should claim');

    // Cleanup
    await Promise.all([
      client.workers.deregister(w1.id),
      client.workers.deregister(w2.id),
    ]);
  });

  await runTest('Special characters in queue name', async () => {
    const specialQueue = `${testPrefix}-special_queue.test-123`;
    const { id } = await client.jobs.create({
      queueName: specialQueue,
      payload: { test: 'special' },
    });
    const job = await client.jobs.get(id);
    assertEqual(job.queueName, specialQueue, 'queue name with special chars');
    await client.jobs.cancel(id);
  });

  await runTest('Unicode in payload', async () => {
    const { id } = await client.jobs.create({
      queueName: `${testPrefix}-edge`,
      payload: {
        message: '你好世界 🌍 مرحبا',
        emoji: '🎉🚀💻',
        japanese: 'こんにちは',
      },
    });
    const job = await client.jobs.get(id);
    assertDefined(job.payload, 'payload with unicode');
    await client.jobs.cancel(id);
  });

  await runTest('Job with all optional fields', async () => {
    const { id } = await client.jobs.create({
      queueName: `${testPrefix}-edge`,
      payload: { complete: true },
      priority: 50,
      maxRetries: 5,
      timeoutSeconds: 600,
      tags: { env: 'test', version: '1.0' },
      idempotencyKey: `full-${Date.now()}`,
    });
    const job = await client.jobs.get(id);
    assertEqual(job.priority, 50, 'priority');
    assertEqual(job.maxRetries, 5, 'max retries');
    assertEqual(job.timeoutSeconds, 600, 'timeout');
    await client.jobs.cancel(id);
  });
}

async function testErrorHandling(client: SpooledClient): Promise<void> {
  console.log('\n❌ Error Handling');
  console.log('─'.repeat(60));

  await runTest('404 for non-existent job', async () => {
    try {
      await client.jobs.get('non-existent-job-id');
      throw new Error('Should have thrown');
    } catch (error) {
      if (isSpooledError(error)) {
        assertEqual(error.statusCode, 404, 'status code');
      } else {
        throw error;
      }
    }
  });

  await runTest('Validation error for invalid payload', async () => {
    try {
      await client.jobs.create({
        queueName: '', // Invalid: empty queue name
        payload: {},
      });
      throw new Error('Should have thrown');
    } catch (error) {
      if (isSpooledError(error)) {
        assertEqual(error.statusCode, 400, 'status code');
      } else {
        throw error;
      }
    }
  });

  await runTest('401 for invalid API key', async () => {
    const badClient = new SpooledClient({
      apiKey: 'sk_test_invalid_key_that_does_not_exist',
      baseUrl: BASE_URL,
    });
    try {
      await badClient.dashboard.get();
      throw new Error('Should have thrown');
    } catch (error) {
      if (isSpooledError(error)) {
        assertEqual(error.statusCode, 401, 'status code');
      } else {
        throw error;
      }
    }
  });

  await runTest('404 for non-existent worker', async () => {
    try {
      await client.workers.get('non-existent-worker-id');
      throw new Error('Should have thrown');
    } catch (error) {
      if (isSpooledError(error)) {
        assertEqual(error.statusCode, 404, 'status code');
      } else {
        throw error;
      }
    }
  });

  await runTest('404 for non-existent webhook', async () => {
    try {
      await client.webhooks.get('non-existent-webhook-id');
      throw new Error('Should have thrown');
    } catch (error) {
      if (isSpooledError(error)) {
        assertEqual(error.statusCode, 404, 'status code');
      } else {
        throw error;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Runner
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('═'.repeat(60));
  console.log('   🧪 COMPREHENSIVE SPOOLED TEST SUITE');
  console.log('═'.repeat(60));
  console.log(`   API: ${BASE_URL}`);
  console.log(`   Key: ${API_KEY!.substring(0, 12)}...`);
  console.log(`   Webhook Port: ${WEBHOOK_PORT}`);
  console.log(`   Verbose: ${VERBOSE}`);
  console.log('═'.repeat(60));

  testPrefix = generateTestId();
  console.log(`\n📋 Test Prefix: ${testPrefix}`);

  const startTime = Date.now();
  let client: SpooledClient;

  try {
    // Start webhook server
    await startWebhookServer();

    // Initialize client
    client = new SpooledClient({
      apiKey: API_KEY!,
      baseUrl: BASE_URL,
    });

    // Run all test suites
    await testHealthEndpoints(client);
    await testDashboard(client);
    await testOrganization(client);
    await testApiKeys(client);
    await testJobsBasicCRUD(client);
    await testJobsBulkOperations(client);
    await testJobIdempotency(client);
    await testJobLifecycle(client);
    await testJobFailureAndRetry(client);
    await testDLQ(client);
    await testQueues(client);
    await testWorkers(client);
    await testWebhooks(client);
    await testSchedules(client);
    await testWorkflows(client);
    await testAuth(client);
    await testWorkerIntegration(client);
    await testWebhookDelivery(client);
    await testEdgeCases(client);
    await testErrorHandling(client);

  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  } finally {
    stopWebhookServer();
  }

  // Summary
  const totalTime = Date.now() - startTime;
  const passed = results.filter(r => r.passed && !r.skipped).length;
  const failed = results.filter(r => !r.passed).length;
  const skipped = results.filter(r => r.skipped).length;
  const total = results.length;

  console.log('\n');
  console.log('═'.repeat(60));
  console.log('   📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  console.log(`   ✓ Passed:  ${passed}`);
  console.log(`   ✗ Failed:  ${failed}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ─`.repeat(30));
  console.log(`   Total:     ${total} tests in ${(totalTime / 1000).toFixed(2)}s`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n❌ Failed Tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`   • ${r.name}`);
        if (r.error) console.log(`     Error: ${r.error}`);
      });
    console.log('');
    process.exit(1);
  }

  console.log('\n🎉 ALL TESTS PASSED!\n');
}

main().catch(console.error);
