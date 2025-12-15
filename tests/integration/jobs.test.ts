/**
 * Jobs Integration Tests
 *
 * These tests run against a real backend.
 * Set the following environment variables:
 *   SPOOLED_API_URL - Base URL for the API
 *   SPOOLED_API_KEY - API key for authentication
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SpooledClient } from '../../src/client.js';

describe('Jobs Integration', () => {
  let client: SpooledClient;
  let createdJobIds: string[] = [];

  beforeAll(() => {
    const apiKey = process.env.SPOOLED_API_KEY;
    const baseUrl = process.env.SPOOLED_API_URL || 'http://localhost:3000';

    if (!apiKey) {
      throw new Error('SPOOLED_API_KEY environment variable is required');
    }

    client = new SpooledClient({ apiKey, baseUrl });
  });

  afterAll(async () => {
    // Clean up created jobs
    for (const jobId of createdJobIds) {
      try {
        await client.jobs.cancel(jobId);
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  it('should create a job', async () => {
    const result = await client.jobs.create({
      queueName: 'test-queue',
      payload: { message: 'Hello from integration test' },
    });

    expect(result.id).toBeTruthy();
    expect(result.created).toBe(true);
    createdJobIds.push(result.id);
  });

  it('should get a job by ID', async () => {
    const createResult = await client.jobs.create({
      queueName: 'test-queue',
      payload: { key: 'value' },
    });
    createdJobIds.push(createResult.id);

    const job = await client.jobs.get(createResult.id);

    expect(job.id).toBe(createResult.id);
    expect(job.queueName).toBe('test-queue');
    expect(job.payload).toEqual({ key: 'value' });
  });

  it('should list jobs', async () => {
    const jobs = await client.jobs.list({ limit: 10 });
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('should list jobs filtered by queue', async () => {
    const jobs = await client.jobs.list({
      queueName: 'test-queue',
      limit: 10,
    });

    for (const job of jobs) {
      expect(job.queueName).toBe('test-queue');
    }
  });

  it('should create job with options', async () => {
    const result = await client.jobs.create({
      queueName: 'test-queue',
      payload: { data: 'test' },
      priority: 5,
      maxRetries: 5,
      timeoutSeconds: 120,
      tags: { env: 'test', type: 'integration' },
    });

    createdJobIds.push(result.id);

    const job = await client.jobs.get(result.id);
    expect(job.priority).toBe(5);
    expect(job.maxRetries).toBe(5);
    expect(job.timeoutSeconds).toBe(120);
    expect(job.tags).toEqual({ env: 'test', type: 'integration' });
  });

  it('should cancel a job', async () => {
    const result = await client.jobs.create({
      queueName: 'test-queue',
      payload: { toCancel: true },
    });

    await client.jobs.cancel(result.id);

    const job = await client.jobs.get(result.id);
    expect(job.status).toBe('cancelled');
  });

  it('should get job stats', async () => {
    const stats = await client.jobs.getStats();

    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('total');
  });

  it('should bulk enqueue jobs', async () => {
    const result = await client.jobs.bulkEnqueue({
      queueName: 'test-queue',
      jobs: [
        { payload: { batch: 1 } },
        { payload: { batch: 2 } },
        { payload: { batch: 3 } },
      ],
    });

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.succeeded).toHaveLength(3);

    for (const success of result.succeeded) {
      createdJobIds.push(success.jobId);
    }
  });

  it('should get batch status', async () => {
    const createResults = await Promise.all([
      client.jobs.create({ queueName: 'test-queue', payload: { n: 1 } }),
      client.jobs.create({ queueName: 'test-queue', payload: { n: 2 } }),
    ]);

    const ids = createResults.map((r) => r.id);
    createdJobIds.push(...ids);

    const statuses = await client.jobs.batchStatus(ids);
    expect(statuses).toHaveLength(2);

    for (const status of statuses) {
      expect(ids).toContain(status.id);
    }
  });
});
