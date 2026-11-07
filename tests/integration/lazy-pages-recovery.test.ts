/**
 * Lazy pages (#7343), the #7346 review fixes: a stranded book is recovered, a dead
 * manifest is not re-fetched on every request, and the reader neither renders a
 * partial lazy book nor turns a legacy empty book into "unavailable".
 *
 * PRIOR ART: tests/integration/lazy-pages.test.ts pins the materializer's happy
 * path and concurrency; tests/integration/lazy-pages-triggers.test.ts its callers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import {
  materializePages, recoverLazyPages, buildPageDocs, initialPagesState, _setManifestFetcherForTest,
  DEFAULT_FAILURE_COOLDOWN_MS,
} from '../../scripts/lib/lazy-pages.mjs';
import { resolveReaderPages, LazyPagesNotReadyError } from '@/lib/lazy-pages';

const BOOK = 'lazy-recover';
const N = 6;
const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  items: Array.from({ length: N }, (_, i) => ({ items: [{ items: [{ body: { id: `https://img.example.org/${i}.jpg` } }] }] })),
};
const HOUR = 60 * 60_000;

async function seed(db: Db, pagesState: Record<string, unknown> = initialPagesState()) {
  await db.collection('books').insertOne({
    id: BOOK, slug: BOOK, title: 'Lazy', visible: true, hidden: false,
    image_source: { provider: 'iiif', iiif_manifest: 'https://iiif.example.org/m.json' },
    pages_count: N, pages_translatable: N, pages_ocr: 0, pages_translated: 0, pages_blank: 0, pages_archived: 0,
    pages_state: pagesState,
  });
}
/** Write the first `k` of the book's own (deterministic) pages, as a failed or crashed attempt would. */
const writeSome = (db: Db, k: number) => db.collection('pages').insertMany(buildPageDocs(BOOK, manifest).slice(0, k));
const pageCount = (db: Db) => db.collection('pages').countDocuments({ book_id: BOOK });
const book = (db: Db) => db.collection('books').findOne({ id: BOOK });
const reread = (db: Db) => db.collection('pages').find({ book_id: BOOK }).sort({ page_number: 1 }).toArray();

/** A db whose pages.insertMany writes the first `k` docs and then dies with a non-duplicate error. */
function dbThatDiesMidInsert(db: Db, k: number): Db {
  return new Proxy(db, {
    get(target, prop) {
      if (prop !== 'collection') return Reflect.get(target, prop);
      return (name: string) => {
        const coll = target.collection(name);
        if (name !== 'pages') return coll;
        return new Proxy(coll, {
          get(c, p) {
            if (p !== 'insertMany') { const v = Reflect.get(c, p); return typeof v === 'function' ? v.bind(c) : v; }
            return async (docs: object[]) => {
              await c.insertMany(docs.slice(0, k) as never[]);
              throw Object.assign(new Error('connection reset'), { code: 6 });
            };
          },
        });
      };
    },
  });
}

describe('lazy pages: recovery and cooldown (#7346 review)', () => {
  let fetches = 0;
  let fail = false;
  beforeEach(async () => {
    await cleanDb();
    fetches = 0;
    fail = false;
    _setManifestFetcherForTest(async () => {
      fetches++;
      if (fail) throw new Error('HTTP 503');
      return manifest;
    });
  });
  afterEach(() => _setManifestFetcherForTest(null));

  it('a partial write is left manifest_only with pages, and the sync pass finishes it', async () => {
    const db = getTestDb();
    await seed(db);
    await expect(materializePages(dbThatDiesMidInsert(db, 2), BOOK, { trigger: 'archive' })).rejects.toThrow(/connection reset/);
    expect(await pageCount(db)).toBe(2);
    expect((await book(db))?.pages_state).toMatchObject({ state: 'manifest_only', error: expect.stringMatching(/connection reset/) });

    // Inside the cooldown the pass leaves it for the next run…
    let r = await recoverLazyPages(db);
    expect(r.partial).toBe(1);
    expect(r.results[0].status).toBe('cooling_down');
    expect(await pageCount(db)).toBe(2);

    // …and after it, finishes it: the two written pages are refused as duplicates, the rest added.
    r = await recoverLazyPages(db, { now: new Date(Date.now() + DEFAULT_FAILURE_COOLDOWN_MS + 60_000) });
    expect(r.results).toEqual([expect.objectContaining({ status: 'materialized', book_id: BOOK, pages: N })]);
    expect(await pageCount(db)).toBe(N);
    const after = await book(db);
    expect(after?.pages_state?.state).toBe('materialized');
    expect(after?.pages_state?.error).toBeUndefined();
    expect(after?.pages_count).toBe(N);
  });

  it('a crash left in materializing is recovered once its lease has expired, not before', async () => {
    const db = getTestDb();
    await seed(db, { state: 'materializing', since: new Date(), lease_at: new Date(), lease_by: 'dead-worker', trigger: 'archive' });
    await writeSome(db, 3);

    let r = await recoverLazyPages(db);
    expect(r).toMatchObject({ stale: 0, results: [] });
    expect(await pageCount(db)).toBe(3);

    await db.collection('books').updateOne({ id: BOOK }, { $set: { 'pages_state.lease_at': new Date(Date.now() - 10 * 60_000) } });
    r = await recoverLazyPages(db);
    expect(r.stale).toBe(1);
    expect(r.results[0]).toMatchObject({ status: 'materialized', pages: N });
    expect(await pageCount(db)).toBe(N);
    expect((await book(db))?.pages_state).toMatchObject({ state: 'materialized', trigger: 'sync-recover' });
    expect((await book(db))?.pages_state?.lease_by).toBeUndefined();
  });

  it('the sync pass leaves a plain lazy book (and a dead manifest with no pages) alone', async () => {
    const db = getTestDb();
    await seed(db, { ...initialPagesState(), failed_at: new Date(Date.now() - 3 * HOUR), error: 'manifest HTTP 404' });
    await db.collection('books').insertOne({ id: 'plain-lazy', pages_count: 4, pages_state: initialPagesState() });
    const r = await recoverLazyPages(db);
    expect(r).toMatchObject({ stale: 0, partial: 0, results: [] });
    expect(fetches).toBe(0);
  });

  it('a dead manifest is not re-fetched inside the cooldown, and attempts are counted', async () => {
    const db = getTestDb();
    await seed(db);
    fail = true;
    expect((await materializePages(db, BOOK, { trigger: 'reader' })).status).toBe('failed');
    const second = await materializePages(db, BOOK, { trigger: 'reader', waitMs: 5000 });
    expect(second).toMatchObject({ status: 'cooling_down', error: expect.stringMatching(/503/) });
    expect(second.retry_at).toBeInstanceOf(Date);
    expect(fetches).toBe(1);
    expect((await book(db))?.pages_state).toMatchObject({ state: 'manifest_only', attempts: 1 });

    fail = false;
    const later = await materializePages(db, BOOK, { trigger: 'reader', now: new Date(Date.now() + HOUR + 60_000) });
    expect(later.status).toBe('materialized');
    expect(fetches).toBe(2);
    expect((await book(db))?.pages_state).toMatchObject({ state: 'materialized', attempts: 2 });
  });
});

