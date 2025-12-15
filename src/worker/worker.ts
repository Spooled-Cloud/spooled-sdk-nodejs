/**
 * Spooled Worker
 *
 * Worker runtime for processing jobs from a queue.
 */

import type { SpooledClient } from '../client.js';
import type { JsonObject } from '../types/common.js';
import type { ClaimedJob } from '../types/jobs.js';
import type {
  SpooledWorkerOptions,
  WorkerState,
  JobHandler,
  JobContext,
  WorkerEvent,
  WorkerEventData,
  ActiveJob,
} from './types.js';
import { hostname as osHostname } from 'os';

/** Default options */
const DEFAULT_OPTIONS = {
  concurrency: 5,
  pollInterval: 1000,
  leaseDuration: 30,
  heartbeatFraction: 0.5,
  autoStart: false,
  shutdownTimeout: 30000,
} as const;

/** Event handler type */
type EventHandler<E extends WorkerEvent> = (data: WorkerEventData[E]) => void;

/**
 * Spooled Worker
 *
 * @example
 * ```typescript
 * const worker = new SpooledWorker(client, {
 *   queueName: 'my-queue',
 *   concurrency: 10,
 * });
 *
 * worker.process(async (ctx) => {
 *   console.log('Processing job:', ctx.jobId);
 *   await doSomeWork(ctx.payload);
 *   return { success: true };
 * });
 *
 * await worker.start();
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => worker.stop());
 * ```
 */
export class SpooledWorker {
  private readonly client: SpooledClient;
  private readonly options: Required<SpooledWorkerOptions>;
  private readonly debug: (msg: string, meta?: unknown) => void;

  private state: WorkerState = 'idle';
  private workerId: string | null = null;
  private handler: JobHandler | null = null;
  private activeJobs: Map<string, ActiveJob> = new Map();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private workerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  // Event handlers
  private eventHandlers: Map<WorkerEvent, Set<EventHandler<WorkerEvent>>> = new Map();

  constructor(client: SpooledClient, options: SpooledWorkerOptions) {
    this.client = client;
    this.options = {
      ...DEFAULT_OPTIONS,
      hostname: osHostname(),
      workerType: 'nodejs',
      version: '1.0.3',
      metadata: {},
      ...options,
    } as Required<SpooledWorkerOptions>;

    // Get debug from client config
    const config = client.getConfig();
    this.debug = config.debug ?? (() => {});

    if (this.options.autoStart) {
      // Defer to next tick to allow process() to be called
      setImmediate(() => this.start());
    }
  }

  /**
   * Get current worker state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get worker ID (available after start)
   */
  getWorkerId(): string | null {
    return this.workerId;
  }

