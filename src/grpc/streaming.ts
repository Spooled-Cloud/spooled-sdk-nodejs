/**
 * gRPC Streaming Helpers
 *
 * Utilities for working with gRPC streaming in a TypeScript-friendly way.
 */

import type * as grpc from "@grpc/grpc-js";
import { status as grpcStatus } from "@grpc/grpc-js";
import {
  decodeJob,
  decodeProcessResponse,
  encodeProcessRequest,
} from "./encode.js";
import type {
  GrpcJob,
  GrpcProcessRequest,
  GrpcProcessResponse,
} from "./types.js";

/**
 * Options for streaming operations
 */
export interface StreamOptions {
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Called when connection is established */
  onConnected?: () => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when the stream ends */
  onEnd?: () => void;
}

type CancellableCall = Pick<grpc.ClientReadableStream<unknown>, "cancel"> &
  Partial<Pick<grpc.ClientReadableStream<unknown>, "on" | "listenerCount">>;

/**
 * Cancellation the caller asked for, through `cancel()` or the abort `signal`.
 *
 * grpc-js ends a cancelled call with an `error` event carrying `CANCELLED`
 * ("Cancelled on client"). When the cancel came from this side, that is the
 * requested end of the stream, not a failure, so the iteration just finishes.
 */
class LocalCancel {
  requested = false;

  constructor(
    private readonly call: CancellableCall,
    signal?: AbortSignal,
  ) {
    if (signal) {
      if (signal.aborted) {
        this.cancel();
      } else {
        signal.addEventListener("abort", () => this.cancel(), { once: true });
      }
    }
  }

  cancel(): void {
    this.requested = true;
    // Cancelled before anyone iterates: grpc-js still emits the CANCELLED
    // status as an `error` event, and an `error` event with no listener
    // crashes the process. The iterator, once started, ends at once instead.
    if (
      typeof this.call.listenerCount === "function" &&
      this.call.listenerCount("error") === 0
    ) {
      this.call.on?.("error", () => {});
    }
    this.call.cancel();
  }

  /** True for the CANCELLED status our own cancel produced. */
  explains(error: Error): boolean {
    return (
      this.requested &&
      (error as Partial<grpc.ServiceError>).code === grpcStatus.CANCELLED
    );
  }
}

/**
 * Async iterable wrapper for gRPC readable streams (server streaming).
 */
export async function* asyncIterableFromStream<T>(
  stream: grpc.ClientReadableStream<T>,
  options?: StreamOptions,
): AsyncGenerator<T, void, undefined> {
  const { signal, onConnected, onError, onEnd } = options ?? {};
  const localCancel = new LocalCancel(stream, signal);

  return yield* new AsyncIterableStream(
    stream,
    { onConnected, onError, onEnd },
    undefined,
    localCancel,
  );
}

/**
 * AsyncIterable wrapper for grpc.ClientReadableStream
 */
class AsyncIterableStream<T> implements AsyncIterable<T> {
  private stream: grpc.ClientReadableStream<T>;
  private options: Omit<StreamOptions, "signal">;
  private readonly decode: (item: T) => T;
  private readonly localCancel?: LocalCancel;

  constructor(
    stream: grpc.ClientReadableStream<T>,
    options: Omit<StreamOptions, "signal"> = {},
    decode: (item: T) => T = (item) => item,
    localCancel?: LocalCancel,
  ) {
    this.stream = stream;
    this.options = options;
    this.decode = decode;
    this.localCancel = localCancel;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    const { onConnected, onError, onEnd } = this.options;
    const queue: T[] = [];
    let error: Error | null = null;
    let ended = false;
    let decodeFailed = false;
    let resolve: (() => void) | null = null;

    this.stream.on("data", (data: T) => {
      // After a decode failure the stream is being cancelled; what the server
      // still has in flight is dropped, so no item is yielded out of order.
      if (decodeFailed) {
        return;
      }
      try {
        queue.push(this.decode(data));
      } catch (decodeError) {
        decodeFailed = true;
        error =
          decodeError instanceof Error
            ? decodeError
            : new Error(String(decodeError));
        // The iteration ends with this error, so stop the call instead of
        // leaving it open and receiving jobs nobody reads.
        try {
          this.stream.cancel?.();
        } catch {
          // The decode error is the one to report.
        }
      }
      resolve?.();
    });

    const finish = () => {
      if (!ended) {
        ended = true;
        onEnd?.();
      }
      resolve?.();
    };

    this.stream.on("error", (err: Error) => {
      // The CANCELLED error our own cancel() causes must not replace the
      // decode error or reach onError.
      if (decodeFailed) {
        return;
      }
      // A cancel the caller requested (cancel() or the abort signal) ends the
      // stream normally: no error is thrown and onError is not called.
      if (this.localCancel?.explains(err)) {
        finish();
        return;
      }
      error = err;
      onError?.(err);
      resolve?.();
    });

    this.stream.on("end", finish);

    this.stream.on("status", (status: grpc.StatusObject) => {
      if (status.code === 0) {
        onConnected?.();
      }
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }

      if (error) {
        throw error;
      }

      if (ended) {
        return;
      }

      // Cancelled before (or while) iterating: the CANCELLED event may already
      // have been emitted before these listeners existed, so do not wait for it.
      if (this.localCancel?.requested) {
        finish();
        return;
      }

      // Wait for next event
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  }
}

/**
 * Bidirectional stream wrapper for ProcessJobs
 */
export interface ProcessJobsStream {
  /** Send a request to the server */
  send(request: GrpcProcessRequest): void;
  /** Get async iterable for receiving responses */
  receive(): AsyncIterable<GrpcProcessResponse>;
  /** Signal that no more requests will be sent */
  end(): void;
  /** Cancel the stream. A `receive()` loop ends without an error. */
  cancel(): void;
}

/**
 * Create a ProcessJobsStream from a gRPC duplex stream
 */
export function createProcessJobsStream(
  call: grpc.ClientDuplexStream<GrpcProcessRequest, GrpcProcessResponse>,
  options?: StreamOptions,
): ProcessJobsStream {
  const { signal, onError, onEnd } = options ?? {};
  const localCancel = new LocalCancel(call, signal);

  return {
    send(request: GrpcProcessRequest): void {
      call.write(encodeProcessRequest(request));
    },

    receive(): AsyncIterable<GrpcProcessResponse> {
      return new AsyncIterableStream(
        call,
        { onError, onEnd },
        decodeProcessResponse,
        localCancel,
      );
    },

    end(): void {
      call.end();
    },

    cancel(): void {
      localCancel.cancel();
    },
  };
}

/**
 * Job stream for server-side streaming (StreamJobs)
 */
export interface JobStream extends AsyncIterable<GrpcJob> {
  /** Cancel the stream. A `for await` loop over it ends without an error. */
  cancel(): void;
}

/**
 * Create a JobStream from a gRPC server stream
 */
export function createJobStream(
  call: grpc.ClientReadableStream<GrpcJob>,
  options?: StreamOptions,
): JobStream {
  const { signal, onConnected, onError, onEnd } = options ?? {};
  const localCancel = new LocalCancel(call, signal);

  const iterable = new AsyncIterableStream<GrpcJob>(
    call,
    { onConnected, onError, onEnd },
    decodeJob,
    localCancel,
  );

  return {
    [Symbol.asyncIterator]() {
      return iterable[Symbol.asyncIterator]();
    },
    cancel() {
      localCancel.cancel();
    },
  };
}
