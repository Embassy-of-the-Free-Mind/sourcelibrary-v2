/**
 * One counting rule, four implementations, one fixture (#5325).
 *
 * PRIOR ART: tests/unit/page-counts.test.ts — pins the JS predicates and the
 * pipeline's SHAPE, but never RUNS a pipeline, so a Mongo accumulator could disagree
 * with its JS twin (or the .ts twin with the .mjs one) under a green suite. It did:
 * the .ts TRANSLATABLE_COND had no `ocr.fail_blocked` clause, and this fixture's
 * fail-blocked page is what surfaced it. This file runs the real aggregations on an
 * in-memory mongod.
 *
 * Every copy is imported: the .mjs per-book and corpus pipelines, the .ts per-book
 * and corpus pipelines, and countVisiblePageStats() (the JS predicates). All five
 * must agree on the edge pages below, and both recountBook() twins must write the
 * same six counters.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import * as mjs from '../../scripts/lib/page-counts.mjs';
import * as ts from '@/lib/page-counts';

const BOOK = 'parity-book';
const OTHER = 'parity-other';
const TEXT_FREE_OCR = '<page-type>illustration</page-type><image-desc>A tooled leather binding.</image-desc>';

/** Each edge page, and why it is here. */
function edgePages(): Record<string, unknown>[] {
  return [
    // plain translated page
    { page_number: 1, ocr: { data: 'a' }, translation: { data: 'A' } },
    // soft-hidden (#3293): fully processed and archived, counted nowhere
    { page_number: -1, ocr: { data: 'h' }, translation: { data: 'H' }, archived_photo: 'https://r2/x.jpg' },
    { page_number: 0, ocr: { data: 'h' }, translation: { data: 'H' } },
    // attempted but not legible (#4523): not OCR'd, still translatable (pending)
    { page_number: 2, ocr: { data: 'x', unreadable: true } },
    // blank leaf with the translator's placeholder (#3747): OCR yes, translated no, blank yes
    { page_number: 3, page_type: 'blank', ocr: { data: '<page-type>blank</page-type>' }, translation: { data: '[Blank page — no translatable content]' } },
    // blank leaf whose OCR is unreadable: not OCR'd, so not in pages_blank either
    { page_number: 4, page_type: 'blank', ocr: { data: 'b', unreadable: true } },
    // exlibris with OCR and a translation: translated yes, translatable no, blank NO (decision 3)
    { page_number: 5, page_type: 'exlibris', ocr: { data: 'Ex libris' }, translation: { data: 'From the library of' } },
    // text-free illustration, stamped (#4685): out of the denominator in every copy
    { page_number: 6, page_type: 'illustration', ocr: { data: TEXT_FREE_OCR, text_free: true } },
    // text-free illustration, NOT yet stamped: see the dedicated test below
    { page_number: 7, page_type: 'illustration', ocr: { data: TEXT_FREE_OCR } },
    // refused by the model (recitation): out of the denominator
    { page_number: 8, ocr: { data: 'r', recitation_blocked: true } },
    // OCR permanently given up on (#4674): out of the denominator
    { page_number: 9, ocr: { fail_blocked: true, fail_count: 3 } },
    // awaiting OCR: pending work, IN the denominator (#4516)
    { page_number: 10 },
    // archive attempts: a failed marker counts, as the reconciler always counted it
    { page_number: 11, ocr: { data: 'z' }, archived_photo: 'failed:404' },
    { page_number: 12, ocr: { data: 'y' }, archived_photo: 'https://r2/12.jpg' },
    { page_number: 13, archived_photo: '' },
    // OCR stored as a non-string: not servable text
    { page_number: 14, ocr: { data: { text: 'x' } } },
  ].map(p => ({ book_id: BOOK, ...p }));
}

type Stats = ReturnType<typeof mjs.countVisiblePageStats>;

async function seed(db: Db, pages: Record<string, unknown>[]) {
  await db.collection('pages').insertMany([
    ...pages,
    // A second book, so the corpus pipelines must actually group by book_id.
    { book_id: OTHER, page_number: 1, ocr: { data: 'o' }, translation: { data: 'O' } },
    { book_id: OTHER, page_number: 2, page_type: 'blank', ocr: { data: 'b' } },
  ]);
}

