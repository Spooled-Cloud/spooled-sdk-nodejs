/**
 * Admin API Types
 */

import type { JsonValue } from './common.js';
import type { Organization, OrganizationUsage, PlanLimits } from './organizations.js';

export interface AdminListOrganizationsParams {
  planTier?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc' | string;
}

export interface AdminUsageStats {
  jobsToday: number;
  activeJobs: number;
  queues: number;
  workers: number;
  apiKeys: number;
}

export interface AdminOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  billingEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  usage: AdminUsageStats;
}

export interface AdminOrganizationList {
  organizations: AdminOrganizationSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminOrganizationDetail {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  billingEmail?: string | null;
  settings: JsonValue;
  customLimits?: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  usageInfo: OrganizationUsage;
  apiKeysCount: number;
  totalJobs: number;
}

export interface AdminUpdateOrganizationParams {
  planTier?: string;
  billingEmail?: string | null;
  settings?: JsonValue;
  customLimits?: JsonValue | null;
}

export interface AdminCreateOrganizationParams {
  name: string;
  slug: string;
  billingEmail?: string;
  planTier?: string;
}

export interface AdminApiKeyResponse {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

export interface AdminCreateOrganizationResponse {
  organization: Organization;
  apiKey: AdminApiKeyResponse;
}

export interface AdminCreateApiKeyParams {
  name: string;
  queues?: string[];
}

export interface AdminDeleteOrganizationParams {
  hardDelete?: boolean;
}

export interface PlanCount {
  plan: string;
  count: number;
}

export interface AdminPlatformStats {
  organizations: {
    total: number;
    byPlan: PlanCount[];
    createdToday: number;
    createdThisWeek: number;
  };
  jobs: {
    totalActive: number;
    pending: number;
    processing: number;
    completed24h: number;
    failed24h: number;
  };
  workers: {
    total: number;
    healthy: number;
    degraded: number;
  };
  system: {
    apiVersion: string;
    uptimeSeconds: number;
  };
}

export type AdminPlanLimits = PlanLimits;
