import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { addRelation, relationsOf, relationsOfIds, BOOK_RELATIONS } from '@/lib/book-relations';
import { checkHoldings } from '@/lib/holdings-check';
import { INDEXES } from '../../scripts/maintenance/ensure-indexes.mjs';
import { getTestDb, cleanDb } from '../setup';

const REMINTED = new ObjectId();

async function seed() {
  const db = getTestDb();
  await cleanDb();
  // The indexes exactly as declared — the test fails if the manifest loses them.
  for (const spec of INDEXES.filter((i: { collection: string }) => i.collection === BOOK_RELATIONS)) {
    await db.collection(BOOK_RELATIONS).createIndex(spec.key, spec.options);
  }
  await db.collection('books').insertMany([
    { _id: 'copy-bsb-1' as unknown as ObjectId, id: 'copy-bsb-1', title: 'De Pestilitate', author: 'Paracelsus', year: 1625, visible: true, pages_count: 208 },
    { _id: 'copy-bsb-2' as unknown as ObjectId, id: 'copy-bsb-2', title: 'Von dem Ursprung der Pest', author: 'Various', visible: false, hidden: true, pages_count: 220 },
    // A book whose _id was re-minted: its id is the old string.
    { _id: REMINTED, id: 'old-id-of-reminted', slug: 'magia-adamica', title: 'Magia Adamica', author: 'Vaughan', year: 1650, visible: true, pages_count: 474 },
    { _id: 'tract' as unknown as ObjectId, id: 'tract', title: 'Coelum Terrae', author: 'Vaughan', year: 1650, visible: false, hidden: true, hidden_reason: 'duplicate', duplicate_of: 'old-id-of-reminted', pages_count: 89 },
  ]);
  return db;
}

const base = { evidence: 'title pages identical; two BSB copies', created_by: 'test' };

describe('addRelation', () => {
  beforeEach(seed);

  it('stores one sorted row for a symmetric pair, whichever way it is entered', async () => {
    const db = getTestDb();
    const first = await addRelation(db, { a: 'copy-bsb-2', b: 'copy-bsb-1', type: 'other_copy_of_edition', ...base });
    expect(first.created).toBe(true);
    expect(first.relation).toMatchObject({ a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', created_by: 'test' });
    expect(first.relation.created_at).toBeInstanceOf(Date);

    const again = await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', evidence: 'a second look', created_by: 'someone else' });
    expect(again.created).toBe(false);
    expect(again.relation.evidence).toBe(base.evidence);
    expect(await db.collection(BOOK_RELATIONS).countDocuments()).toBe(1);
  });

  it('normalises a re-minted _id and a slug to the same canonical id', async () => {
    const db = getTestDb();
    await addRelation(db, { a: REMINTED.toHexString(), b: 'tract', type: 'contains', ...base });
    const again = await addRelation(db, { a: 'magia-adamica', b: 'tract', type: 'contains', ...base });
    expect(again.created).toBe(false);
    expect(again.relation).toMatchObject({ a: 'old-id-of-reminted', b: 'tract' });
  });

  it('one writer wins when the same pair is entered concurrently', async () => {
    const db = getTestDb();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      addRelation(db, { a: i % 2 ? 'copy-bsb-1' : 'copy-bsb-2', b: i % 2 ? 'copy-bsb-2' : 'copy-bsb-1', type: 'bound_with', ...base })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.collection(BOOK_RELATIONS).countDocuments()).toBe(1);
  });

  it('the unique index refuses a second raw row for the same pair and type', async () => {
    const db = getTestDb();
    await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'bound_with', ...base });
    await expect(db.collection(BOOK_RELATIONS).insertOne({ a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'bound_with' })).rejects.toMatchObject({ code: 11000 });
    // A different type on the same pair is a different statement.
    expect((await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', ...base })).created).toBe(true);
  });

  it('refuses a missing book, a self-relation, an unknown type, empty evidence and a reversed contains', async () => {
    const db = getTestDb();
    await expect(addRelation(db, { a: 'copy-bsb-1', b: 'no-such-book', type: 'bound_with', ...base })).rejects.toThrow(/no book resolves/);
    await expect(addRelation(db, { a: 'old-id-of-reminted', b: REMINTED.toHexString(), type: 'bound_with', ...base })).rejects.toThrow(/same book/);
    await expect(addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'duplicate_of' as never, ...base })).rejects.toThrow(/unknown type/);
    await expect(addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'bound_with', evidence: '  ', created_by: 'test' })).rejects.toThrow(/evidence/);
    await addRelation(db, { a: 'old-id-of-reminted', b: 'tract', type: 'contains', ...base });
    await expect(addRelation(db, { a: 'tract', b: 'old-id-of-reminted', type: 'contains', ...base })).rejects.toThrow(/already recorded as containing/);
    expect(await db.collection(BOOK_RELATIONS).countDocuments()).toBe(1);
  });

  it('does not touch either book — no visibility change, no duplicate_of', async () => {
    const db = getTestDb();
    const before = await db.collection('books').find({}).sort({ id: 1 }).toArray();
    await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', ...base });
    await addRelation(db, { a: 'old-id-of-reminted', b: 'tract', type: 'contains', ...base });
    expect(await db.collection('books').find({}).sort({ id: 1 }).toArray()).toEqual(before);
  });
});

