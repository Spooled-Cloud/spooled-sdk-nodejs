/**
 * Queues Integration Tests
 *
 * These tests run against a real backend.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SpooledClient } from '../../src/client.js';

describe('Queues Integration', () => {
  let client: SpooledClient;

  beforeAll(() => {
    const apiKey = process.env.SPOOLED_API_KEY;
    const baseUrl = process.env.SPOOLED_API_URL || 'http://localhost:3000';

    if (!apiKey) {
      throw new Error('SPOOLED_API_KEY environment variable is required');
    }

    client = new SpooledClient({ apiKey, baseUrl });
  });

  it('should list queues', async () => {
    const queues = await client.queues.list();
    expect(Array.isArray(queues)).toBe(true);
  });

  it('should get queue stats', async () => {
    // First create a job to ensure the queue exists
    await client.jobs.create({
      queueName: 'test-queue',
      payload: { test: true },
    });

    const stats = await client.queues.getStats('test-queue');

    expect(stats.queueName).toBe('test-queue');
    expect(stats).toHaveProperty('pendingJobs');
    expect(stats).toHaveProperty('processingJobs');
  });

  it('should pause and resume a queue', async () => {
    // First create a job to ensure the queue exists
    await client.jobs.create({
      queueName: 'test-pause-queue',
      payload: { test: true },
    });

    const pauseResult = await client.queues.pause('test-pause-queue', 'Integration test');
    expect(pauseResult.paused).toBe(true);
    expect(pauseResult.reason).toBe('Integration test');

    const resumeResult = await client.queues.resume('test-pause-queue');
    expect(resumeResult.resumed).toBe(true);
  });
});
