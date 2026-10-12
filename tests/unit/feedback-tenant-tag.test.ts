import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/feedback stamps the tenant a row came from, resolved server-side
 * (#4977). Before this, scripts/analytics/feedback-triage.mjs guessed it from
 * the client-sent page path: `/catalog/` matched the global /catalog/scholar
 * and missed every `/embed/bph/...` and `/bph/...` row.
 *
 * The route and the proxy's real resolver run; only the limiter and the
 * database are faked.
 */

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, checkRateLimitShared: vi.fn(async () => ({ allowed: true as const })) };
});

vi.mock('@/lib/auth-helpers', () => ({ withAdminAuth: (h: unknown) => h }));

const TENANTS = [
  { id: 'tenant-bph', slug: 'bph', status: 'active' },
  { id: 'tenant-kloss', slug: 'kloss-collection', status: 'deleted' },
];
const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      insertOne: async (doc: Record<string, unknown>) => {
        if (name === 'feedback') inserted.push(doc);
        return { insertedId: 'inserted-1' };
      },
      updateOne: async () => ({ matchedCount: 1 }),
      findOne: async (q: Record<string, unknown>) => {
        if (name !== 'tenants') return null;
        const slugs = new Set<unknown>();
        if (typeof q.slug === 'string') slugs.add(q.slug);
        for (const c of (q.$or as Record<string, unknown>[] | undefined) ?? []) {
          for (const v of Object.values(c)) slugs.add(v);
        }
        return TENANTS.find((t) => slugs.has(t.slug) && t.status !== 'deleted') ?? null;
      },
    }),
  })),
}));

async function submit(opts: { host?: string; referer?: string; headers?: Record<string, string>; page?: string }) {
  const { POST } = await import('@/app/api/feedback/route');
  const host = opts.host ?? 'sourcelibrary.org';
  const req = new NextRequest(`https://${host}/api/feedback`, {
    method: 'POST',
    headers: {
      host,
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.9',
      ...(opts.referer ? { referer: opts.referer } : {}),
      ...opts.headers,
    },
    body: JSON.stringify({ message: 'This record has the wrong date.', page: opts.page ?? '/' }),
  });
  const res = await POST(req);
  expect(res.status).toBe(200);
  return inserted.at(-1)!;
}

describe('POST /api/feedback tags the tenant (#4977)', () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it('tags a row from the partner subdomain, whatever path the client reports', async () => {
    const row = await submit({ host: 'bph.sourcelibrary.org', referer: 'https://bph.sourcelibrary.org/catalog/5099/edit', page: '/catalog/5099/edit' });
    expect(row).toMatchObject({ tenant_slug: 'bph', tenant_id: 'tenant-bph', tenant_source: 'subdomain' });
  });

  it('tags a row from the partner iframe at /embed/<slug>/', async () => {
    const row = await submit({ referer: 'https://sourcelibrary.org/embed/bph/catalog/30562', page: '/embed/bph/catalog/30562' });
    expect(row).toMatchObject({ tenant_slug: 'bph', tenant_id: 'tenant-bph', tenant_source: 'embed-referer' });
  });

  it('tags a row from a /bph/... page on the apex domain', async () => {
    const row = await submit({ referer: 'https://sourcelibrary.org/bph/book/abc/page/def' });
    expect(row).toMatchObject({ tenant_slug: 'bph', tenant_source: 'referer' });
  });

  it('marks the global /catalog/scholar as global, not partner', async () => {
    const row = await submit({ referer: 'https://sourcelibrary.org/catalog/scholar/x', page: '/catalog/scholar/x' });
    expect(row).toMatchObject({ tenant_slug: null, tenant_id: null, tenant_source: 'none' });
  });

  it('ignores a client-sent x-tenant-* header and a tenant in the body', async () => {
    const row = await submit({
      referer: 'https://sourcelibrary.org/book/foo',
      headers: { 'x-tenant-slug': 'bph', 'x-tenant-id': 'tenant-bph' },
    });
    expect(row.tenant_slug).toBeNull();
  });

  it('does not tag an embed referer for an unknown or deleted tenant', async () => {
    expect((await submit({ referer: 'https://sourcelibrary.org/embed/nope/catalog/1' })).tenant_slug).toBeNull();
    expect((await submit({ referer: 'https://sourcelibrary.org/embed/kloss-collection/x' })).tenant_slug).toBeNull();
  });

  it('files the row untagged rather than failing on a malformed referer', async () => {
    const row = await submit({ referer: 'not a url' });
    expect(row).toMatchObject({ tenant_slug: null, tenant_source: 'none' });
  });
});
