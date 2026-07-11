/**
 * Worker runtime tests
 */

import { describe, it, expect, vi } from 'vitest';
import { SpooledWorker } from '../../src/worker/worker.js';

/** Build a minimal fake SpooledClient for the worker to drive. */
function makeFakeClient(jobOverrides: Record<string, unknown> = {}) {
  const heartbeat = vi.fn().mockResolvedValue({ success: true });
  const fail = vi.fn().mockResolvedValue({ success: true });
  const complete = vi.fn().mockResolvedValue({ success: true });
  const claim = vi
    .fn()
    .mockResolvedValueOnce({
      jobs: [
        {
          id: 'job_1',
          queueName: 'q',
          payload: {},
          retryCount: 0,
          maxRetries: 3,
          ...jobOverrides,
        },
      ],
    })
    .mockResolvedValue({ jobs: [] });

  const client = {
    getConfig: () => ({ debug: null }),
    workers: {
      register: vi.fn().mockResolvedValue({ id: 'w1', heartbeatIntervalSecs: 1000 }),
      heartbeat: vi.fn().mockResolvedValue({}),
      deregister: vi.fn().mockResolvedValue({}),
    },
    jobs: {
      claim,
      complete,
      fail,
      heartbeat,
    },
  } as any;

  return { client, heartbeat, fail, complete, claim };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SpooledWorker shutdown', () => {
  it('clears per-job heartbeat timers when force-failing on shutdown timeout', async () => {
    const { client, heartbeat, fail } = makeFakeClient();

    const worker = new SpooledWorker(client, {
      queueName: 'q',
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 5,
      // 5s * 0.002 * 1000 = 10ms heartbeat interval
      heartbeatFraction: 0.002,
      shutdownTimeout: 30,
    });

    // Handler that ignores the abort signal and never resolves — the finally
    // that normally clears the heartbeat timer will never run.
    worker.process(() => new Promise<void>(() => {}));

    await worker.start();

    // Let the poll claim the job and a few heartbeats fire.
    await wait(40);
    expect(worker.getActiveJobCount()).toBe(1);
    expect(heartbeat.mock.calls.length).toBeGreaterThan(0);

    await worker.stop();

    // Job was force-failed and removed from the active set.
    expect(fail).toHaveBeenCalledWith('job_1', expect.objectContaining({ error: 'Worker shutdown timeout' }));
    expect(worker.getActiveJobCount()).toBe(0);

    // The heartbeat interval must be cleared — no further heartbeats fire.
    const callsAfterStop = heartbeat.mock.calls.length;
    await wait(40);
    expect(heartbeat.mock.calls.length).toBe(callsAfterStop);
  });
});

describe('SpooledWorker lease fencing', () => {
  it('echoes the claimed leaseId on heartbeat and complete', async () => {
    const { client, heartbeat, complete } = makeFakeClient({ leaseId: 'lease_1' });

    const worker = new SpooledWorker(client, {
      queueName: 'q',
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 5,
      // 5s * 0.002 * 1000 = 10ms heartbeat interval
      heartbeatFraction: 0.002,
    });

    // Handler that runs long enough for a few heartbeats to fire.
    worker.process(async () => {
      await wait(40);
      return { ok: true };
    });

    await worker.start();
    await wait(100);
    await worker.stop();

    expect(heartbeat).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({ workerId: 'w1', leaseId: 'lease_1' })
    );
    expect(complete).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({ workerId: 'w1', leaseId: 'lease_1' })
    );
  });

  it('echoes the claimed leaseId on fail', async () => {
    const { client, fail } = makeFakeClient({ leaseId: 'lease_1' });

    const worker = new SpooledWorker(client, {
      queueName: 'q',
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 5,
    });

    worker.process(() => {
      throw new Error('boom');
    });

    await worker.start();
    await wait(40);
    await worker.stop();

    expect(fail).toHaveBeenCalledWith(
      'job_1',
      expect.objectContaining({ workerId: 'w1', error: 'boom', leaseId: 'lease_1' })
    );
  });

  it('omits leaseId when the claim did not include one', async () => {
    const { client, complete } = makeFakeClient();

    const worker = new SpooledWorker(client, {
      queueName: 'q',
      concurrency: 1,
      pollInterval: 5,
      leaseDuration: 5,
    });

    worker.process(async () => ({ ok: true }));

    await worker.start();
    await wait(40);
    await worker.stop();

    expect(complete).toHaveBeenCalledTimes(1);
    const params = complete.mock.calls[0][1];
    expect('leaseId' in params).toBe(false);
  });
});