async function allFive(db: Db): Promise<Record<string, Stats>> {
  const pages = db.collection('pages');
  const strip = (row: Record<string, unknown> | undefined) => {
    const { _id, ...rest } = row ?? {};
    return rest as Stats;
  };
  const [mjsBook] = await pages.aggregate(mjs.buildVisiblePageCountPipeline(BOOK)).toArray();
  const [tsBook] = await pages.aggregate(ts.buildVisiblePageCountPipeline(BOOK)).toArray();
  const mjsCorpus = (await pages.aggregate(mjs.buildCorpusPageCountPipeline()).toArray()).find(r => r._id === BOOK);
  const tsCorpus = (await pages.aggregate(ts.buildCorpusPageCountPipeline()).toArray()).find(r => r._id === BOOK);
  const docs = await pages.find({ book_id: BOOK }).toArray();
  return {
    js: mjs.countVisiblePageStats(docs),
    mjsBook: strip(mjsBook),
    tsBook: strip(tsBook),
    mjsCorpus: strip(mjsCorpus),
    tsCorpus: strip(tsCorpus),
  };
}

/** The expected counts once page 7 is stamped, worked out page by page above. */
const EXPECTED: Stats = {
  total: 14, // pages 1–14
  with_ocr: 8, // 1, 3, 5, 6, 7, 8, 11, 12 (a refusal keeps its OCR; 2 and 4 are unreadable)
  with_translation: 2, // 1, 5 (3 is a blank placeholder)
  // IN: 1, 2, 10, 11, 12, 13, 14. OUT: 3 and 4 blank, 5 exlibris, 6 and 7 text-free
  // (7 once stamped), 8 refused, 9 fail-blocked.
  translatable: 7,
  translated_translatable: 1, // 1
  blank: 1, // 3
  archived: 2, // 11 (failed:*), 12
};

describe('page-count parity: JS predicates, .mjs and .ts pipelines, per book and corpus (#5325)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('all five copies agree on every edge page once text-free illustrations are stamped', async () => {
    const db = getTestDb();
    // What recount-page-stats.mjs does before it counts: stamp ocr.text_free.
    const pages = edgePages().map(p => {
      const ocr = (p as { ocr?: Record<string, unknown> }).ocr;
      if (p.page_type === 'illustration' && ocr && !('text_free' in ocr)) {
        return { ...p, ocr: { ...ocr, text_free: mjs.isTextFreeIllustration(p) } };
      }
      return p;
    });
    await seed(db, pages);

    const got = await allFive(db);
    expect(got.js).toEqual(EXPECTED);
    expect(got.mjsBook).toEqual(EXPECTED);
    expect(got.tsBook).toEqual(EXPECTED);
    expect(got.mjsCorpus).toEqual(EXPECTED);
    expect(got.tsCorpus).toEqual(EXPECTED);
  });

  it('an UNSTAMPED text-free illustration is the one documented gap, and it errs toward pending', async () => {
    // Mongo cannot re-derive isTextFreeIllustration(); an unstamped page stays IN the
    // pipelines' denominator (the safe direction). The JS twin reads the text and
    // excludes it. Pin the gap to exactly that page and exactly that counter.
    const db = getTestDb();
    await seed(db, edgePages());
    const got = await allFive(db);
    const pipelineExpected = { ...EXPECTED, translatable: EXPECTED.translatable + 1 };
    expect(got.js).toEqual(EXPECTED);
    for (const k of ['mjsBook', 'tsBook', 'mjsCorpus', 'tsCorpus']) expect(got[k]).toEqual(pipelineExpected);
  });

  it('the fixture exercises every accumulator (a zero column would pass vacuously)', () => {
    for (const [k, v] of Object.entries(EXPECTED)) expect(v, k).toBeGreaterThan(0);
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(mjs.PAGE_COUNT_ACCUMULATORS).sort());
    expect(Object.keys(mjs.PAGE_COUNT_ACCUMULATORS).sort()).toEqual(Object.keys(ts.PAGE_COUNT_ACCUMULATORS).sort());
  });

  it('the corpus pipelines group per book', async () => {
    const db = getTestDb();
    await seed(db, edgePages());
    const rows = await db.collection('pages').aggregate(mjs.buildCorpusPageCountPipeline()).toArray();
    const other = rows.find(r => r._id === OTHER);
    expect(other).toMatchObject({ total: 2, with_ocr: 2, with_translation: 1, blank: 1, archived: 0 });
  });
});

