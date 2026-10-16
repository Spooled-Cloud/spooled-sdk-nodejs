/**
 * Spooled Worker
 *
 * Worker runtime for processing jobs from a queue.
 */

import type { SpooledClient } from "../client.js";
import { SDK_VERSION } from "../config.js";
import { SpooledError } from "../errors.js";
import type { JsonValue } from "../types/common.js";
import type { ClaimedJob } from "../types/jobs.js";
import { coerceFailureMessage } from "../utils/failure.js";
import type {
  SpooledWorkerOptions,
  WorkerState,
  JobHandler,
  JobContext,
  WorkerEvent,
  WorkerEventData,
  ActiveJob,
} from "./types.js";
import { hostname as osHostname } from "os";

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

/** Failure text sent when a handler outlives the job's `timeoutSeconds`. */
const JOB_TIMEOUT_MESSAGE = "Job timeout exceeded";

/** Failure text sent for a handler still running when the shutdown grace ends. */
const SHUTDOWN_TIMEOUT_MESSAGE = "Worker shutdown timeout";

/** Longest delay `setTimeout` accepts (a larger one fires immediately). */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** How a handler run ended. Decided once per execution. */
type HandlerOutcome =
  | { kind: "returned"; value: JsonValue | void }
  | { kind: "threw"; error: unknown }
  | { kind: "timeout" };

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
  /**
   * Options with every defaultable field filled in. `workerId` stays optional:
   * there is no sensible default for it, and omitting it is what makes the
   * server mint a UUID.
   */
  private readonly options: Required<Omit<SpooledWorkerOptions, "workerId">> &
    Pick<SpooledWorkerOptions, "workerId">;
  private readonly debug: (msg: string, meta?: unknown) => void;

  private state: WorkerState = "idle";
  private workerId: string | null = null;
  private handler: JobHandler | null = null;
  private activeJobs: Map<symbol, ActiveJob> = new Map();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private workerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private shutdownPromise: Promise<void> | null = null;
  /** The claim request currently on the wire, so a stop can wait for its jobs. */
  private pollInFlight: Promise<void> | null = null;
  /** Wakes the shutdown drain when the last active job has been acked. */
  private drainWaiter: (() => void) | null = null;

  // Event handlers
  private eventHandlers: Map<WorkerEvent, Set<EventHandler<WorkerEvent>>> =
    new Map();

  constructor(client: SpooledClient, options: SpooledWorkerOptions) {
    this.client = client;
    this.options = {
      ...DEFAULT_OPTIONS,
      hostname: osHostname(),
      workerType: "nodejs",
      version: SDK_VERSION,
      metadata: {},
      ...options,
    } as Required<Omit<SpooledWorkerOptions, "workerId">> &
      Pick<SpooledWorkerOptions, "workerId">;

    // Get debug from client config
    const config = client.getConfig();
    this.debug = config.debug ?? (() => {});

    if (this.options.autoStart) {
      // Defer to next tick to allow process() to be called. start() already
      // reports a failed registration through the "error" event; the catch only
      // keeps it from becoming an unhandled rejection that crashes the process.
      setImmediate(() => {
        this.start().catch((error) => {
          this.debug("Auto-start failed", error);
        });
      });
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
    if (this.state !== "idle") {
      throw new Error("Cannot set handler after worker has started");
    }
    this.handler = handler;
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    if (this.state !== "idle") {
      throw new Error(`Cannot start worker in state: ${this.state}`);
    }

    if (!this.handler) {
      throw new Error("No job handler registered. Call process() first.");
    }

    this.state = "starting";
    this.debug(`Starting worker for queue: ${this.options.queueName}`);

    try {
      // Register with the API
      const registration = await this.client.workers.register({
        queueName: this.options.queueName,
        workerId: this.options.workerId,
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
      this.state = "running";
      this.emit("started", {
        workerId: this.workerId,
        queueName: this.options.queueName,
      });
      this.schedulePoll();
    } catch (error) {
      this.state = "error";
      this.emit("error", { error: error as Error });
      throw error;
    }
  }

  /**
   * Stop the worker gracefully.
   *
   * Drains: the worker stops claiming, then lets running handlers finish for
   * up to `shutdownTimeout`. A handler that returns completes its job and one
   * that throws fails it, even though a stop was requested meanwhile; its
   * `signal` is NOT aborted during the grace period. Only handlers still
   * running when the timeout ends are aborted and failed with "Worker shutdown
   * timeout". The worker deregisters last, because deregistering returns every
   * job the worker still holds to the queue.
   */
  async stop(): Promise<void> {
    if (this.state !== "running") {
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
    const deadline = Date.now() + this.options.shutdownTimeout;
    this.state = "stopping";
    this.debug("Stopping worker...");

    // Stop polling
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // A claim already on the wire still returns jobs this worker now holds
    // leases for. Let it land first so they join the drain below instead of
    // starting after the worker has deregistered.
    if (this.pollInFlight) {
      await this.pollInFlight;
    }

    // Drain: the worker heartbeat and every job heartbeat keep running while
    // handlers finish, so neither the worker nor a lease expires mid-drain.
    if (this.activeJobs.size > 0) {
      this.debug(
        `Waiting for ${this.activeJobs.size} active jobs to complete...`,
      );

      await this.waitForDrain(Math.max(0, deadline - Date.now()));

      // Whatever is still running outlived the grace period: abort and fail it.
      // A job whose handler returned just before the deadline is already
      // settled (its ack is in flight) and is awaited below, not failed.
      const stragglers = Array.from(this.activeJobs.values()).filter(
        (active) => !active.settled,
      );
      await Promise.all(stragglers.map((active) => this.abandonJob(active)));

      // Acks already on the wire must land before the worker deregisters,
      // otherwise deregistering re-queues a job that was just finished.
      await Promise.all(
        Array.from(this.activeJobs.values()).map((active) => active.ack),
      );
    }

    // Stop worker heartbeat
    if (this.workerHeartbeatTimer) {
      clearInterval(this.workerHeartbeatTimer);
      this.workerHeartbeatTimer = null;
    }

    // Deregister worker
    const workerId = this.workerId;
    if (workerId) {
      try {
        await this.client.workers.deregister(workerId);
        this.debug("Worker deregistered");
      } catch (error) {
        this.debug("Failed to deregister worker", error);
      }
    }

    this.state = "stopped";
    this.workerId = null;
    this.emit("stopped", { workerId: workerId ?? "", reason: "graceful" });
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

  private emit<E extends WorkerEvent>(
    event: E,
    data: WorkerEventData[E],
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          this.debug("Event handler error", { event, error });
        }
      });
    }
  }

  private schedulePoll(): void {
    if (this.state !== "running") {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      const run = this.poll();
      this.pollInFlight = run;
      const done = () => {
        if (this.pollInFlight === run) {
          this.pollInFlight = null;
        }
      };
      run.then(done, done);
    }, this.options.pollInterval);
  }

  private async poll(): Promise<void> {
    if (this.state !== "running" || !this.workerId) {
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
      this.debug("Poll failed", error);
      this.emit("error", { error: error as Error });
    }

    // Schedule next poll
    this.schedulePoll();
  }

  private processJob(job: ClaimedJob): void {
    this.emit("job:claimed", { jobId: job.id, queueName: job.queueName });

    const abortController = new AbortController();
    const activeJob: ActiveJob = {
      executionId: Symbol(job.id),
      job,
      startedAt: new Date(),
      abortController,
      settled: false,
    };

    this.activeJobs.set(activeJob.executionId, activeJob);

    // Capture the immutable execution so a replacement lease cannot be borrowed.
    const heartbeatInterval =
      this.options.leaseDuration * this.options.heartbeatFraction * 1000;
    activeJob.heartbeatTimer = setInterval(() => {
      this.sendJobHeartbeat(activeJob);
    }, heartbeatInterval);

    // Execute handler
    this.executeHandler(activeJob);
  }

  private async executeHandler(activeJob: ActiveJob): Promise<void> {
    const { job, abortController } = activeJob;
    const { signal } = abortController;

    this.emit("job:started", { jobId: job.id, queueName: job.queueName });

    const context: JobContext = {
      jobId: job.id,
      queueName: job.queueName,
      payload: job.payload,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      signal,
      progress: async (percent: number, message?: string) => {
        const boundedPercent = Math.max(0, Math.min(100, percent));
        this.debug(`[${job.id}] progress ${boundedPercent}%`, message);
      },
      log: (level, message, meta) => {
        this.debug(`[${job.id}] [${level}] ${message}`, meta);
      },
    };

    try {
      const outcome = await this.runHandler(activeJob, context);

      // A lost lease (heartbeat 409) means another worker may already be
      // running this job. Acking it would 409 and must not happen.
      if (activeJob.leaseLost) {
        this.debug(`Job ${job.id} lost its lease; dropping late result`);
        return;
      }
      // The shutdown drain already failed this job while its handler was still
      // running; the lease is gone, so a late result must not be sent.
      if (activeJob.settled) {
        this.debug(`Job ${job.id} was already settled; dropping late result`);
        return;
      }
      activeJob.settled = true;

      // The abort signal is only a hint to the handler. Whatever the handler
      // did decides the ack: a result that arrives after a stop was requested
      // is still sent, never silently dropped.
      switch (outcome.kind) {
        case "returned":
          activeJob.ack = this.completeJob(
            activeJob,
            outcome.value ?? undefined,
          );
          break;
        case "threw":
          activeJob.ack = this.failJob(
            activeJob,
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error),
          );
          break;
        case "timeout":
          // Stop the handler if it listens, then fail the job: extending the
          // lease of a hung handler forever would keep the job and its
          // concurrency slot stuck.
          abortController.abort(new Error(JOB_TIMEOUT_MESSAGE));
          this.emit("job:timeout", {
            jobId: job.id,
            queueName: job.queueName,
          });
          activeJob.ack = this.failJob(activeJob, JOB_TIMEOUT_MESSAGE);
          break;
      }
      await activeJob.ack;
    } finally {
      this.cleanupJob(activeJob);
    }
  }

  /**
   * Run the handler, racing it against the job's `timeoutSeconds`.
   * Never rejects: a throw (sync or async) is reported as an outcome.
   */
  private runHandler(
    activeJob: ActiveJob,
    context: JobContext,
  ): Promise<HandlerOutcome> {
    const run = (async (): Promise<HandlerOutcome> => {
      try {
        return { kind: "returned", value: await this.handler!(context) };
      } catch (error) {
        return { kind: "threw", error };
      }
    })();

    const { timeoutSeconds } = activeJob.job;
    if (typeof timeoutSeconds !== "number" || !(timeoutSeconds > 0)) {
      return run;
    }

    return new Promise<HandlerOutcome>((resolve) => {
      activeJob.timeoutTimer = setTimeout(
        () => resolve({ kind: "timeout" }),
        Math.min(timeoutSeconds * 1000, MAX_TIMER_MS),
      );
      run.then((outcome) => {
        this.clearTimeoutTimer(activeJob);
        resolve(outcome);
      });
    });
  }

  /** Abort a handler that outlived the shutdown grace period and fail its job. */
  private async abandonJob(activeJob: ActiveJob): Promise<void> {
    this.debug(`Force-failing job ${activeJob.job.id} due to shutdown timeout`);
    // Mark first: the handler may react to the abort, or finish later, and its
    // outcome must not be acked on top of this failure.
    activeJob.settled = true;
    activeJob.abortController.abort(new Error(SHUTDOWN_TIMEOUT_MESSAGE));
    activeJob.ack = this.failJob(activeJob, SHUTDOWN_TIMEOUT_MESSAGE);
    await activeJob.ack;
    // The handler's finally may never run if user code ignores the abort
    // signal, so explicitly clear this exact execution's timers.
    this.cleanupJob(activeJob);
  }

  private async completeJob(
    activeJob: ActiveJob,
    result?: JsonValue,
  ): Promise<void> {
    if (!this.workerId || activeJob.leaseLost) return;
    const { job } = activeJob;

    try {
      await this.client.jobs.complete(job.id, {
        workerId: this.workerId,
        result,
        ...(job.leaseId != null && { leaseId: job.leaseId }),
      });

      this.emit("job:completed", {
        jobId: job.id,
        queueName: job.queueName,
        result,
      });
    } catch (error) {
      // The lease was reclaimed between the handler returning and the ack.
      // The result belongs to whoever holds the job now; this is not a
      // worker failure.
      if (isLeaseExpired(error)) {
        this.noteLeaseLost(activeJob, error);
        return;
      }
      // The ack was already retried by the HTTP layer; what is left is a job
      // that finished but could not be reported.
      this.debug(`Failed to complete job ${job.id}`, error);
      this.emit("error", { error: error as Error });
    }
  }

  private async failJob(
    activeJob: ActiveJob,
    errorMessage: string,
  ): Promise<void> {
    if (!this.workerId || activeJob.leaseLost) return;
    const { job } = activeJob;

    const willRetry = job.retryCount < job.maxRetries;
    // The API rejects empty or over-long failure text with a 400, which would
    // leave the job processing until its lease expired.
    const message = coerceFailureMessage(errorMessage);

    try {
      await this.client.jobs.fail(job.id, {
        workerId: this.workerId,
        error: message,
        ...(job.leaseId != null && { leaseId: job.leaseId }),
      });

      this.emit("job:failed", {
        jobId: job.id,
        queueName: job.queueName,
        error: message,
        willRetry,
      });
    } catch (error) {
      if (isLeaseExpired(error)) {
        this.noteLeaseLost(activeJob, error);
        return;
      }
      this.debug(`Failed to fail job ${job.id}`, error);
      this.emit("error", { error: error as Error });
    }
  }

  private clearTimeoutTimer(activeJob: ActiveJob): void {
    if (activeJob.timeoutTimer) {
      clearTimeout(activeJob.timeoutTimer);
      activeJob.timeoutTimer = undefined;
    }
  }

  private cleanupJob(activeJob: ActiveJob): void {
    if (activeJob.heartbeatTimer) {
      clearInterval(activeJob.heartbeatTimer);
      activeJob.heartbeatTimer = undefined;
    }
    this.clearTimeoutTimer(activeJob);

    if (this.activeJobs.get(activeJob.executionId) === activeJob) {
      this.activeJobs.delete(activeJob.executionId);
      if (this.activeJobs.size === 0) {
        this.drainWaiter?.();
      }
    }
  }

  private async sendJobHeartbeat(activeJob: ActiveJob): Promise<void> {
    if (!this.workerId || activeJob.leaseLost) return;

    const { job } = activeJob;

    try {
      await this.client.jobs.heartbeat(job.id, {
        workerId: this.workerId,
        leaseDurationSecs: this.options.leaseDuration,
        ...(job.leaseId != null && { leaseId: job.leaseId }),
      });
    } catch (error) {
      // 409 LEASE_EXPIRED means this worker no longer holds the job: the
      // lease timed out, or the lease_id does not match. The scheduler has
      // already made the job claimable again, so the handler has to stop
      // and this execution must not ack it. Any other failure is only
      // logged; the next beat may still renew the lease in time.
      if (isLeaseExpired(error)) {
        this.noteLeaseLost(activeJob, error);
        return;
      }
      this.debug(`Job heartbeat failed for ${job.id}`, error);
    }
  }

  /**
   * The lease is gone. Abort the handler if it listens, stop renewing, and
   * refuse a later complete/fail with the stale lease.
   */
  private noteLeaseLost(activeJob: ActiveJob, error: unknown): void {
    if (activeJob.leaseLost) return;
    activeJob.leaseLost = true;
    if (activeJob.heartbeatTimer) {
      clearInterval(activeJob.heartbeatTimer);
      activeJob.heartbeatTimer = undefined;
    }
    // A timeout must not fail the job after the lease has been reclaimed.
    this.clearTimeoutTimer(activeJob);
    const reason =
      error instanceof Error ? error : new Error("Job lease expired");
    activeJob.abortController.abort(reason);
    this.debug(
      `Job lease lost for ${activeJob.job.id}; stopping handler`,
      error,
    );
    // Free the slot now. The abort is only a hint: a handler that ignores it
    // (or whose I/O never returns) would otherwise hold a concurrency slot
    // forever, since the timeout above no longer settles it. Its late result
    // is dropped by the leaseLost check in executeHandler.
    activeJob.settled = true;
    this.cleanupJob(activeJob);
  }

  private async sendWorkerHeartbeat(): Promise<void> {
    // Keep beating through the shutdown drain: a long `shutdownTimeout` would
    // otherwise let the stale-worker reaper take the worker (and its jobs).
    if (
      !this.workerId ||
      (this.state !== "running" && this.state !== "stopping")
    ) {
      return;
    }

    try {
      await this.client.workers.heartbeat(this.workerId, {
        currentJobs: this.activeJobs.size,
        status: "healthy",
      });
    } catch (error) {
      this.debug("Worker heartbeat failed", error);
    }
  }

  /**
   * Resolve once no job is active, or after `timeoutMs`. The timer is always
   * cleared, so a clean stop leaves nothing that keeps the process alive.
   */
  private waitForDrain(timeoutMs: number): Promise<void> {
    if (this.activeJobs.size === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.drainWaiter = null;
        resolve();
      }, timeoutMs);
      this.drainWaiter = () => {
        clearTimeout(timer);
        this.drainWaiter = null;
        resolve();
      };
    });
  }
}

/**
 * Heartbeat, complete and fail all answer a lost or mismatched lease with
 * 409 `LEASE_EXPIRED` (a mismatch uses that same code). A gRPC unary call
 * reports that same loss as `FAILED_PRECONDITION` with the lease message;
 * the gRPC client maps it onto this error, so the handler stops and this
 * execution does not ack. Anything else — a dropped connection, a 5xx, a
 * plain 409 — may still succeed on the next beat, so it must not abort the
 * handler.
 */
function isLeaseExpired(error: unknown): boolean {
  return (
    error instanceof SpooledError &&
    error.statusCode === 409 &&
    error.code.toUpperCase() === "LEASE_EXPIRED"
  );
}
