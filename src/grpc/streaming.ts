/**
 * gRPC Streaming Helpers
 *
 * Utilities for working with gRPC streaming in a TypeScript-friendly way.
 */

import type * as grpc from '@grpc/grpc-js';
import type { GrpcJob, GrpcProcessRequest, GrpcProcessResponse } from './types.js';

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

/**
 * Async iterable wrapper for gRPC readable streams (server streaming).
 */
export async function* asyncIterableFromStream<T>(
  stream: grpc.ClientReadableStream<T>,
  options?: StreamOptions
): AsyncGenerator<T, void, undefined> {
  const { signal, onConnected, onError, onEnd } = options ?? {};

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      stream.cancel();
    });
  }

  return yield* new AsyncIterableStream(stream, { onConnected, onError, onEnd });
}

/**
 * AsyncIterable wrapper for grpc.ClientReadableStream
 */
class AsyncIterableStream<T> implements AsyncIterable<T> {
  private stream: grpc.ClientReadableStream<T>;
  private options: Omit<StreamOptions, 'signal'>;

  constructor(
    stream: grpc.ClientReadableStream<T>,
    options: Omit<StreamOptions, 'signal'> = {}
  ) {
    this.stream = stream;
    this.options = options;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    const { onConnected, onError, onEnd } = this.options;
    const queue: T[] = [];
    let error: Error | null = null;
    let ended = false;
    let resolve: (() => void) | null = null;

    this.stream.on('data', (data: T) => {
      queue.push(data);
      resolve?.();
    });

    this.stream.on('error', (err: Error) => {
      error = err;
      onError?.(err);
      resolve?.();
    });

    this.stream.on('end', () => {
      ended = true;
      onEnd?.();
      resolve?.();
    });

    this.stream.on('status', (status: grpc.StatusObject) => {
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
  /** Cancel the stream */
  cancel(): void;
}

/**
 * Create a ProcessJobsStream from a gRPC duplex stream
 */
export function createProcessJobsStream(
  call: grpc.ClientDuplexStream<GrpcProcessRequest, GrpcProcessResponse>,
  options?: StreamOptions
): ProcessJobsStream {
  const { signal, onError, onEnd } = options ?? {};

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      call.cancel();
    });
  }

  return {
    send(request: GrpcProcessRequest): void {
      call.write(request);
    },

    receive(): AsyncIterable<GrpcProcessResponse> {
      return new AsyncIterableStream(call, { onError, onEnd });
    },

    end(): void {
      call.end();
    },

    cancel(): void {
      call.cancel();
    },
  };
}

/**
 * Job stream for server-side streaming (StreamJobs)
 */
export interface JobStream extends AsyncIterable<GrpcJob> {
  /** Cancel the stream */
  cancel(): void;
}

/**
 * Create a JobStream from a gRPC server stream
 */
export function createJobStream(
  call: grpc.ClientReadableStream<GrpcJob>,
  options?: StreamOptions
): JobStream {
  const { signal, onConnected, onError, onEnd } = options ?? {};

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      call.cancel();
    });
  }

  const iterable = new AsyncIterableStream<GrpcJob>(call, {
    onConnected,
    onError,
    onEnd,
  });

  return {
    [Symbol.asyncIterator]() {
      return iterable[Symbol.asyncIterator]();
    },
    cancel() {
      call.cancel();
    },
  };
}

