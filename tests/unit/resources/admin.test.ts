/**
 * Admin Resource tests
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

describe('AdminResource', () => {
  const createClient = () =>
    new SpooledClient({
      apiKey: 'sk_test_123',
      adminKey: 'admin_secret',
    });

  it('should list organizations with X-Admin-Key header', async () => {
    let adminHeader: string | null = null;
    let url: URL | undefined;

    server.use(
      http.get('https://api.spooled.cloud/api/v1/admin/organizations', ({ request }) => {
        adminHeader = request.headers.get('X-Admin-Key');
        url = new URL(request.url);
        return HttpResponse.json({
          organizations: [],
          total: 0,
          limit: 50,
          offset: 0,
        });
      })
    );

    const client = createClient();
    const res = await client.admin.listOrganizations({ planTier: 'pro', limit: 10, offset: 5 });

    expect(adminHeader).toBe('admin_secret');
    expect(url?.searchParams.get('plan_tier')).toBe('pro');
    expect(url?.searchParams.get('limit')).toBe('10');
    expect(url?.searchParams.get('offset')).toBe('5');
    expect(res.total).toBe(0);
  });

  it('should create organization via admin endpoint', async () => {
    let adminHeader: string | null = null;

    server.use(
      http.post('https://api.spooled.cloud/api/v1/admin/organizations', ({ request }) => {
        adminHeader = request.headers.get('X-Admin-Key');
        return HttpResponse.json({
          organization: {
            id: 'org_123',
            name: 'New Org',
            slug: 'new-org',
            plan_tier: 'pro',
            settings: {},
            created_at: '2025-01-01T00:00:00Z',
            updated_at: '2025-01-01T00:00:00Z',
          },
          api_key: {
            id: 'key_123',
            key: 'sk_test_new',
            name: 'Initial Admin Key',
            created_at: '2025-01-01T00:00:00Z',
          },
        });
      })
    );

    const client = createClient();
    const res = await client.admin.createOrganization({
      name: 'New Org',
      slug: 'new-org',
      planTier: 'pro',
    });

    expect(adminHeader).toBe('admin_secret');
    expect(res.organization.planTier).toBe('pro');
    expect(res.apiKey.key).toBe('sk_test_new');
  });

  it('should update organization via PATCH', async () => {
    server.use(
      http.patch('https://api.spooled.cloud/api/v1/admin/organizations/org_123', () => {
        return HttpResponse.json({
          id: 'org_123',
          name: 'Org',
          slug: 'org',
          plan_tier: 'enterprise',
          settings: {},
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        });
      })
    );

    const client = createClient();
    const org = await client.admin.updateOrganization('org_123', { planTier: 'enterprise' });

    expect(org.planTier).toBe('enterprise');
  });

  it('should delete organization with hard delete flag', async () => {
    let url: URL | undefined;

    server.use(
      http.delete('https://api.spooled.cloud/api/v1/admin/organizations/org_123', ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      })
    );

    const client = createClient();
    await expect(client.admin.deleteOrganization('org_123', { hardDelete: true })).resolves.toBeUndefined();

    expect(url?.searchParams.get('hard_delete')).toBe('true');
  });
});
