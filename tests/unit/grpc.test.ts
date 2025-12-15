/**
 * gRPC Client Tests
 *
 * Tests for the real gRPC client. These tests focus on:
 * - Client construction and configuration
 * - Type correctness
 * - Proto loading
 *
 * Note: For actual gRPC communication tests, see integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import {
  SpooledGrpcClient,
  GrpcJobStatus,
  timestampToDate,
  dateToTimestamp,
} from '../../src/grpc/index.js';

// Mock grpc-js to avoid actual network calls
vi.mock('@grpc/grpc-js', async () => {
  const actual = await vi.importActual('@grpc/grpc-js');
  return {
    ...actual,
    credentials: {
      createSsl: vi.fn(() => ({})),
      createInsecure: vi.fn(() => ({})),
    },
  };
});

// Mock proto-loader
vi.mock('@grpc/proto-loader', () => ({
  loadSync: vi.fn(() => ({})),
  load: vi.fn(() => Promise.resolve({})),
}));

// Mock the loaded package definition
vi.mock('../../src/grpc/loader.js', () => {
  const mockClient = class MockClient {
    constructor() {}
    close() {}
    getChannel() {
      return { getConnectivityState: () => 0 };
    }
    waitForReady(_deadline: Date, callback: any) {
      callback(null);
    }
    // Queue methods
    Enqueue = vi.fn((_req, _meta, cb) => cb(null, { jobId: 'job_123', created: true }));
    Dequeue = vi.fn((_req, _meta, cb) => cb(null, { jobs: [] }));
    Complete = vi.fn((_req, _meta, cb) => cb(null, { success: true }));
    Fail = vi.fn((_req, _meta, cb) => cb(null, { success: true, willRetry: false }));
    RenewLease = vi.fn((_req, _meta, cb) => cb(null, { success: true }));
    GetJob = vi.fn((_req, _meta, cb) => cb(null, { job: null }));
    GetQueueStats = vi.fn((_req, _meta, cb) => cb(null, { queueName: 'test', pending: 0 }));
    StreamJobs = vi.fn(() => ({
      on: vi.fn(),
      cancel: vi.fn(),
    }));
    ProcessJobs = vi.fn(() => ({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      cancel: vi.fn(),
    }));
    // Worker methods
    Register = vi.fn((_req, _meta, cb) => cb(null, { workerId: 'w_1', leaseDurationSecs: 30 }));
    Heartbeat = vi.fn((_req, _meta, cb) => cb(null, { acknowledged: true }));
    Deregister = vi.fn((_req, _meta, cb) => cb(null, { success: true }));
  };

  return {
    loadProtoDefinition: vi.fn(() => ({
      spooled: {
        v1: {
          QueueService: mockClient,
          WorkerService: mockClient,
        },
      },
    })),
    loadProtoDefinitionAsync: vi.fn(() => Promise.resolve({
      spooled: {
        v1: {
          QueueService: mockClient,
          WorkerService: mockClient,
        },
      },
    })),
    clearProtoCache: vi.fn(),
    PROTO_LOADER_OPTIONS: {},
  };
});

describe('SpooledGrpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction', () => {
    it('should create client with address and apiKey', () => {
      const client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
      });

      expect(client).toBeInstanceOf(SpooledGrpcClient);
      expect(client.queue).toBeDefined();
      expect(client.workers).toBeDefined();

      client.close();
    });

    it('should use insecure credentials for localhost', () => {
      const client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
      });

      expect(grpc.credentials.createInsecure).toHaveBeenCalled();
      client.close();
    });

    it('should use SSL credentials for non-localhost', () => {
      const client = new SpooledGrpcClient({
        address: 'grpc.spooled.cloud:50051',
        apiKey: 'sk_test_123',
      });

      expect(grpc.credentials.createSsl).toHaveBeenCalled();
      client.close();
    });

    it('should respect explicit useTls option', () => {
      const client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
        useTls: true,
      });

      expect(grpc.credentials.createSsl).toHaveBeenCalled();
      client.close();
    });
  });

  describe('queue operations', () => {
    let client: SpooledGrpcClient;

beforeEach(() => {
      client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
      });
});

afterEach(() => {
      client.close();
    });

    it('should enqueue a job', async () => {
      const result = await client.queue.enqueue({
        queueName: 'test-queue',
        payload: { message: 'hello' },
      });

      expect(result.jobId).toBe('job_123');
      expect(result.created).toBe(true);
    });

    it('should dequeue jobs', async () => {
      const result = await client.queue.dequeue({
        queueName: 'test-queue',
        workerId: 'worker-1',
      });

      expect(result.jobs).toEqual([]);
});

    it('should complete a job', async () => {
      const result = await client.queue.complete({
        jobId: 'job_123',
        workerId: 'worker-1',
        result: { processed: true },
      });

      expect(result.success).toBe(true);
    });

    it('should fail a job', async () => {
      const result = await client.queue.fail({
        jobId: 'job_123',
        workerId: 'worker-1',
        error: 'Something went wrong',
      });

      expect(result.success).toBe(true);
    });

    it('should get queue stats', async () => {
      const result = await client.queue.getQueueStats('test-queue');

      expect(result.queueName).toBe('test');
    });

    it('should get a job', async () => {
      const result = await client.queue.getJob('job_123');

      expect(result.job).toBeNull();
    });
  });

  describe('worker operations', () => {
    let client: SpooledGrpcClient;

    beforeEach(() => {
      client = new SpooledGrpcClient({
        address: 'localhost:50051',
      apiKey: 'sk_test_123',
      });
    });

    afterEach(() => {
      client.close();
    });

    it('should register a worker', async () => {
      const result = await client.workers.register({
        queueName: 'test-queue',
        hostname: 'my-host',
      });

      expect(result.workerId).toBe('w_1');
    });

    it('should send heartbeat', async () => {
      const result = await client.workers.heartbeat({
        workerId: 'worker-1',
        status: 'active',
      });

      expect(result.acknowledged).toBe(true);
    });

    it('should deregister a worker', async () => {
      const result = await client.workers.deregister('worker-1');

      expect(result.success).toBe(true);
    });
  });

  describe('connection management', () => {
    it('should wait for ready', async () => {
      const client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
      });

      await expect(client.waitForReady()).resolves.toBeUndefined();
      client.close();
    });

    it('should get connection state', () => {
      const client = new SpooledGrpcClient({
        address: 'localhost:50051',
        apiKey: 'sk_test_123',
      });

      const state = client.getState();
      expect(typeof state).toBe('number');
      client.close();
    });
  });
});

describe('Timestamp utilities', () => {
  it('should convert timestamp object to Date', () => {
    const ts = { seconds: '1702500000', nanos: 500000000 };
    const date = timestampToDate(ts);

    expect(date).toBeInstanceOf(Date);
    expect(date!.getTime()).toBe(1702500000500);
  });

  it('should convert string to Date', () => {
    const isoString = '2024-12-14T00:00:00.000Z';
    const date = timestampToDate(isoString);

    expect(date).toBeInstanceOf(Date);
    expect(date!.toISOString()).toBe(isoString);
  });

  it('should return null for undefined', () => {
    expect(timestampToDate(undefined)).toBeNull();
    expect(timestampToDate(null)).toBeNull();
  });

  it('should convert Date to timestamp', () => {
    const date = new Date('2024-12-14T12:30:45.123Z');
    const ts = dateToTimestamp(date);

    // Convert back and verify round-trip
    const ms = parseInt(ts.seconds as string, 10) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
    expect(ms).toBe(date.getTime());
    expect(ts.nanos).toBe(123000000);
  });

  it('should convert ISO string to timestamp', () => {
    const isoString = '2024-12-14T12:30:45.000Z';
    const ts = dateToTimestamp(isoString);

    // Convert back and verify round-trip
    const originalDate = new Date(isoString);
    const seconds = parseInt(ts.seconds as string, 10);
    expect(seconds).toBe(Math.floor(originalDate.getTime() / 1000));
  });
});

describe('GrpcJobStatus', () => {
  it('should have proto-style enum values', () => {
    expect(GrpcJobStatus.JOB_STATUS_UNSPECIFIED).toBe('JOB_STATUS_UNSPECIFIED');
    expect(GrpcJobStatus.JOB_STATUS_PENDING).toBe('JOB_STATUS_PENDING');
    expect(GrpcJobStatus.JOB_STATUS_PROCESSING).toBe('JOB_STATUS_PROCESSING');
    expect(GrpcJobStatus.JOB_STATUS_COMPLETED).toBe('JOB_STATUS_COMPLETED');
    expect(GrpcJobStatus.JOB_STATUS_FAILED).toBe('JOB_STATUS_FAILED');
  });
});