  /**
   * Get number of active jobs
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Register job handler
   */
  process(handler: JobHandler): void {
    if (this.state !== 'idle') {
      throw new Error('Cannot set handler after worker has started');
    }
    this.handler = handler;
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start worker in state: ${this.state}`);
    }

    if (!this.handler) {
      throw new Error('No job handler registered. Call process() first.');
    }

    this.state = 'starting';
    this.debug(`Starting worker for queue: ${this.options.queueName}`);

    try {
      // Register with the API
      const registration = await this.client.workers.register({
        queueName: this.options.queueName,
        hostname: this.options.hostname,
        workerType: this.options.workerType,
        maxConcurrency: this.options.concurrency,
        metadata: this.options.metadata,
        version: this.options.version,
      });

      this.workerId = registration.id;
      this.debug(`Worker registered: ${this.workerId}`, registration);

      // Start worker heartbeat
      const heartbeatInterval = registration.heartbeatIntervalSecs * 1000;
      this.workerHeartbeatTimer = setInterval(() => {
        this.sendWorkerHeartbeat();
      }, heartbeatInterval);

      // Start polling
      this.state = 'running';
      this.emit('started', { workerId: this.workerId, queueName: this.options.queueName });
      this.schedulePoll();
    } catch (error) {
      this.state = 'error';
      this.emit('error', { error: error as Error });
      throw error;
    }
  }

  /**
   * Stop the worker gracefully
   */
  async stop(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    // Deduplicate concurrent stop calls
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.doStop();
    return this.shutdownPromise;
  }

  private async doStop(): Promise<void> {
    this.state = 'stopping';
    this.debug('Stopping worker...');

    // Stop polling
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop worker heartbeat
    if (this.workerHeartbeatTimer) {
      clearInterval(this.workerHeartbeatTimer);
      this.workerHeartbeatTimer = null;
    }

    // Signal all active jobs to stop
    for (const active of this.activeJobs.values()) {
      active.abortController.abort();
    }

    // Wait for active jobs to complete (with timeout)
    if (this.activeJobs.size > 0) {
      this.debug(`Waiting for ${this.activeJobs.size} active jobs to complete...`);

      await Promise.race([
        this.waitForActiveJobs(),
        this.sleep(this.options.shutdownTimeout),
      ]);

      // Force-fail any remaining jobs
      for (const [jobId, active] of this.activeJobs.entries()) {
        this.debug(`Force-failing job ${jobId} due to shutdown timeout`);
        await this.failJob(active.job, 'Worker shutdown timeout');
      }
    }

    // Deregister worker
    if (this.workerId) {
      try {
        await this.client.workers.deregister(this.workerId);
        this.debug('Worker deregistered');
      } catch (error) {
        this.debug('Failed to deregister worker', error);
      }
    }

    this.state = 'stopped';
    this.workerId = null;
    this.emit('stopped', { workerId: this.workerId ?? '', reason: 'graceful' });
    this.shutdownPromise = null;
  }

  /**
   * Add event listener
   */
  on<E extends WorkerEvent>(event: E, handler: EventHandler<E>): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler<WorkerEvent>);
    return () => this.off(event, handler);
  }

  /**
   * Remove event listener
   */
  off<E extends WorkerEvent>(event: E, handler: EventHandler<E>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<WorkerEvent>);
    }
  }

  // Private methods

  private emit<E extends WorkerEvent>(event: E, data: WorkerEventData[E]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          this.debug('Event handler error', { event, error });
        }
      });
    }
  }

  private schedulePoll(): void {
    if (this.state !== 'running') {
      return;
    }

    this.pollTimer = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  private async poll(): Promise<void> {
    if (this.state !== 'running' || !this.workerId) {
      return;
    }

    // Check if we have capacity
    const availableSlots = this.options.concurrency - this.activeJobs.size;
    if (availableSlots <= 0) {
      this.schedulePoll();
      return;
    }

    try {
      // Claim jobs
      const result = await this.client.jobs.claim({
        queueName: this.options.queueName,
        workerId: this.workerId,
        limit: availableSlots,
        leaseDurationSecs: this.options.leaseDuration,
      });

      // Process claimed jobs
      for (const job of result.jobs) {
        this.processJob(job);
      }
    } catch (error) {
      this.debug('Poll failed', error);
      this.emit('error', { error: error as Error });
    }

    // Schedule next poll
    this.schedulePoll();
  }

  private processJob(job: ClaimedJob): void {
    this.emit('job:claimed', { jobId: job.id, queueName: job.queueName });

    const abortController = new AbortController();
    const activeJob: ActiveJob = {
      job,
      startedAt: new Date(),
      abortController,
    };

    this.activeJobs.set(job.id, activeJob);

    // Start per-job heartbeat
    const heartbeatInterval = this.options.leaseDuration * this.options.heartbeatFraction * 1000;
    activeJob.heartbeatTimer = setInterval(() => {
      this.sendJobHeartbeat(job.id);
    }, heartbeatInterval);

    // Execute handler
    this.executeHandler(activeJob);
  }

  private async executeHandler(activeJob: ActiveJob): Promise<void> {
    const { job, abortController } = activeJob;
    const { signal } = abortController;

    this.emit('job:started', { jobId: job.id, queueName: job.queueName });

    const context: JobContext = {
      jobId: job.id,
      queueName: job.queueName,
      payload: job.payload,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      signal,
      progress: async (_percent: number, _message?: string) => {
        // Progress tracking could be implemented via heartbeat metadata
        // For now, this is a no-op
      },
      log: (level, message, meta) => {
        this.debug(`[${job.id}] [${level}] ${message}`, meta);
      },
    };

    try {
      const result = await this.handler!(context);

      // Check if aborted
      if (signal.aborted) {
        this.debug(`Job ${job.id} was aborted`);
        return;
      }

      // Complete the job
      await this.completeJob(job, result ?? undefined);
    } catch (error) {
      // Check if aborted
      if (signal.aborted) {
        this.debug(`Job ${job.id} was aborted`);
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.failJob(job, errorMessage);
    } finally {
      this.cleanupJob(job.id);
    }
  }

  private async completeJob(job: ClaimedJob, result?: JsonObject): Promise<void> {
    if (!this.workerId) return;

    try {
      await this.client.jobs.complete(job.id, {
        workerId: this.workerId,
        result,
      });

      this.emit('job:completed', {
        jobId: job.id,
        queueName: job.queueName,
        result,
      });
    } catch (error) {
      this.debug(`Failed to complete job ${job.id}`, error);
    }
  }

  private async failJob(job: ClaimedJob, errorMessage: string): Promise<void> {
    if (!this.workerId) return;

    const willRetry = job.retryCount < job.maxRetries;

    try {
      await this.client.jobs.fail(job.id, {
        workerId: this.workerId,
        error: errorMessage,
      });

      this.emit('job:failed', {
        jobId: job.id,
        queueName: job.queueName,
        error: errorMessage,
        willRetry,
      });
    } catch (error) {
      this.debug(`Failed to fail job ${job.id}`, error);
    }
  }

  private cleanupJob(jobId: string): void {
    const activeJob = this.activeJobs.get(jobId);
    if (activeJob?.heartbeatTimer) {
      clearInterval(activeJob.heartbeatTimer);
    }
    this.activeJobs.delete(jobId);
  }

  private async sendJobHeartbeat(jobId: string): Promise<void> {
    if (!this.workerId) return;

    try {
      await this.client.jobs.heartbeat(jobId, {
        workerId: this.workerId,
        leaseDurationSecs: this.options.leaseDuration,
      });
    } catch (error) {
      this.debug(`Job heartbeat failed for ${jobId}`, error);
    }
  }

  private async sendWorkerHeartbeat(): Promise<void> {
    if (!this.workerId || this.state !== 'running') return;

    try {
      await this.client.workers.heartbeat(this.workerId, {
        currentJobs: this.activeJobs.size,
        status: 'healthy',
      });
    } catch (error) {
      this.debug('Worker heartbeat failed', error);
    }
  }

  private async waitForActiveJobs(): Promise<void> {
    while (this.activeJobs.size > 0) {
      await this.sleep(100);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