describe('recountBook(): the one writer (#5325)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  for (const [name, twin] of [['mjs', mjs], ['ts', ts]] as const) {
    it(`${name}: writes all six counters together and stamps page_counts_at`, async () => {
      const db = getTestDb();
      await seed(db, edgePages());
      const staleAt = new Date('2026-01-01T00:00:00Z');
      // Stale in every way a private writer has left a book: a subset written, a
      // hidden page counted, pages_translatable missing, pages_blank wide.
      await db.collection('books').insertOne({
        id: BOOK, slug: 'parity', pages_count: 16, pages_ocr: 8, pages_translated: 2, pages_blank: 2,
        updated_at: staleAt,
      });

      const now = new Date('2026-09-30T12:00:00Z');
      const res = await twin.recountBook(db, BOOK, { reason: 'test', now });
      expect(res.matched).toBe(true);
      expect(res.after).toEqual({
        pages_count: 14, pages_ocr: 8, pages_translated: 2,
        pages_translatable: 8, // page 7 unstamped: the pipeline's documented gap
        pages_blank: 1, pages_archived: 2,
      });
      expect(res.changed.sort()).toEqual(['pages_archived', 'pages_blank', 'pages_count', 'pages_translatable']);

      const book = await db.collection('books').findOne({ id: BOOK });
      for (const c of twin.PAGE_COUNTERS) expect(book?.[c], c).toBe(res.after[c]);
      expect(book?.page_counts_at).toEqual(now);
      expect(book?.updated_at).toEqual(now);
    });

    it(`${name}: a no-op recount stamps page_counts_at but leaves updated_at alone`, async () => {
      const db = getTestDb();
      await seed(db, edgePages());
      const staleAt = new Date('2026-01-01T00:00:00Z');
      await db.collection('books').insertOne({ id: BOOK, updated_at: staleAt });
      await twin.recountBook(db, BOOK, { reason: 'first', now: new Date('2026-09-30T12:00:00Z') });
      const later = new Date('2026-09-30T13:00:00Z');
      const res = await twin.recountBook(db, BOOK, { reason: 'second', now: later });
      expect(res.changed).toEqual([]);
      const book = await db.collection('books').findOne({ id: BOOK });
      expect(book?.page_counts_at).toEqual(later);
      expect(book?.updated_at).toEqual(new Date('2026-09-30T12:00:00Z'));
    });

    it(`${name}: a book with no visible pages is written as zeros; an unknown id writes nothing`, async () => {
      const db = getTestDb();
      await db.collection('books').insertOne({ id: 'empty', pages_count: 40, pages_ocr: 40 });
      const res = await twin.recountBook(db, 'empty', { reason: 'test' });
      expect(res.after).toEqual(twin.initialPageCounters(0));
      expect(await db.collection('books').findOne({ id: 'empty' })).toMatchObject({ pages_count: 0, pages_ocr: 0 });

      const missing = await twin.recountBook(db, 'no-such-book', { reason: 'test' });
      expect(missing.matched).toBe(false);
      expect(await db.collection('books').countDocuments({ id: 'no-such-book' })).toBe(0);
    });

    it(`${name}: refuses a call that does not name its caller`, async () => {
      const db = getTestDb();
      // @ts-expect-error — the missing reason is the point
      await expect(twin.recountBook(db, BOOK, {})).rejects.toThrow(/reason/);
      await expect(twin.recountBook(db, '', { reason: 'x' })).rejects.toThrow(/bookId/);
    });
  }

  it('initialPageCounters: every page pending, so every page translatable', () => {
    expect(mjs.initialPageCounters(12)).toEqual({
      pages_count: 12, pages_ocr: 0, pages_translated: 0, pages_translatable: 12, pages_blank: 0, pages_archived: 0,
    });
    expect(ts.initialPageCounters(12)).toEqual(mjs.initialPageCounters(12));
  });
});
