/**
 * Lazy pages (#7343 step 2a): a manifest-only book materializes its page docs
 * exactly once, and nothing that counts pages zeroes it in the meantime.
 *
 * PRIOR ART: tests/integration/page-counts-parity.test.ts pins the counting rule
 * on books that HAVE pages; tests/integration/sync-worker-page-counts.test.ts
 * pins that a book with no pages recounts to zeros — the exact behaviour a
 * manifest-only book must be exempt from. Neither knows `pages_state`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import {
  materializePages, ensurePages, buildPageDocs, pageIdFor, initialPagesState,
  LAZY_PAGES_FILTER, PAGES_MATERIALIZED_FILTER,
} from '../../scripts/lib/lazy-pages.mjs';
import { makeBookDoc } from '../../scripts/lib/book-docs.mjs';
import * as mjsCounts from '../../scripts/lib/page-counts.mjs';
import * as tsCounts from '@/lib/page-counts';
import { syncPageCounts } from '../../scripts/workers/sync-worker.mjs';

const BOOK = 'lazy-book';
const MANIFEST_URL = 'https://iiif.example.org/lazy/manifest.json';
const N = 7;

/** A IIIF v2 manifest of `n` canvases; canvas 3 has no image (it must keep its place). */
function manifest(n = N) {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': MANIFEST_URL,
    sequences: [{
      canvases: Array.from({ length: n }, (_, i) => (i === 2
        ? { '@id': `c${i}`, images: [] }
        : { '@id': `c${i}`, images: [{ resource: { '@id': `https://img.example.org/${i}.jpg` } }] })),
    }],
  };
}

async function seedLazyBook(db: Db, extra: Record<string, unknown> = {}) {
  await db.collection('books').insertOne(makeBookDoc({
    id: BOOK,
    slug: 'lazy-book',
    title: 'A lazy book',
    language: 'Latin',
    visible: false,
    hidden: true,
    image_source: { provider: 'iiif', iiif_manifest: MANIFEST_URL },
    pages_count: N,
    pages_state: initialPagesState(),
    ...extra,
  }));
}

/** A fetcher that counts its calls and takes `ms` to answer. */
function slowFetcher(ms = 80) {
  const calls: string[] = [];
  const fetchManifest = async (url: string) => {
    calls.push(url);
    await new Promise(r => setTimeout(r, ms));
    return manifest();
  };
  return { calls, fetchManifest };
}

const book = (db: Db) => db.collection('books').findOne({ id: BOOK });
const pageCount = (db: Db) => db.collection('pages').countDocuments({ book_id: BOOK });

describe('materializePages (#7343)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  it('two concurrent triggers: the manifest is fetched once and the pages exist exactly once', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    const { calls, fetchManifest } = slowFetcher();

    const [a, b] = await Promise.all([
      materializePages(db, BOOK, { trigger: 'reader', fetchManifest, waitMs: 5000 }),
      materializePages(db, BOOK, { trigger: 'ocr-dispatch', fetchManifest, waitMs: 5000 }),
    ]);

    expect(a.status).toBe('materialized');
    expect(b.status).toBe('materialized');
    expect(calls).toHaveLength(1);
    expect(await pageCount(db)).toBe(N);
    const numbers = (await db.collection('pages').find({ book_id: BOOK }).sort({ page_number: 1 }).toArray()).map(p => p.page_number);
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    const after = await book(db);
    expect(after?.pages_state?.state).toBe('materialized');
    expect(after?.pages_state?.lease_by).toBeUndefined();
    // The counters now come from the pages, through recountBook().
    expect(after?.pages_count).toBe(N);
    expect(after?.page_counts_at).toBeInstanceOf(Date);
  });

  it('a lease that expires mid-write still cannot duplicate a page (deterministic ids)', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    const { calls, fetchManifest } = slowFetcher(50);

    // leaseMs: 0 lets the second caller take the book over while the first is still writing.
    const results = await Promise.all([
      materializePages(db, BOOK, { trigger: 'archive', fetchManifest, leaseMs: 0 }),
      new Promise(r => setTimeout(r, 10)).then(() => materializePages(db, BOOK, { trigger: 'publish', fetchManifest, leaseMs: 0 })),
    ]);

    expect(calls).toHaveLength(2); // both got past the claim…
    expect(results.map(r => r.status)).toEqual(['materialized', 'materialized']);
    expect(await pageCount(db)).toBe(N); // …and still one copy of each page.
  });

  it('a second call after materialization is a no-op', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    const { calls, fetchManifest } = slowFetcher(1);
    await materializePages(db, BOOK, { trigger: 'reader', fetchManifest });
    const again = await materializePages(db, BOOK, { trigger: 'reader', fetchManifest });
    expect(again.status).toBe('not_lazy');
    expect(calls).toHaveLength(1);
    expect(await pageCount(db)).toBe(N);
  });

  it('a book that is not lazy is never touched', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne({ id: 'legacy', pages_count: 0 });
    const { calls, fetchManifest } = slowFetcher(1);
    const res = await materializePages(db, 'legacy', { trigger: 'reader', fetchManifest });
    expect(res.status).toBe('not_lazy');
    expect(calls).toHaveLength(0);
    expect(await db.collection('pages').countDocuments({})).toBe(0);
  });

  it('a lazy-marked book that already has pages under other ids is not given a second set', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    await db.collection('pages').insertMany([1, 2, 3].map(n => ({ id: `old-${n}`, book_id: BOOK, page_number: n, photo: 'x' })));
    const { calls, fetchManifest } = slowFetcher(1);
    const res = await materializePages(db, BOOK, { trigger: 'reader', fetchManifest });
    expect(res).toMatchObject({ status: 'materialized', existing: 3 });
    expect(calls).toHaveLength(0);
    expect(await pageCount(db)).toBe(3);
    expect((await book(db))?.pages_state?.state).toBe('materialized');
  });

  it('a failed fetch leaves the book manifest-only, with its count, and ensurePages throws', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    const fetchManifest = async () => { throw new Error('HTTP 503'); };
    const res = await materializePages(db, BOOK, { trigger: 'reader', fetchManifest });
    expect(res.status).toBe('failed');
    const after = await book(db);
    expect(after?.pages_state?.state).toBe('manifest_only');
    expect(after?.pages_state?.error).toMatch(/503/);
    expect(after?.pages_count).toBe(N);
    expect(await pageCount(db)).toBe(0);
    await expect(ensurePages(db, BOOK, { trigger: 'ocr-dispatch', fetchManifest, waitMs: 0 })).rejects.toThrow(/failed/);
  });

  it('LAZY_PAGES_FILTER / PAGES_MATERIALIZED_FILTER split lazy books from every other book', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    await db.collection('books').insertMany([
      { id: 'legacy', pages_count: 3 },
      { id: 'done', pages_count: 3, pages_state: { state: 'materialized' } },
      { id: 'busy', pages_count: 3, pages_state: { state: 'materializing' } },
    ]);
    const ids = async (f: object) => (await db.collection('books').find(f).toArray()).map(b => b.id).sort();
    expect(await ids(LAZY_PAGES_FILTER)).toEqual(['busy', BOOK]);
    expect(await ids(PAGES_MATERIALIZED_FILTER)).toEqual(['done', 'legacy']);
  });
});

