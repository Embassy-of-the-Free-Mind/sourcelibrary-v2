import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from 'mongodb';

// findBookForTenant is the ONE admission rule for reader-side book lookups on a
// partner subdomain: assigned to the tenant, or referenced by the tenant's own
// catalogue. Before it existed, /book/[id] admitted catalogue-linked books while
// /book/[id]/page/[pageId] did not, so those books rendered on bph./bhutan.
// with every page link a 404.

const catalogueRows: Array<{ tenant: string; bookId: string }> = [];

vi.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    let tenant: string | null = table === 'bph_works' ? 'bph' : null;
    let ids: string[] = [];
    const q = {
      select: () => q,
      eq: (_col: string, v: string) => { tenant = v; return q; },
      or: (filter: string) => { ids = [...filter.matchAll(/\.eq\.([^,]+)/g)].map(m => m[1]); return q; },
      limit: async () => ({
        data: catalogueRows.filter(r => r.tenant === tenant && ids.includes(r.bookId)),
        error: null,
      }),
    };
    return q;
  };
  return { supabase: { from: query } };
});

import { findBookForTenant } from '@/lib/tenant-catalog-books';

type BookDoc = { id: string; slug: string; tenantId?: string };

function fakeDb(books: BookDoc[]): Db {
  return {
    collection: () => ({
      findOne: async (query: { $or?: Array<Record<string, string>>; tenantId?: string; slug_aliases?: string }) => {
        if (query.slug_aliases) return null;
        const keys = (query.$or ?? []).flatMap(c => Object.values(c).map(String));
        return books.find(b =>
          (keys.includes(b.slug) || keys.includes(b.id)) &&
          (query.tenantId === undefined || b.tenantId === query.tenantId),
        ) ?? null;
      },
    }),
  } as unknown as Db;
}

const BPH = { id: 'bph-uuid', slug: 'bph' };
const books: BookDoc[] = [
  { id: 'own', slug: 'own-book', tenantId: 'bph-uuid' },
  { id: 'linked', slug: 'catalogue-linked' },
  { id: 'foreign', slug: 'unreferenced' },
];

describe('findBookForTenant', () => {
  beforeEach(() => {
    catalogueRows.length = 0;
    catalogueRows.push({ tenant: 'bph', bookId: 'linked' });
  });

  it('without a tenant, is the plain global lookup', async () => {
    expect((await findBookForTenant(fakeDb(books), 'unreferenced', undefined, null))?.book.id).toBe('foreign');
  });

  it('admits a book assigned to the tenant', async () => {
    expect((await findBookForTenant(fakeDb(books), 'own-book', undefined, BPH))?.book.id).toBe('own');
  });

  it('admits a global book the tenant catalogue references', async () => {
    expect((await findBookForTenant(fakeDb(books), 'catalogue-linked', undefined, BPH))?.book.id).toBe('linked');
  });

  it('refuses a global book the catalogue does not reference (lockdown holds)', async () => {
    expect(await findBookForTenant(fakeDb(books), 'unreferenced', undefined, BPH)).toBeNull();
  });

  it("does not admit via another tenant's catalogue", async () => {
    const bhutan = { id: 'bhutan-uuid', slug: 'bhutan' };
    expect(await findBookForTenant(fakeDb(books), 'catalogue-linked', undefined, bhutan)).toBeNull();
  });
});
