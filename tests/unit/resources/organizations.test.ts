/**
 * Organizations Resource tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { SpooledClient } from '../../../src/client.js';

const server = setupServer();

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
});

describe('OrganizationsResource', () => {
  const createClient = () => new SpooledClient({ apiKey: 'sk_test_123' });

  describe('create', () => {
    it('should create an organization with initial API key', async () => {
      server.use(
        http.post('https://api.spooled.cloud/api/v1/organizations', () => {
          return HttpResponse.json({
            organization: {
              id: 'org_123',
              name: 'My Company',
              slug: 'my-company',
              plan_tier: 'free',
              settings: {},
              created_at: '2024-01-01T00:00:00Z',
              updated_at: '2024-01-01T00:00:00Z',
            },
            api_key: {
              id: 'key_123',
              key: 'sk_live_abc123',
              name: 'Default API Key',
              created_at: '2024-01-01T00:00:00Z',
            },
          });
        })
      );

      const client = createClient();
      const result = await client.organizations.create({
        name: 'My Company',
        slug: 'my-company',
      });

      expect(result.organization.id).toBe('org_123');
      expect(result.organization.name).toBe('My Company');
      expect(result.apiKey.key).toBe('sk_live_abc123');
    });
  });

  describe('list', () => {
    it('should list organizations', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/organizations', () => {
          return HttpResponse.json([
            { id: 'org_1', name: 'Org 1', slug: 'org-1', plan_tier: 'free', created_at: '2024-01-01T00:00:00Z' },
            { id: 'org_2', name: 'Org 2', slug: 'org-2', plan_tier: 'pro', created_at: '2024-01-01T00:00:00Z' },
          ]);
        })
      );

      const client = createClient();
      const orgs = await client.organizations.list();

      expect(orgs).toHaveLength(2);
      expect(orgs[0].slug).toBe('org-1');
      expect(orgs[1].planTier).toBe('pro');
    });
  });

  describe('get', () => {
    it('should get an organization', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/organizations/org_123', () => {
          return HttpResponse.json({
            id: 'org_123',
            name: 'My Company',
            slug: 'my-company',
            plan_tier: 'pro',
            billing_email: 'billing@company.com',
            settings: { feature_a: true },
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          });
        })
      );

      const client = createClient();
      const org = await client.organizations.get('org_123');

      expect(org.id).toBe('org_123');
      expect(org.planTier).toBe('pro');
      expect(org.billingEmail).toBe('billing@company.com');
    });
  });

  describe('update', () => {
    it('should update an organization', async () => {
      server.use(
        http.put('https://api.spooled.cloud/api/v1/organizations/org_123', () => {
          return HttpResponse.json({
            id: 'org_123',
            name: 'Updated Name',
            slug: 'my-company',
            plan_tier: 'pro',
            billing_email: 'new@company.com',
            settings: {},
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T12:00:00Z',
          });
        })
      );

      const client = createClient();
      const org = await client.organizations.update('org_123', {
        name: 'Updated Name',
        billingEmail: 'new@company.com',
      });

      expect(org.name).toBe('Updated Name');
      expect(org.billingEmail).toBe('new@company.com');
    });
  });

  describe('delete', () => {
    it('should delete an organization', async () => {
      server.use(
        http.delete('https://api.spooled.cloud/api/v1/organizations/org_123', () => {
          return new HttpResponse(null, { status: 204 });
        })
      );

      const client = createClient();
      await expect(client.organizations.delete('org_123')).resolves.toBeUndefined();
    });
  });

  describe('getUsage', () => {
    it('should get organization usage', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/organizations/usage', () => {
          return HttpResponse.json({
            plan: 'pro',
            plan_display_name: 'Pro',
            limits: {
              tier: 'pro',
              display_name: 'Pro',
              max_jobs_per_day: 100000,
              max_active_jobs: 10000,
              max_queues: 100,
              max_workers: 50,
              max_api_keys: 10,
              max_schedules: 50,
              max_workflows: 50,
              max_webhooks: 50,
              max_payload_size_bytes: 1048576,
              rate_limit_requests_per_second: 100,
              rate_limit_burst: 200,
              job_retention_days: 30,
              history_retention_days: 30,
            },
            usage: {
              jobs_today: { current: 5000, limit: 100000, percentage: 5, is_disabled: false },
              active_jobs: { current: 500, limit: 10000, percentage: 5, is_disabled: false },
              queues: { current: 10, limit: 100, percentage: 10, is_disabled: false },
              workers: { current: 5, limit: 50, percentage: 10, is_disabled: false },
              api_keys: { current: 2, limit: 10, percentage: 20, is_disabled: false },
              schedules: { current: 5, limit: 50, percentage: 10, is_disabled: false },
              workflows: { current: 1, limit: 50, percentage: 2, is_disabled: false },
              webhooks: { current: 1, limit: 50, percentage: 2, is_disabled: false },
            },
            warnings: [],
          });
        })
      );

      const client = createClient();
      const usage = await client.organizations.getUsage();

      expect(usage.plan).toBe('pro');
      expect(usage.limits.maxJobsPerDay).toBe(100000);
      expect(usage.usage.jobsToday.current).toBe(5000);
    });
  });

  describe('checkSlug', () => {
    it('should check slug availability', async () => {
      server.use(
        http.get('https://api.spooled.cloud/api/v1/organizations/check-slug', ({ request }) => {
          const url = new URL(request.url);
          const slug = url.searchParams.get('slug');
          return HttpResponse.json({
            available: slug !== 'taken-slug',
            valid: true,
          });
        })
      );

      const client = createClient();
      const result = await client.organizations.checkSlug('new-slug');

      expect(result.available).toBe(true);
      expect(result.valid).toBe(true);
    });
  });
});
