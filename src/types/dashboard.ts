/**
 * Dashboard Types
 */

export interface DashboardData {
  system: SystemInfo;
  jobs: JobSummaryStats;
  queues: QueueSummary[];
  workers: DashboardWorkerSummary;
  recentActivity: RecentActivity;
}

export interface SystemInfo {
  version: string;
  uptimeSeconds: number;
  startedAt: string; // ISO8601
  databaseStatus: string;
  cacheStatus: string;
  environment: string;
}

export interface JobSummaryStats {
  total: number;
  pending: number;
  processing: number;
  completed24h: number;
  failed24h: number;
  deadletter: number;
  avgWaitTimeMs?: number | null;
  avgProcessingTimeMs?: number | null;
}

export interface QueueSummary {
  name: string;
  pending: number;
  processing: number;
  paused: boolean;
}

export interface DashboardWorkerSummary {
  total: number;
  healthy: number;
  unhealthy: number;
}

export interface RecentActivity {
  jobsCreated1h: number;
  jobsCompleted1h: number;
  jobsFailed1h: number;
}
