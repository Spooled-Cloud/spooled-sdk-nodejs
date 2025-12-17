#!/usr/bin/env tsx
/**
 * Production test runner for scripts/test-local.ts.
 *
 * Safe defaults:
 * - Uses Spooled Cloud endpoints
 * - Skips stress/load tests unless --full is provided (to avoid noisy prod runs)
 *
 * Usage:
 *   API_KEY=sk_live_... npx tsx scripts/test-production.ts
 *
 * Options:
 *   --full     Run stress/load tests too (NOT recommended for prod)
 *   --verbose  Enable verbose output in test-local.ts
 *
 * Overrides (optional):
 *   BASE_URL=https://api.spooled.cloud
 *   GRPC_ADDRESS=grpc.spooled.cloud:443
 *   SKIP_GRPC=0|1
 *   SKIP_STRESS=0|1
 */
import { spawn } from 'child_process';

const argv = new Set(process.argv.slice(2));
const isFull = argv.has('--full');
const isVerbose = argv.has('--verbose');

const apiKey = process.env.API_KEY;
if (!apiKey) {
  console.error('❌ API_KEY is required');
  console.error('   Example: API_KEY=sk_live_... npx tsx scripts/test-production.ts');
  process.exit(1);
}

const baseUrl = process.env.BASE_URL || 'https://api.spooled.cloud';
const grpcAddress = process.env.GRPC_ADDRESS || 'grpc.spooled.cloud:443';

// Default to running gRPC tests in production (can be overridden)
const skipGrpc = process.env.SKIP_GRPC ?? '0';
// Default to skipping stress tests in production (can be overridden or --full)
const skipStress = isFull ? '0' : (process.env.SKIP_STRESS ?? '1');

// Run test-local.ts from the scripts directory
const child = spawn(
  'npx',
  ['tsx', 'scripts/test-local.ts'],
  {
    stdio: 'inherit',
    cwd: process.cwd().includes('scripts') ? '..' : '.',
    env: {
      ...process.env,
      API_KEY: apiKey,
      BASE_URL: baseUrl,
      GRPC_ADDRESS: grpcAddress,
      SKIP_GRPC: skipGrpc,
      SKIP_STRESS: skipStress,
      VERBOSE: isVerbose ? '1' : (process.env.VERBOSE ?? '0'),
    },
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
