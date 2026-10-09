/**
 * The reconciler counts with the shared accumulator and writes all six counters (#5326).
 *
 * PRIOR ART: tests/integration/page-counts-parity.test.ts proves the corpus pipeline
 * agrees with the per-book one and the JS predicates. It does not run the reconciler,
 * which until #5326 carried its own aggregation, counted `ocr.unreadable` pages in
 * pages_ocr, and never wrote pages_translatable. This file runs syncPageCounts() on
 * an in-memory mongod.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { syncPageCounts, formatCounterTally } from '../../scripts/workers/sync-worker.mjs';

const T0 = new Date('2026-01-01T00:00:00Z');

const COUNTS = (count: number, ocr: number, translated: number, translatable: number | undefined, blank = 0, archived = 0) => ({
  pages_count: count, pages_ocr: ocr, pages_translated: translated,
  ...(translatable === undefined ? {} : { pages_translatable: translatable }),
  pages_blank: blank, pages_archived: archived,
});

async function seed(db: Db) {
  await db.collection('books').insertMany([
    // R: pages_translatable stale-HIGH (11, recount 9). Under the stored value it reads
    // 9/11 = translating; recounted it is complete — the 4-in-50 shape of #5467.
    { id: 'R', language: 'Latin', ...COUNTS(11, 10, 9, 11), updated_at: T0 },
    // U: pages_ocr counted an unreadable page (the old reconciler's predicate), and
    // pages_translatable was never written.
    { id: 'U', language: 'Latin', ...COUNTS(2, 2, 1, undefined), updated_at: T0 },
    // E: no visible pages, no counters at all — its true count is zeros.
    { id: 'E', updated_at: T0 },
    // C: already correct.
    { id: 'C', language: 'Latin', ...COUNTS(1, 1, 1, 1), translation_pct: 100, is_fully_translated: true, over_90_translated: true, updated_at: T0 },
  ]);
  await db.collection('pages').insertMany([
    ...Array.from({ length: 9 }, (_, i) => ({ book_id: 'R', page_number: i + 1, ocr: { data: `p${i}` }, translation: { data: `t${i}` } })),
    { book_id: 'R', page_number: 10, page_type: 'exlibris', ocr: { data: 'Ex libris' } },
    { book_id: 'R', page_number: 11, ocr: { fail_blocked: true } },
    { book_id: 'U', page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
    { book_id: 'U', page_number: 2, ocr: { data: 'x', unreadable: true } },
    { book_id: 'E', page_number: 0, ocr: { data: 'hidden' } },
    { book_id: 'C', page_number: 1, ocr: { data: 'c' }, translation: { data: 'C' } },
  ]);
}

const book = (db: Db, id: string) => db.collection('books').findOne({ id });

describe('sync-worker syncPageCounts (#5326)', () => {
  beforeEach(async () => {
    await cleanDb();
    await seed(getTestDb());
  });

  it('dry run tallies every counter it would correct and writes nothing', async () => {
    const db = getTestDb();
    const before = await db.collection('books').find({}).sort({ id: 1 }).toArray();
    const res = await syncPageCounts(db, { dryRun: true });
    expect(res.counter_mismatches).toEqual({
      pages_count: 1, // E
      pages_ocr: 2, // U (unreadable), E
      pages_translated: 1, // E
      pages_translatable: 3, // R (stale high), U and E (missing)
      pages_blank: 1, // E
      pages_archived: 1, // E
    });
    expect(res.translatable_missing).toBe(2);
    expect(res.updated).toBe(0);
    expect(await db.collection('books').find({}).sort({ id: 1 }).toArray()).toEqual(before);
    expect(await db.collection('sweep_log').countDocuments()).toBe(0);
  });

  it('writes all six recounted counters together, pages_translatable included', async () => {
    const db = getTestDb();
    await syncPageCounts(db, { dryRun: false });

    const r = await book(db, 'R');
    expect(r).toMatchObject(COUNTS(11, 10, 9, 9));
    // The rung is computed from the RECOUNTED denominator, not the stored one it replaces.
    expect(r?.translation_state).toMatchObject({ rung: 'complete', translatable: 9, exact: true });
    expect(r?.page_counts_at).toBeInstanceOf(Date);

    expect(await book(db, 'U')).toMatchObject(COUNTS(2, 1, 1, 2));
    expect(await book(db, 'E')).toMatchObject(COUNTS(0, 0, 0, 0));

    // A correct book gets its rung stamped but no counter write: updated_at holds.
    const c = await book(db, 'C');
    expect(c?.updated_at).toEqual(T0);
    expect(c?.page_counts_at).toBeUndefined();
    expect(c?.translation_state?.rung).toBe('complete');
  });

  it('a second run finds nothing to correct', async () => {
    const db = getTestDb();
    await syncPageCounts(db, { dryRun: false });
    const res = await syncPageCounts(db, { dryRun: false });
    expect(Object.values(res.counter_mismatches).every(n => n === 0)).toBe(true);
    expect(res.mismatches).toBe(0);
    expect(res.translatable_missing).toBe(0);
  });

  it('reverts a subset write (a job-time writer counting its own way)', async () => {
    const db = getTestDb();
    await syncPageCounts(db, { dryRun: false });
    await db.collection('books').updateOne({ id: 'U' }, { $set: { pages_ocr: 2 } });
    const res = await syncPageCounts(db, { dryRun: false });
    expect(res.counter_mismatches.pages_ocr).toBe(1);
    expect(await book(db, 'U')).toMatchObject(COUNTS(2, 1, 1, 2));
  });

  it('formats the per-counter tally in documented order', () => {
    expect(formatCounterTally({ pages_ocr: 12, pages_translatable: 40, pages_count: 3 }))
      .toBe('count 3 · ocr 12 · translated 0 · translatable 40 · blank 0 · archived 0');
  });
});