describe('resolveReaderPages (#7346 review 1, 3)', () => {
  let fetches = 0;
  let fail = false;
  beforeEach(async () => {
    await cleanDb();
    fetches = 0;
    fail = false;
    _setManifestFetcherForTest(async () => {
      fetches++;
      if (fail) throw new Error('HTTP 503');
      return manifest;
    });
  });
  afterEach(() => _setManifestFetcherForTest(null));

  const primary = async () => getTestDb();
  const down = async (): Promise<Db> => { throw new Error('primary unreachable'); };

  it('a lazy book that already has SOME pages is finished before it is rendered', async () => {
    const db = getTestDb();
    await seed(db);
    await writeSome(db, 2);
    const firstRead = await reread(db);
    const pages = await resolveReaderPages({ bookId: BOOK, book: (await book(db))!, bookDocIsComplete: true, firstRead, reread, getPrimaryDb: primary });
    expect(pages.map(p => p.page_number)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    expect((await book(db))?.pages_state?.state).toBe('materialized');
  });

  it('a lazy book with no pages is materialized for the reader', async () => {
    const db = getTestDb();
    await seed(db);
    const pages = await resolveReaderPages({ bookId: BOOK, book: (await book(db))!, bookDocIsComplete: true, firstRead: [], reread, getPrimaryDb: primary });
    expect(pages).toHaveLength(N);
  });

  it('a lazy book whose manifest is dead throws (never cached), and does not refetch inside the cooldown', async () => {
    const db = getTestDb();
    await seed(db);
    fail = true;
    const call = async () => resolveReaderPages({ bookId: BOOK, book: (await book(db))!, bookDocIsComplete: true, firstRead: [], reread, getPrimaryDb: primary });
    await expect(call()).rejects.toBeInstanceOf(LazyPagesNotReadyError);
    await expect(call()).rejects.toThrow(/cooling_down/);
    expect(fetches).toBe(1);
  });

  it('a lazy book with the primary down throws rather than render empty', async () => {
    const db = getTestDb();
    await seed(db);
    await expect(resolveReaderPages({ bookId: BOOK, book: (await book(db))!, bookDocIsComplete: true, firstRead: [], reread, getPrimaryDb: down }))
      .rejects.toBeInstanceOf(LazyPagesNotReadyError);
  });

  it('a legacy empty book from Atlas never touches the primary', async () => {
    let called = 0;
    const pages = await resolveReaderPages({
      bookId: 'legacy', book: { pages_count: 5 }, bookDocIsComplete: true, firstRead: [], reread,
      getPrimaryDb: async () => { called++; return getTestDb(); },
    });
    expect(pages).toEqual([]);
    expect(called).toBe(0);
  });

  it('a legacy empty book from the catalog falls back to the first read when the primary errors', async () => {
    const firstRead: never[] = [];
    const pages = await resolveReaderPages({ bookId: 'legacy', book: { pages_count: 5 }, bookDocIsComplete: false, firstRead, reread, getPrimaryDb: down });
    expect(pages).toBe(firstRead);
  });

  it('a catalog doc for a lazy book (no pages_state on it) still materializes', async () => {
    const db = getTestDb();
    await seed(db);
    const pages = await resolveReaderPages({ bookId: BOOK, book: { pages_count: N }, bookDocIsComplete: false, firstRead: [], reread, getPrimaryDb: primary });
    expect(pages).toHaveLength(N);
  });
});