describe('relationsOf', () => {
  beforeEach(seed);

  it('reads a symmetric relation from both ends', async () => {
    const db = getTestDb();
    await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', ...base });
    expect(await relationsOf(db, 'copy-bsb-1')).toMatchObject([{ of: 'copy-bsb-1', book_id: 'copy-bsb-2', role: 'other_copy_of_edition', evidence: base.evidence }]);
    expect(await relationsOf(db, 'copy-bsb-2')).toMatchObject([{ of: 'copy-bsb-2', book_id: 'copy-bsb-1', role: 'other_copy_of_edition' }]);
  });

  it('gives contains a direction, and finds a re-minted book by its _id', async () => {
    const db = getTestDb();
    await addRelation(db, { a: 'old-id-of-reminted', b: 'tract', type: 'contains', ...base });
    expect(await relationsOf(db, REMINTED.toHexString())).toMatchObject([{ book_id: 'tract', role: 'contains' }]);
    expect(await relationsOf(db, 'tract')).toMatchObject([{ book_id: 'old-id-of-reminted', role: 'contained_in' }]);
    expect(await relationsOf(db, 'no-such-book')).toEqual([]);
  });

  it('skips rows another writer left malformed and collapses an unsorted twin', async () => {
    const db = getTestDb();
    await db.collection(BOOK_RELATIONS).insertMany([
      { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'bound_with', evidence: 'sorted', created_by: 'x', created_at: new Date(1) },
      { a: 'copy-bsb-2', b: 'copy-bsb-1', type: 'bound_with', evidence: 'unsorted twin', created_by: 'y', created_at: new Date(2) },
      { a: 'copy-bsb-1', b: 'tract', type: 'same_thing' },
      { a: 'copy-bsb-1', b: 'copy-bsb-1', type: 'bound_with' },
      { a: 'copy-bsb-1', type: 'bound_with' },
    ]);
    const rels = await relationsOfIds(db, ['copy-bsb-1']);
    expect(rels).toHaveLength(1);
    expect(rels[0]).toMatchObject({ book_id: 'copy-bsb-2', evidence: 'sorted' });
  });
});

describe('checkHoldings reads relations', () => {
  beforeEach(seed);

  it('lists a recorded copy and a bound-with volume, without changing the verdict', async () => {
    const db = getTestDb();
    await addRelation(db, { a: 'copy-bsb-1', b: 'copy-bsb-2', type: 'other_copy_of_edition', ...base });
    await addRelation(db, { a: 'copy-bsb-1', b: 'old-id-of-reminted', type: 'bound_with', ...base });

    const res = await checkHoldings(db, { identifier: 'copy-bsb-1' });
    expect(res.verdict).toBe('same_object');
    expect(res.candidates[0]).toMatchObject({ book_id: 'copy-bsb-1', reason: 'same_book' });
    const byId = Object.fromEntries(res.candidates.map((c) => [c.book_id, c]));
    expect(byId['copy-bsb-2']).toMatchObject({
      reason: 'related_copy', hidden: true,
      related_to: { book_id: 'copy-bsb-1', relation: 'other_copy_of_edition', evidence: base.evidence },
    });
    expect(byId['old-id-of-reminted']).toMatchObject({ reason: 'bound_with', related_to: { relation: 'bound_with' } });
    // The public route prints reason_detail: it must name neither a book nor the evidence.
    expect(byId['copy-bsb-2'].reason_detail).not.toMatch(/copy-bsb-1|BSB/);
  });

  it('says so when a relation points at a book that is gone', async () => {
    const db = getTestDb();
    await db.collection(BOOK_RELATIONS).insertOne({ a: 'copy-bsb-1', b: 'vanished', type: 'bound_with', evidence: 'e', created_by: 't', created_at: new Date() });
    const res = await checkHoldings(db, { identifier: 'copy-bsb-1' });
    expect(res.candidates.map((c) => c.book_id)).toEqual(['copy-bsb-1']);
    expect(res.limits.join(' ')).toMatch(/1 recorded relation points at a book that no longer resolves \(vanished\)/);
  });

  it('a lookup with no relations is unchanged', async () => {
    const db = getTestDb();
    const res = await checkHoldings(db, { identifier: 'tract' });
    expect(res.candidates.map((c) => c.reason)).not.toContain('related_copy');
    expect(res.limits.join(' ')).not.toMatch(/relation/);
  });
});
