/**
 * Schedules Resource
 *
 * Handles cron schedule operations.
 */

import type { HttpClient } from '../utils/http.js';
import type {
  Schedule,
  CreateScheduleParams,
  CreateScheduleResponse,
  UpdateScheduleParams,
  ListSchedulesParams,
  TriggerScheduleResponse,
  ScheduleRun,
} from '../types/schedules.js';

export class SchedulesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all schedules
   */
  async list(params?: ListSchedulesParams): Promise<Schedule[]> {
    return this.http.get<Schedule[]>('/schedules', { params: params as Record<string, string | number | boolean | undefined> });
  }

  /**
   * Create a new schedule
   */
  async create(params: CreateScheduleParams): Promise<CreateScheduleResponse> {
    return this.http.post<CreateScheduleResponse>('/schedules', params);
  }

  /**
   * Get a schedule by ID
   */
  async get(id: string): Promise<Schedule> {
    return this.http.get<Schedule>(`/schedules/${id}`);
  }

  /**
   * Update a schedule
   */
  async update(id: string, params: UpdateScheduleParams): Promise<Schedule> {
    return this.http.put<Schedule>(`/schedules/${id}`, params);
  }

  /**
   * Delete a schedule
   */
  async delete(id: string): Promise<void> {
    await this.http.delete(`/schedules/${id}`);
  }

  /**
   * Pause a schedule
   */
  async pause(id: string): Promise<Schedule> {
    return this.http.post<Schedule>(`/schedules/${id}/pause`);
  }

  /**
   * Resume a paused schedule
   */
  async resume(id: string): Promise<Schedule> {
    return this.http.post<Schedule>(`/schedules/${id}/resume`);
  }

  /**
   * Manually trigger a schedule
   */
  async trigger(id: string): Promise<TriggerScheduleResponse> {
    return this.http.post<TriggerScheduleResponse>(`/schedules/${id}/trigger`);
  }

  /**
   * Get schedule execution history
   */
  async getHistory(id: string, limit?: number): Promise<ScheduleRun[]> {
    return this.http.get<ScheduleRun[]>(`/schedules/${id}/history`, {
      params: limit ? { limit } : undefined,
    });
  }
}
