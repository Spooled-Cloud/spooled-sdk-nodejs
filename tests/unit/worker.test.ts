/**
 * Worker runtime tests
 */

import { describe, it, expect, vi } from 'vitest';
import { SpooledWorker } from '../../src/worker/worker.js';

/** Build a minimal fake SpooledClient for the worker to drive. */
function makeFakeClient() {
  const heartbeat = vi.fn().mockResolvedValue({ success: true });
  const fail = vi.fn().mockResolvedValue({ success: true });
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
      complete: vi.fn().mockResolvedValue({ success: true }),
      fail,
      heartbeat,
    },
  } as any;

  return { client, heartbeat, fail, claim };
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
