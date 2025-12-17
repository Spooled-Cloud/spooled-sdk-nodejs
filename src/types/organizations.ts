/**
 * Organization Types
 *
 * Types for organization operations.
 */

import type { PlanTier, JsonObject } from './common.js';

/** Full organization model */
export interface Organization {
  id: string;
  name: string;
  slug: string;
  planTier: PlanTier;
  billingEmail?: string;
  settings: JsonObject;
  customLimits?: JsonObject;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionStatus?: string;
  stripeCurrentPeriodEnd?: string;
  stripeCancelAtPeriodEnd?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Organization summary for list responses */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  planTier: PlanTier;
  createdAt: string;
}

/** Parameters for creating an organization */
export interface CreateOrganizationParams {
  /** Organization name (3-100 chars) */
  name: string;
  /** URL-friendly slug (3-50 chars, lowercase alphanumeric and hyphens) */
  slug: string;
  /** Billing email */
  billingEmail?: string;
}

/** Initial API key returned during org creation */
export interface InitialApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

/** Response for creating an organization */
export interface CreateOrganizationResponse {
  organization: Organization;
  apiKey: InitialApiKey;
}

/** Parameters for updating an organization */
export interface UpdateOrganizationParams {
  name?: string;
  billingEmail?: string;
  settings?: JsonObject;
}

/** Organization usage and plan limits (GET /api/v1/organizations/usage) */
export interface OrganizationUsage {
  /** Current plan tier */
  plan: PlanTier;
  /** Human-readable plan name */
  planDisplayName: string;
  /** Limits for the current plan (with any overrides applied) */
  limits: PlanLimits;
  /** Current usage against limits */
  usage: ResourceUsage;
  /** Warnings when approaching/exceeding limits */
  warnings: UsageWarning[];
}

export interface PlanLimits {
  tier: string;
  displayName: string;
  maxJobsPerDay?: number | null;
  maxActiveJobs?: number | null;
  maxQueues?: number | null;
  maxWorkers?: number | null;
  maxApiKeys?: number | null;
  maxSchedules?: number | null;
  maxWorkflows?: number | null;
  maxWebhooks?: number | null;
  maxPayloadSizeBytes: number;
  rateLimitRequestsPerSecond: number;
  rateLimitBurst: number;
  jobRetentionDays: number;
  historyRetentionDays: number;
}

export interface ResourceUsage {
  jobsToday: UsageItem;
  activeJobs: UsageItem;
  queues: UsageItem;
  workers: UsageItem;
  apiKeys: UsageItem;
  schedules: UsageItem;
  workflows: UsageItem;
  webhooks: UsageItem;
}

export interface UsageItem {
  current: number;
  limit?: number | null;
  percentage?: number | null;
  isDisabled: boolean;
}

export interface UsageWarning {
  resource: string;
  message: string;
  severity: 'warning' | 'critical' | string;
}

/** Organization member */
export interface OrganizationMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  joinedAt: string;
  invitedBy?: string;
}

/** Slug availability check response */
export interface CheckSlugResponse {
  available: boolean;
  valid: boolean;
  error?: string;
  suggestion?: string;
}

/** Webhook token response */
export interface WebhookTokenResponse {
  /** The webhook verification token */
  token: string;
}
