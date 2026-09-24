import { describe, it, expect, vi } from 'vitest';
import type { Db } from 'mongodb';

// findVisibleDuplicateKeeper decides whether a hidden record 308s to the copy
// dedup kept (#5029) or keeps its 404. The guards matter more than the happy
// path: a rights hide must never become a pointer, and a redirect must never
// land on a hidden or tenant-refused keeper.

vi.mock('@/lib/auth-helpers', () => ({ isInnerCircle: async () => false }));

type Doc = Record<string, unknown> & { id: string };
let docs: Doc[] = [];
let tenantRefuses = false;

vi.mock('@/lib/tenant-catalog-books', () => ({
  findBookForTenant: async (_db: Db, idOrSlug: string, _p: unknown, tenant: { id?: string } | null) => {
    if (tenant?.id && tenantRefuses) return null;
    const book = docs.find(d => d.id === idOrSlug || d.slug === idOrSlug);
    return book ? { book, matchedBySlug: book.slug === idOrSlug } : null;
  },
}));

import { findVisibleDuplicateKeeper } from '@/lib/book-access';

const db = {
  collection: () => ({ findOne: async (q: { id: string }) => docs.find(d => d.id === q.id) ?? null }),
} as unknown as Db;

const keeper: Doc = { id: 'k', slug: 'keeper-art', visible: true, content_type: 'artwork', resource_type: 'painting' };
const hidden = (extra: Record<string, unknown> = {}): Doc => ({ id: 'h', visible: false, duplicate_of: 'k', ...extra });

describe('findVisibleDuplicateKeeper', () => {
  it('redirects a duplicate to its visible artwork keeper', async () => {
    docs = [hidden({ hidden_reason: 'duplicate of keeper-art' }), keeper];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toEqual({ slug: 'keeper-art', artworkSlug: 'keeper-art' });
  });

  it('keeper that is a textual book goes to /book (artworkSlug null)', async () => {
    docs = [hidden({ hidden_reason: 'same_edition_duplicate' }), { id: 'k', slug: 'kbook', visible: true, content_type: 'book' }];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toEqual({ slug: 'kbook', artworkSlug: null });
  });

  it('allows a missing reason', async () => {
    docs = [hidden(), keeper];
    expect(await findVisibleDuplicateKeeper(db, 'h')).not.toBeNull();
  });

  it.each([
    'copyright-review: modern edition',
    'takedown request',
    'duplicate of x — DMCA',
    'low_resolution',
    'launch_curation',
  ])('never redirects a non-duplicate or rights-class reason: %s', async (reason) => {
    docs = [hidden({ hidden_reason: reason }), keeper];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toBeNull();
  });

  it('keeps the 404 when the keeper is itself hidden (no chain-following)', async () => {
    docs = [hidden(), { ...keeper, visible: false, duplicate_of: 'z' }, { id: 'z', slug: 'z', visible: true }];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toBeNull();
  });

  it('keeps the 404 when the tenant would refuse the keeper', async () => {
    docs = [hidden(), keeper];
    tenantRefuses = true;
    expect(await findVisibleDuplicateKeeper(db, 'h', { id: 'bph-uuid', slug: 'bph' })).toBeNull();
    tenantRefuses = false;
  });

  it('ignores a record that is not hidden or has no duplicate_of', async () => {
    docs = [{ id: 'h', visible: true, duplicate_of: 'k' }, keeper];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toBeNull();
    docs = [{ id: 'h', visible: false }, keeper];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toBeNull();
  });

  it('refuses a keeper slug that would not survive a URL round trip', async () => {
    docs = [hidden(), { ...keeper, slug: 'bad slug/with space' }];
    expect(await findVisibleDuplicateKeeper(db, 'h')).toBeNull();
  });
});
