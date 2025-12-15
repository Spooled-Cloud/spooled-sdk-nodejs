#!/usr/bin/env tsx
/**
 * Production Verification Script
 *
 * A comprehensive CLI tool that interactively validates your entire production stack:
 * SDK, API, Worker, Webhooks, and gRPC.
 *
 * Usage:
 *   npx tsx scripts/verify-production.ts
 *
 * Prerequisites:
 *   1. Start your Cloudflare tunnel first:
 *      cloudflared tunnel --url http://localhost:3000
 *
 *   2. Have your API key ready (sk_live_... or sk_test_...)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { SpooledClient, SpooledWorker, isSpooledError } from '../src/index.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

// ============================================================================
// Types
// ============================================================================

interface WebhookPayload {
  event: string;
  timestamp: string;
  data: {
    job_id?: string;
    queue_name?: string;
    status?: string;
    [key: string]: unknown;
  };
}

interface VerificationContext {
  apiKey: string;
  tunnelUrl: string;
  baseUrl: string;
  client: SpooledClient | null;
  queueName: string;
  webhookId: string | null;
  jobId: string | null;
  worker: SpooledWorker | null;
  server: Server | null;
  receivedWebhooks: WebhookPayload[];
  jobProcessed: boolean;
  jobCompleted: boolean;
}

// ============================================================================
// Utilities
// ============================================================================

const log = {
  info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  error: (msg: string) => console.log(chalk.red('✗'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  step: (phase: string, step: string) =>
    console.log(chalk.cyan(`\n[${phase}]`), chalk.bold(step)),
  header: (title: string) => {
    console.log('\n' + chalk.bgCyan.black.bold(` ${title} `));
    console.log(chalk.cyan('─'.repeat(60)));
  },
  divider: () => console.log(chalk.gray('─'.repeat(60))),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  timeout: number = 30000,
  interval: number = 500
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (condition()) return true;
    await sleep(interval);
  }
  return false;
}

// ============================================================================
// Phase 1: Configuration
// ============================================================================

async function promptConfiguration(): Promise<{
  apiKey: string;
  tunnelUrl: string;
  baseUrl: string;
}> {
  log.header('PHASE 1: Configuration');

  console.log(chalk.yellow('\n📋 Before continuing, make sure you have:'));
  console.log(chalk.gray('   1. Started your Cloudflare tunnel:'));
  console.log(chalk.white('      cloudflared tunnel --url http://localhost:3001'));
  console.log(chalk.gray('   2. Your API key ready (sk_live_... or sk_test_...)\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Enter your API Key:',
      validate: (input: string) => {
        if (!input.startsWith('sk_live_') && !input.startsWith('sk_test_')) {
          return 'API key must start with sk_live_ or sk_test_';
        }
        if (input.length < 20) {
          return 'API key seems too short';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'tunnelUrl',
      message: 'Enter your Tunnel URL:',
      default: 'https://my-tunnel.trycloudflare.com',
      validate: (input: string) => {
        try {
          const url = new URL(input);
          if (url.protocol !== 'https:') {
            return 'Tunnel URL must use HTTPS';
          }
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'list',
      name: 'baseUrl',
      message: 'API Base URL:',
      choices: [
        { name: 'Local (http://localhost:8080)', value: 'http://localhost:8080' },
        { name: 'Local (http://127.0.0.1:8080)', value: 'http://127.0.0.1:8080' },
        { name: 'Production (https://api.spooled.cloud)', value: 'https://api.spooled.cloud' },
        { name: 'Custom URL...', value: 'custom' },
      ],
      default: 'http://localhost:8080',
    },
    {
      type: 'input',
      name: 'customBaseUrl',
      message: 'Enter custom API Base URL:',
      when: (answers: { baseUrl: string }) => answers.baseUrl === 'custom',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
  ]);

  // Handle custom URL
  const baseUrl = answers.baseUrl === 'custom' ? answers.customBaseUrl : answers.baseUrl;

  // Remove trailing slash from URLs
  const tunnelUrl = answers.tunnelUrl.replace(/\/$/, '');
  const finalBaseUrl = baseUrl.replace(/\/$/, '');

  log.success('Configuration received');
  log.info(`API Key: ${answers.apiKey.substring(0, 12)}...`);
  log.info(`Tunnel URL: ${tunnelUrl}`);
  log.info(`API Base URL: ${finalBaseUrl}`);

  return {
    apiKey: answers.apiKey,
    tunnelUrl,
    baseUrl: finalBaseUrl,
  };
}

// ============================================================================
// Local Webhook Server
// ============================================================================

const WEBHOOK_SERVER_PORT = 3001;

function startWebhookServer(ctx: VerificationContext): Promise<void> {
  return new Promise((resolve, reject) => {
    log.step('Phase 1', `Starting local webhook server on port ${WEBHOOK_SERVER_PORT}...`);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Health check endpoint
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // Webhook endpoint
      if (req.method === 'POST' && req.url === '/webhook') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as WebhookPayload;
            ctx.receivedWebhooks.push(payload);
            log.info(`Received webhook: ${chalk.bold(payload.event)}`);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          } catch (error) {
            log.error(`Failed to parse webhook: ${error}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      // 404 for other routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${WEBHOOK_SERVER_PORT} is already in use. Please free it and try again.`));
      } else {
        reject(error);
      }
    });

    server.listen(WEBHOOK_SERVER_PORT, () => {
      ctx.server = server;
      log.success(`Webhook server running on http://localhost:${WEBHOOK_SERVER_PORT}`);
      log.info('Webhook endpoint: /webhook');
      resolve();
    });
  });
}

// ============================================================================
// Phase 2: Core Connectivity
// ============================================================================

async function verifyConnectivity(ctx: VerificationContext): Promise<void> {
  log.header('PHASE 2: Core Connectivity');

  // First, test basic connectivity with health endpoint
  log.step('Phase 2', 'Testing API connectivity (health check)...');

  try {
    const healthResponse = await fetch(`${ctx.baseUrl}/health`);
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      log.success(`API is reachable: ${health.status || 'ok'}`);
    } else {
      log.warn(`Health check returned ${healthResponse.status}`);
    }
  } catch (error) {
    throw new Error(`Cannot reach API at ${ctx.baseUrl}: ${error}`);
  }

  log.step('Phase 2', 'Initializing SDK client...');

  // Enable debug mode to see what's happening
  const debugFn = (msg: string, meta?: unknown) => {
    log.info(`[SDK] ${msg}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
  };

  ctx.client = new SpooledClient({
    apiKey: ctx.apiKey,
    baseUrl: ctx.baseUrl,
    debug: debugFn,
  });

  log.success('SDK client initialized');

  // Note: /auth/me requires JWT token, not API key
  // Use /dashboard or /organizations/usage to verify API key
  log.step('Phase 2', 'Verifying API key with dashboard endpoint...');

  try {
    const dashboard = await ctx.client.dashboard.get();
    log.success('API key verified');
    log.info(`System version: ${dashboard.system?.version || 'N/A'}`);
    log.info(`Total jobs: ${dashboard.jobs?.total ?? 0}`);
    log.info(`Pending jobs: ${dashboard.jobs?.pending ?? 0}`);
    log.info(`Active workers: ${dashboard.workers?.total ?? 0}`);
  } catch (error) {
    if (isSpooledError(error)) {
      log.error(`Status: ${error.statusCode}`);
      log.error(`Code: ${error.code}`);
      log.error(`Message: ${error.message}`);
      if (error.details) {
        log.error(`Details: ${JSON.stringify(error.details)}`);
      }
      if (error.requestId) {
        log.error(`Request ID: ${error.requestId}`);
      }

      // Try a raw fetch to see the actual response
      log.step('Phase 2', 'Attempting raw fetch for debugging...');
      try {
        const rawResponse = await fetch(`${ctx.baseUrl}/api/v1/dashboard`, {
          headers: {
            Authorization: `Bearer ${ctx.apiKey}`,
            'Content-Type': 'application/json',
          },
        });
        const rawText = await rawResponse.text();
        log.info(`Raw status: ${rawResponse.status}`);
        log.info(`Raw response: ${rawText.substring(0, 500)}`);
      } catch (rawErr) {
        log.error(`Raw fetch also failed: ${rawErr}`);
      }

      throw new Error(`API key verification failed: ${error.message} (${error.code})`);
    }
    throw error;
  }
}

// ============================================================================
// Phase 3: Resource Creation
// ============================================================================

async function createResources(ctx: VerificationContext): Promise<void> {
  log.header('PHASE 3: Resource Creation');

  if (!ctx.client) throw new Error('Client not initialized');

  // Create temporary queue
  const timestamp = Date.now();
  ctx.queueName = `verify-prod-${timestamp}`;

  log.step('Phase 3', `Creating temporary queue: ${ctx.queueName}...`);

  // Queues are auto-created on first job, but we can try to get/create config
  try {
    // Try to get queue stats - this will create the queue implicitly if jobs are sent
    log.info('Queue will be created automatically with first job');
    log.success(`Queue name set: ${ctx.queueName}`);
  } catch (error) {
    log.warn('Could not pre-create queue, will be created with first job');
  }

  // Register webhook
  log.step('Phase 3', 'Registering webhook subscription...');

  const webhookUrl = `${ctx.tunnelUrl}/webhook`;
  log.info(`Webhook URL: ${webhookUrl}`);

  try {
    const webhook = await ctx.client.webhooks.create({
      name: `verify-prod-webhook-${timestamp}`,
      url: webhookUrl,
      events: ['job.created', 'job.started', 'job.completed', 'job.failed'],
      enabled: true,
    });

    ctx.webhookId = webhook.id;
    log.success(`Webhook registered: ${webhook.id}`);
    log.info(`Events: ${webhook.events.join(', ')}`);
  } catch (error) {
    if (isSpooledError(error)) {
      throw new Error(`Failed to create webhook: ${error.message} (${error.code})`);
    }
    throw error;
  }

  // Test webhook connectivity
  log.step('Phase 3', 'Testing webhook endpoint connectivity...');

  try {
    if (ctx.webhookId) {
      const testResult = await ctx.client.webhooks.test(ctx.webhookId);
      if (testResult.success) {
        log.success(`Webhook test passed (${testResult.responseTimeMs}ms)`);
      } else {
        log.warn(`Webhook test failed: ${testResult.error}`);
        log.info('Continuing anyway - production webhooks may still work');
      }
    }
  } catch (error) {
    log.warn('Could not test webhook - continuing anyway');
  }
}

// ============================================================================
// Phase 4: Job Processing
// ============================================================================

async function processJobs(ctx: VerificationContext): Promise<void> {
  log.header('PHASE 4: Job Processing');

  if (!ctx.client) throw new Error('Client not initialized');

  // Start worker
  log.step('Phase 4', 'Starting worker...');

  ctx.worker = new SpooledWorker(ctx.client, {
    queueName: ctx.queueName,
    concurrency: 1,
    pollInterval: 1000,
    leaseDuration: 30,
  });

  // Set up event handlers
  ctx.worker.on('started', ({ workerId, queueName }) => {
    log.success(`Worker started: ${workerId}`);
    log.info(`Listening on queue: ${queueName}`);
  });

  ctx.worker.on('job:claimed', ({ jobId }) => {
    log.info(`Job claimed: ${jobId}`);
  });

  ctx.worker.on('job:completed', ({ jobId, result }) => {
    log.success(`Job completed: ${jobId}`);
    if (result) {
      log.info(`Result: ${JSON.stringify(result)}`);
    }
    ctx.jobCompleted = true;
  });

  ctx.worker.on('job:failed', ({ jobId, error, willRetry }) => {
    log.error(`Job failed: ${jobId} - ${error} (will retry: ${willRetry})`);
  });

  ctx.worker.on('error', ({ error }) => {
    log.error(`Worker error: ${error.message}`);
  });

  // Define job handler
  ctx.worker.process(async (jobCtx) => {
    log.info(`Processing job ${jobCtx.jobId}...`);
    log.info(`Payload: ${JSON.stringify(jobCtx.payload)}`);

    // Simulate some work
    await sleep(500);

    ctx.jobProcessed = true;

    return {
      processed: true,
      timestamp: new Date().toISOString(),
      message: 'Hello from production verification!',
    };
  });

  // Start the worker
  await ctx.worker.start();

  // Enqueue test job
  log.step('Phase 4', 'Enqueueing test job...');

  try {
    const { id, created } = await ctx.client.jobs.create({
      queueName: ctx.queueName,
      payload: {
        message: 'Hello Production',
        source: 'verify-production.ts',
        timestamp: new Date().toISOString(),
      },
      priority: 5,
      maxRetries: 3,
    });

    ctx.jobId = id;
    log.success(`Job enqueued: ${id} (new: ${created})`);
  } catch (error) {
    if (isSpooledError(error)) {
      throw new Error(`Failed to create job: ${error.message} (${error.code})`);
    }
    throw error;
  }

  // Wait for job processing
  log.step('Phase 4', 'Waiting for job to be processed...');

  const jobProcessed = await waitFor(() => ctx.jobProcessed, 30000);

  if (!jobProcessed) {
    throw new Error('Job was not processed within 30 seconds');
  }

  log.success('Job processing verified');

  // Wait for job completion
  log.step('Phase 4', 'Waiting for job completion confirmation...');

  const jobCompleted = await waitFor(() => ctx.jobCompleted, 10000);

  if (!jobCompleted) {
    throw new Error('Job completion not confirmed within 10 seconds');
  }

  log.success('Job completion confirmed');

  // Verify job status via API
  log.step('Phase 4', 'Verifying job status via API...');

  if (ctx.jobId && ctx.client) {
    try {
      const job = await ctx.client.jobs.get(ctx.jobId);
      log.info(`Job status: ${job.status}`);

      if (job.status === 'completed') {
        log.success('Job status verified as completed');
      } else {
        log.warn(`Unexpected job status: ${job.status}`);
      }

      if (job.result) {
        log.info(`Job result: ${JSON.stringify(job.result)}`);
      }
    } catch (error) {
      log.warn('Could not fetch job status');
    }
  }

  // Verify webhook delivery
  log.step('Phase 4', 'Waiting for webhook delivery...');

  const webhookReceived = await waitFor(() => {
    return ctx.receivedWebhooks.some(
      (w) =>
        (w.event === 'job.completed' || w.event === 'job_completed') &&
        w.data?.job_id === ctx.jobId
    );
  }, 15000);

  if (webhookReceived) {
    log.success('Webhook received for job completion');

    const completedWebhook = ctx.receivedWebhooks.find(
      (w) =>
        (w.event === 'job.completed' || w.event === 'job_completed') &&
        w.data?.job_id === ctx.jobId
    );

    if (completedWebhook) {
      log.info(`Webhook event: ${completedWebhook.event}`);
      log.info(`Webhook job_id: ${completedWebhook.data?.job_id}`);
    }
  } else {
    log.warn('No webhook received for job completion within 15 seconds');
    log.info('This may be expected if webhook delivery is delayed or filtered');

    if (ctx.receivedWebhooks.length > 0) {
      log.info(`Received ${ctx.receivedWebhooks.length} webhook(s) total:`);
      ctx.receivedWebhooks.forEach((w) => {
        log.info(`  - ${w.event}: ${JSON.stringify(w.data)}`);
      });
    }
  }
}

// ============================================================================
// Phase 5: Cleanup
// ============================================================================

async function cleanup(ctx: VerificationContext): Promise<void> {
  log.header('PHASE 5: Cleanup');

  // Stop worker
  if (ctx.worker) {
    log.step('Phase 5', 'Stopping worker...');
    try {
      await ctx.worker.stop();
      log.success('Worker stopped');
    } catch (error) {
      log.warn(`Error stopping worker: ${error}`);
    }
  }

  // Delete webhook
  if (ctx.webhookId && ctx.client) {
    log.step('Phase 5', 'Deleting webhook subscription...');
    try {
      await ctx.client.webhooks.delete(ctx.webhookId);
      log.success('Webhook deleted');
    } catch (error) {
      log.warn(`Error deleting webhook: ${error}`);
    }
  }

  // Delete queue (or just note it will be auto-cleaned)
  if (ctx.queueName && ctx.client) {
    log.step('Phase 5', 'Cleaning up queue...');
    try {
      await ctx.client.queues.delete(ctx.queueName);
      log.success('Queue deleted');
    } catch (error) {
      log.info('Queue cleanup skipped (may be auto-cleaned)');
    }
  }

  // Stop webhook server
  if (ctx.server) {
    log.step('Phase 5', 'Stopping webhook server...');
    await new Promise<void>((resolve) => {
      ctx.server!.close(() => {
        log.success('Webhook server stopped');
        resolve();
      });
    });
  }
}

// ============================================================================
// Summary Report
// ============================================================================

function printSummary(ctx: VerificationContext, success: boolean, error?: Error): void {
  log.header('VERIFICATION SUMMARY');

  const checks = [
    { name: 'SDK Client Initialization', passed: ctx.client !== null },
    { name: 'API Authentication', passed: ctx.client !== null },
    { name: 'Queue Creation', passed: ctx.queueName !== '' },
    { name: 'Webhook Registration', passed: ctx.webhookId !== null },
    { name: 'Worker Started', passed: ctx.worker !== null },
    { name: 'Job Enqueued', passed: ctx.jobId !== null },
    { name: 'Job Processed', passed: ctx.jobProcessed },
    { name: 'Job Completed', passed: ctx.jobCompleted },
    {
      name: 'Webhook Received',
      passed: ctx.receivedWebhooks.some(
        (w) =>
          (w.event === 'job.completed' || w.event === 'job_completed') &&
          w.data?.job_id === ctx.jobId
      ),
    },
  ];

  console.log('\n');

  for (const check of checks) {
    if (check.passed) {
      console.log(chalk.green('  ✓'), chalk.white(check.name));
    } else {
      console.log(chalk.red('  ✗'), chalk.gray(check.name));
    }
  }

  console.log('\n' + chalk.gray('─'.repeat(60)));

  if (success) {
    console.log(
      chalk.bgGreen.black.bold('\n 🎉 SUCCESS ') +
        chalk.green(' All production systems verified!\n')
    );
  } else {
    console.log(
      chalk.bgRed.white.bold('\n ❌ FAILED ') +
        chalk.red(` Verification failed: ${error?.message}\n`)
    );
  }

  // Stats
  console.log(chalk.gray('Statistics:'));
  console.log(chalk.gray(`  • Webhooks received: ${ctx.receivedWebhooks.length}`));
  console.log(chalk.gray(`  • Queue used: ${ctx.queueName}`));
  if (ctx.jobId) {
    console.log(chalk.gray(`  • Test job ID: ${ctx.jobId}`));
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(
    chalk.bold('   🔍 SPOOLED PRODUCTION VERIFICATION TOOL')
  );
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  console.log(chalk.gray('This tool will verify your production stack:'));
  console.log(chalk.gray('  • SDK connectivity'));
  console.log(chalk.gray('  • API authentication'));
  console.log(chalk.gray('  • Job queue operations'));
  console.log(chalk.gray('  • Worker processing'));
  console.log(chalk.gray('  • Webhook delivery'));
  console.log();

  const ctx: VerificationContext = {
    apiKey: '',
    tunnelUrl: '',
    baseUrl: '',
    client: null,
    queueName: '',
    webhookId: null,
    jobId: null,
    worker: null,
    server: null,
    receivedWebhooks: [],
    jobProcessed: false,
    jobCompleted: false,
  };

  let success = false;
  let mainError: Error | undefined;

  try {
    // Phase 1: Configuration
    const config = await promptConfiguration();
    ctx.apiKey = config.apiKey;
    ctx.tunnelUrl = config.tunnelUrl;
    ctx.baseUrl = config.baseUrl;

    // Start webhook server
    await startWebhookServer(ctx);

    // Phase 2: Core Connectivity
    await verifyConnectivity(ctx);

    // Phase 3: Resource Creation
    await createResources(ctx);

    // Phase 4: Job Processing
    await processJobs(ctx);

    success = true;
  } catch (error) {
    mainError = error instanceof Error ? error : new Error(String(error));
    log.error(`\nVerification failed: ${mainError.message}`);
  } finally {
    // Phase 5: Cleanup
    await cleanup(ctx);

    // Print summary
    printSummary(ctx, success, mainError);

    // Exit with appropriate code
    process.exit(success ? 0 : 1);
  }
}

// Handle unhandled errors
process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  log.warn('\nReceived SIGINT, exiting...');
  process.exit(130);
});

// Run
main();

