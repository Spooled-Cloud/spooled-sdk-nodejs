/**
 * Queues Resource
 *
 * Handles queue configuration and control operations.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  QueueConfig,
  QueueConfigSummary,
  QueueStats,
  UpdateQueueConfigParams,
  PauseQueueResponse,
  ResumeQueueResponse,
} from '../types/queues.js';

export class QueuesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all queues
   */
  async list(): Promise<QueueConfigSummary[]> {
    return this.http.get<QueueConfigSummary[]>('/queues');
  }

  /**
   * Get queue configuration by name
   */
  async get(name: string): Promise<QueueConfig> {
    return this.http.get<QueueConfig>(`/queues/${encodeURIComponent(name)}`);
  }

  /**
   * Update queue configuration
   */
  async updateConfig(name: string, params: UpdateQueueConfigParams): Promise<QueueConfig> {
    return this.http.put<QueueConfig>(`/queues/${encodeURIComponent(name)}/config`, params);
  }

  /**
   * Get queue statistics
   */
  async getStats(name: string): Promise<QueueStats> {
    return this.http.get<QueueStats>(`/queues/${encodeURIComponent(name)}/stats`);
  }

  /**
   * Pause a queue
   */
  async pause(name: string, reason?: string): Promise<PauseQueueResponse> {
    return this.http.post<PauseQueueResponse>(
      `/queues/${encodeURIComponent(name)}/pause`,
      reason ? { reason } : undefined
    );
  }

  /**
   * Resume a paused queue
   */
  async resume(name: string): Promise<ResumeQueueResponse> {
    return this.http.post<ResumeQueueResponse>(`/queues/${encodeURIComponent(name)}/resume`);
  }

  /**
   * Delete a queue configuration
   */
  async delete(name: string): Promise<void> {
    await this.http.delete(`/queues/${encodeURIComponent(name)}`);
  }
}
