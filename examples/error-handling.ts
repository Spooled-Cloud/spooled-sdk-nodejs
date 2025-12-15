/**
 * Error Handling Example
 *
 * This example demonstrates how to handle errors from the SDK.
 *
 * Run with: npx ts-node examples/error-handling.ts
 */

import {
  SpooledClient,
  SpooledError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
  CircuitBreakerOpenError,
  isSpooledError,
} from '../src/index.js';

async function main() {
  console.log('=== Spooled Error Handling Example ===\n');

  const client = new SpooledClient({
    apiKey: process.env.SPOOLED_API_KEY || 'sk_test_example',
    baseUrl: process.env.SPOOLED_API_URL || 'https://api.spooled.cloud',
    timeout: 5000, // 5 second timeout
    retries: 2, // Retry twice
  });

  // Example 1: Handle specific error types
  console.log('1. Fetching a non-existent job...');
  try {
    await client.jobs.get('non-existent-job-id');
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.log(`   NotFoundError: ${error.message}`);
      console.log(`   Code: ${error.code}`);
      console.log(`   Status: ${error.statusCode}`);
    }
  }
  console.log();

  // Example 2: Using type guard
  console.log('2. Using isSpooledError type guard...');
  try {
    await client.jobs.get('another-fake-id');
  } catch (error) {
    if (isSpooledError(error)) {
      console.log(`   SpooledError caught: ${error.name}`);
      console.log(`   Message: ${error.message}`);
      console.log(`   Is retryable: ${error.isRetryable()}`);
    } else {
      console.log(`   Non-SDK error: ${error}`);
    }
  }
  console.log();

  // Example 3: Switch on error type
  console.log('3. Handling multiple error types...');
  try {
    // This might fail with various errors
    await client.jobs.create({
      queueName: '', // Invalid - will cause validation error
      payload: {},
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      console.log(`   Validation failed: ${error.message}`);
      console.log(`   Details: ${JSON.stringify(error.details)}`);
    } else if (error instanceof AuthenticationError) {
      console.log(`   Authentication failed - check your API key`);
    } else if (error instanceof RateLimitError) {
      console.log(`   Rate limited - wait ${error.getRetryAfter()} seconds`);
    } else if (error instanceof ServerError) {
      console.log(`   Server error (${error.statusCode}): ${error.message}`);
    } else if (error instanceof NetworkError) {
      console.log(`   Network error: ${error.message}`);
    } else if (error instanceof TimeoutError) {
      console.log(`   Request timed out after ${error.timeoutMs}ms`);
    } else if (error instanceof CircuitBreakerOpenError) {
      console.log(`   Circuit breaker open - service is temporarily unavailable`);
    } else if (isSpooledError(error)) {
      console.log(`   Other API error: ${error.message}`);
    } else {
      console.log(`   Unexpected error: ${error}`);
    }
  }
  console.log();

  // Example 4: Getting error details for logging
  console.log('4. Logging error details...');
  try {
    await client.jobs.get('fake-id');
  } catch (error) {
    if (isSpooledError(error)) {
      console.log('   Error JSON:', JSON.stringify(error.toJSON(), null, 2));
    }
  }
  console.log();

  // Example 5: Circuit breaker stats
  console.log('5. Circuit breaker status...');
  const stats = client.getCircuitBreakerStats();
  console.log(`   State: ${stats.state}`);
  console.log(`   Failure count: ${stats.failureCount}`);
  console.log(`   Config: threshold=${stats.config.failureThreshold}`);
  console.log();

  console.log('=== Error Handling Example Complete ===');
}

main().catch(console.error);
