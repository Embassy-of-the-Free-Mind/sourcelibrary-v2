import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Cloudflare caches /api/gallery on sourcelibrary.org keyed on the URL alone.
// These drive the real route handler and assert the one thing that makes that
// safe: a response is `public` only when its body depends on nothing but the URL.

// ---- fake Mongo --------------------------------------------------------------
let failCounts = false;
let countCalls = 0;
let distinctCalls = 0;

function galleryDoc(i: number) {
  return {
    id: `g${i}`, page_id: `p${i}`, detection_index: 0, book_id: `b${i % 7}`, page_number: i,
    image_url: `https://images.sourcelibrary.org/x/${i}.jpg`, extracted_url: `https://images.sourcelibrary.org/x/${i}.jpg`,
    gallery_quality: 0.9, book_rank: 1, book_year: 1600, book_title: 'T', type: 'woodcut', book_visible: true,
  };
}

function cursor(rows: unknown[]) {
  const c = {
    sort: () => c, skip: () => c, limit: (n: number) => { rows = rows.slice(0, n); return c; },
    project: () => c, toArray: async () => rows,
  };
  return c;
}

const fakeDb = {
  collection: (name: string) => ({
    estimatedDocumentCount: async () => 1000,
    countDocuments: async () => {
      countCalls++;
      if (failCounts) throw new Error('operation exceeded time limit');
      return 500;
    },
    distinct: async (_field: string, q: Record<string, unknown>) => {
      distinctCalls++;
      const scope = String(q['image_source.provider'] ?? q.collections ?? '');
      return [`${scope}-b0`, `${scope}-b1`];
    },
    find: () => cursor(name === 'gallery_images' ? Array.from({ length: 60 }, (_, i) => galleryDoc(i)) : []),
    findOne: async () => null,
    aggregate: () => ({ toArray: async () => [] }),
  }),
};

vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => fakeDb, getDb: async () => fakeDb }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: async () => ({ data: [], error: null }) } }));
vi.mock('@/lib/embeddings', () => ({ generateQueryEmbedding: async () => [], cosineSimilarity: () => 0 }));
vi.mock('@/lib/clip', () => ({ CLIP_URL: 'http://clip.invalid' }));
vi.mock('@/lib/tenant-context', async () => {
  const actual = await vi.importActual<typeof import('@/lib/tenant-context')>('@/lib/tenant-context');
  return { ...actual, resolveTenantId: async (slug: string) => (slug === 'bph' ? 'tenant-bph' : null) };
});

const { GET } = await import('@/app/api/gallery/route');

function get(query: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest(`https://sourcelibrary.org/api/gallery?${query}`, { headers }));
}

beforeEach(() => { failCounts = false; });

describe('gallery shared-cache policy', () => {
  it('shares a plain browse page', async () => {
    const res = await get('limit=24&offset=24');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=900');
  });

  it('shares a library-filtered page', async () => {
    const res = await get('library=test-lib&limit=24&offset=24');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=900');
  });

  // A tenant-scoped body stored under a plain URL would be served to everyone.
  it('never shares a response scoped by a tenant header (browse and filtered)', async () => {
    for (const q of ['limit=24', 'library=test-lib&limit=24']) {
      const res = await get(q, { 'x-tenant-slug': 'bph' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  // Even a slug that resolves to nothing is kept out: the check is on the signal.
  it('never shares when a tenant signal is present but unresolved', async () => {
    const res = await get('limit=24', { 'x-tenant-slug': 'no-such-tenant' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('never shares a response carrying a visitor id (likedByVisitor is personal)', async () => {
    for (const q of ['limit=24&visitor_id=v1', 'library=test-lib&limit=24&visitor_id=v1']) {
      const res = await get(q);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    }
  });

  // A timed-out count falls back to a placeholder total; that must not be
  // served to every reader for 15 minutes.
  it('never shares a response whose count failed', async () => {
    failCounts = true;
    const browse = await get('type=never-counted-a&limit=24&offset=24');
    expect(browse.headers.get('Cache-Control')).toBe('private, no-store');
    const filtered = await get('library=never-counted-b&limit=24&offset=24');
    expect(filtered.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('gallery memo', () => {
  it('reuses a library book-id list and count across "load more" pages', async () => {
    const d0 = distinctCalls, c0 = countCalls;
    await get('library=memo-lib&limit=24&offset=24');
    await get('library=memo-lib&limit=24&offset=48');
    expect(distinctCalls - d0).toBe(1);
    expect(countCalls - c0).toBe(1);
  });

  it('does not remember a failed count', async () => {
    const { galleryMemo } = await import('@/lib/gallery-merge');
    let calls = 0;
    const boom = () => { calls++; return Promise.reject(new Error('timeout')); };
    await expect(galleryMemo('memo-fail-key', boom)).rejects.toThrow();
    await expect(galleryMemo('memo-fail-key', boom)).rejects.toThrow();
    expect(calls).toBe(2);
    await expect(galleryMemo('memo-fail-key', async () => 7)).resolves.toBe(7);
    await expect(galleryMemo('memo-fail-key', async () => 8)).resolves.toBe(7);
  });

  it('keys counts by the full filter, including tenant', async () => {
    const { filterKey } = await import('@/lib/gallery-merge');
    expect(filterKey('c', { tenantId: 'a', q: 1 })).not.toBe(filterKey('c', { tenantId: 'b', q: 1 }));
    expect(filterKey('c', { q: 1 })).toBe(filterKey('c', { q: 1 }));
  });
});
