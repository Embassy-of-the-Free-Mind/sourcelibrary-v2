import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { findUntaggedPagesOfTenantBooks } from '@/lib/tenant-page-scope';

// #8030: page turns did nothing on a tenant's book whose page rows carry no tenantId. The fix must
// admit exactly those pages, and must not open a partner's lookup to anything else.

const BPH = 'tenant-bph';
const OTHER = 'tenant-other';

async function seed() {
  const db = await getTestDb();
  const reminted = new ObjectId();
  await db.collection('books').insertMany([
    { id: 'bph-book', tenantId: BPH },
    { id: 'other-book', tenantId: OTHER },
    { id: 'global-book' },
    { _id: reminted, id: 'bph-reminted', tenantId: BPH },
  ]);
  await db.collection('pages').insertMany([
    { id: 'untagged-bph', book_id: 'bph-book', detected_images: [{ x: 1 }] },
    { id: 'null-tag-bph', book_id: 'bph-book', tenantId: null },
    { id: 'by-book-_id', book_id: String(reminted) },
    { id: 'untagged-other', book_id: 'other-book' },
    { id: 'untagged-global', book_id: 'global-book' },
    { id: 'tagged-other-in-bph-book', book_id: 'bph-book', tenantId: OTHER },
  ]);
  return db;
}
const ids = (rows: { id?: unknown }[]) => rows.map(r => r.id).sort();

describe('findUntaggedPagesOfTenantBooks (#8030)', () => {
  beforeEach(cleanDb);

  it("admits untagged pages of the tenant's own book, found by the book's id or _id", async () => {
    const db = await seed();
    const got = await findUntaggedPagesOfTenantBooks(db, ['untagged-bph', 'null-tag-bph', 'by-book-_id'], BPH);
    expect(ids(got)).toEqual(['by-book-_id', 'null-tag-bph', 'untagged-bph']);
  });

  it("refuses another tenant's book, a global book, and a page tagged for another tenant", async () => {
    const db = await seed();
    const got = await findUntaggedPagesOfTenantBooks(db, ['untagged-other', 'untagged-global', 'tagged-other-in-bph-book'], BPH);
    expect(got).toEqual([]);
  });

  it('finds a page by _id when the caller holds that form of the id', async () => {
    const db = await seed();
    const row = await db.collection('pages').findOne({ id: 'untagged-bph' });
    const got = await findUntaggedPagesOfTenantBooks(db, [String(row!._id)], BPH);
    expect(ids(got)).toEqual(['untagged-bph']);
  });

  it("keeps the caller's projection and still decides by book under an inclusion list", async () => {
    const db = await seed();
    const excluded = await findUntaggedPagesOfTenantBooks(db, ['untagged-bph'], BPH, { detected_images: 0 });
    expect(excluded).toHaveLength(1);
    expect(excluded[0].detected_images).toBeUndefined();
    const included = await findUntaggedPagesOfTenantBooks(db, ['untagged-bph', 'untagged-global'], BPH, { id: 1 });
    expect(ids(included)).toEqual(['untagged-bph']);
  });

  it('asks nothing of the database for an empty id list', async () => {
    const db = await seed();
    expect(await findUntaggedPagesOfTenantBooks(db, [], BPH)).toEqual([]);
  });
});