describe('the counters do not miscount a manifest-only book (#7343)', () => {
  beforeEach(async () => {
    await cleanDb();
  });

  for (const [name, twin] of [['mjs', mjsCounts], ['ts', tsCounts]] as const) {
    it(`${name} recountBook keeps the declared count while the book is lazy`, async () => {
      const db = getTestDb();
      await seedLazyBook(db);
      const res = await twin.recountBook(db, BOOK, { reason: 'test' });
      expect(res.after.pages_count).toBe(N);
      expect(res.after.pages_translatable).toBe(N);
      const after = await book(db);
      expect(after?.pages_count).toBe(N);
      expect(after?.translation_state?.rung).not.toBe('no_pages');
    });
  }

  it('the 2-hourly reconciler does not zero it (and still zeroes a real empty shell)', async () => {
    const db = getTestDb();
    await seedLazyBook(db);
    await db.collection('books').insertOne({ id: 'shell', pages_count: 5 });
    await syncPageCounts(db, { dryRun: false });
    expect((await book(db))?.pages_count).toBe(N);
    expect((await db.collection('books').findOne({ id: 'shell' }))?.pages_count).toBe(0);
  });

  it('the live filter and a pages_count sum count it as N pages before and after materializing', async () => {
    const db = getTestDb();
    await seedLazyBook(db, { visible: true, hidden: false });
    const live = { visible: true, pages_count: { $gt: 0 } };
    const sum = async () => (await db.collection('books').aggregate([{ $match: live }, { $group: { _id: null, n: { $sum: 1 }, pages: { $sum: '$pages_count' } } }]).toArray())[0];
    expect(await sum()).toMatchObject({ n: 1, pages: N });
    const { fetchManifest } = slowFetcher(1);
    await materializePages(db, BOOK, { trigger: 'reader', fetchManifest });
    await syncPageCounts(db, { dryRun: false });
    expect(await sum()).toMatchObject({ n: 1, pages: N });
  });
});

describe('buildPageDocs (#7343)', () => {
  it('keeps a canvas with no image in its place, with book-scoped deterministic ids', () => {
    const docs = buildPageDocs(BOOK, manifest());
    expect(docs).toHaveLength(N);
    expect(docs[2]).toMatchObject({ page_number: 3, photo: '', book_id: BOOK });
    expect(docs[3].photo).toBe('https://img.example.org/3.jpg');
    expect(docs.every(d => d.id === pageIdFor(BOOK, d.page_number) && d._id.toHexString() === d.id)).toBe(true);
    expect(pageIdFor('other-book', 1)).not.toBe(pageIdFor(BOOK, 1));
    expect(docs.some(d => 'ocr' in d || 'translation' in d)).toBe(false);
  });
});
