/**
 * Workers Resource
 *
 * Handles worker registration and management.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  Worker,
  WorkerSummary,
  RegisterWorkerParams,
  RegisterWorkerResponse,
  WorkerHeartbeatParams,
} from '../types/workers.js';

export class WorkersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all workers
   */
  async list(): Promise<WorkerSummary[]> {
    return this.http.get<WorkerSummary[]>('/workers');
  }

  /**
   * Get a worker by ID
   */
  async get(id: string): Promise<Worker> {
    return this.http.get<Worker>(`/workers/${id}`);
  }

  /**
   * Register a new worker
   */
  async register(params: RegisterWorkerParams): Promise<RegisterWorkerResponse> {
    return this.http.post<RegisterWorkerResponse>('/workers/register', params);
  }

  /**
   * Send worker heartbeat
   */
  async heartbeat(id: string, params: WorkerHeartbeatParams): Promise<void> {
    await this.http.post(`/workers/${id}/heartbeat`, params);
  }

  /**
   * Deregister a worker
   */
  async deregister(id: string): Promise<void> {
    await this.http.post(`/workers/${id}/deregister`);
  }
}
