/**
 * Manifest-direct archiving (#5448 step 2): a manifest-only book is archived to R2 with NO page
 * docs, its progress lives in the book's ledger, and materializePages() then points page n at the
 * object canvas n was stored under.
 *
 * PRIOR ART: tests/integration/lazy-pages.test.ts (materialization alone; no archive ledger);
 * tests/unit/archive-miss.test.ts (the miss rules, on page docs). The pairing control below is the
 * one paired-artifacts.md asks for: each canvas serves an image of a DIFFERENT width, so a page that
 * points at its neighbour's object is caught by size, not by eye.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { materializePages, initialPagesState } from '../../scripts/lib/lazy-pages.mjs';
import { archiveFromManifest } from '../../scripts/lib/manifest-archive.mjs';
import { openLedger, ledgerKey, manifestFingerprint } from '../../scripts/lib/manifest-ledger.mjs';
import { makeBookDoc } from '../../scripts/lib/book-docs.mjs';

const BOOK = 'lazy-arch-book';
const MANIFEST_URL = 'https://iiif.example.org/lazy/manifest.json';
const BASE = 'https://images.example.org';
const N = 6;
const widthOf = (n: number) => 100 + n * 7; // canvas n's image is this wide

/** IIIF v2 manifest; canvas 4 has no image. `shift` renames every image (a changed manifest). */
function manifest(n = N, shift = '') {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': MANIFEST_URL,
    sequences: [{
      canvases: Array.from({ length: n }, (_, i) => (i === 3
        ? { '@id': `c${i}`, images: [] }
        : { '@id': `c${i}`, images: [{ resource: { '@id': `https://img.example.org/${shift}${i + 1}.jpg` } }] })),
    }],
  };
}

const jpeg = (w: number, h = 50) => sharp({ create: { width: w, height: h, channels: 3, background: { r: w % 255, g: 80, b: 120 } } }).jpeg().toBuffer();

/** A fake R2: key → bytes, answering like storagePut. */
function fakeStore() {
  const objects = new Map<string, Buffer>();
  const put = async (key: string, body: Buffer) => { objects.set(key, body); return { url: `${BASE}/${key}`, pathname: key }; };
  return { objects, put };
}

/** Image server: page n → a JPEG of width widthOf(n); `status` overrides answer an error. */
function fakeImages(status: Record<number, number> = {}, placeholder = new Set<number>()) {
  const calls: string[] = [];
  const download = async (url: string) => {
    calls.push(url);
    const n = Number(/\/(?:[a-z]*)(\d+)\.jpg$/.exec(url)?.[1]);
    if (status[n]) throw new Error(`HTTP ${status[n]}`);
    if (placeholder.has(n)) return jpeg(1, 1);
    return jpeg(widthOf(n));
  };
  return { calls, download };
}

async function seed(db: Db) {
  await db.collection('books').insertOne(makeBookDoc({
    id: BOOK, slug: BOOK, title: 'A lazy book', language: 'Latin', visible: false, hidden: true,
    image_source: { provider: 'iiif', iiif_manifest: MANIFEST_URL },
    pages_count: N, pages_state: initialPagesState(),
  }));
}

const ledgerOf = async (db: Db) => (await db.collection('books').findOne({ id: BOOK }))?.archive_metadata?.manifest_ledger;

describe('manifest-direct archiving (#5448 step 2)', () => {
  let db: Db;
  beforeEach(async () => { await cleanDb(); db = getTestDb(); await seed(db); });

  it('archives a lazy book with no page docs, then materialize points each page at ITS object (positive control)', async () => {
    const store = fakeStore();
    const img = fakeImages();
    const r = await archiveFromManifest(db, BOOK, { put: store.put, download: img.download, fetchManifest: async () => manifest() });

    expect(r.status).toBe('complete');
    expect(r.archived).toBe(N - 1);              // canvas 4 has no image
    expect(await db.collection('pages').countDocuments({ book_id: BOOK })).toBe(0); // no page docs
    expect([...store.objects.keys()].sort()).toEqual([1, 2, 3, 5, 6].map(n => ledgerKey(BOOK, n)).sort());

    const book = await db.collection('books').findOne({ id: BOOK });
    expect(book?.pages_state?.state).toBe('manifest_only');
    expect(book?.archive_status).toBe('archive_complete_with_gaps'); // the image-less canvas is a gap
    const led = book?.archive_metadata?.manifest_ledger;
    expect(led.n_done).toBe(5);
    expect(led.base).toBe(BASE);
    expect(led.complete).toBe(true);
    expect(led.fp).toBe(manifestFingerprint(manifest().sequences[0].canvases.map((c: any) => c.images[0]?.resource['@id'] ?? '')));

    // Materialize (a reader opens it): pages are born pointing at R2.
    const m = await materializePages(db, BOOK, { trigger: 'reader', fetchManifest: async () => manifest() });
    expect(m.status).toBe('materialized');
    const pages = await db.collection('pages').find({ book_id: BOOK }).sort({ page_number: 1 }).toArray();
    expect(pages).toHaveLength(N);
    for (const p of pages) {
      if (p.page_number === 4) { expect(p.archived_photo).toBeUndefined(); continue; }
      expect(p.archived_photo).toBe(`${BASE}/${ledgerKey(BOOK, p.page_number)}`);
      // It SERVES: the object exists, and it is canvas n's image, not a neighbour's.
      const bytes = store.objects.get(p.archived_photo.slice(BASE.length + 1))!;
      expect(bytes).toBeDefined();
      expect((await sharp(bytes).metadata()).width).toBe(widthOf(p.page_number));
      expect(p.image_width).toBe(widthOf(p.page_number));
      expect(p.image_height).toBe(50);
    }
    const after = await db.collection('books').findOne({ id: BOOK });
    expect(after?.pages_archived).toBe(5);       // recountBook sees the R2 pages
    expect(after?.pages_state?.pages_from_ledger).toBe(5);
  });

  it('a changed manifest applies nothing at materialize (fail closed)', async () => {
    const store = fakeStore();
    await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages().download, fetchManifest: async () => manifest() });
    const m = await materializePages(db, BOOK, { trigger: 'reader', fetchManifest: async () => manifest(N, 'x') });
    expect(m.status).toBe('materialized');
    expect(await db.collection('pages').countDocuments({ book_id: BOOK, archived_photo: { $exists: true } })).toBe(0);
    expect((await db.collection('books').findOne({ id: BOOK }))?.pages_state?.ledger_mismatch).toBe(true);
  });

  it('a changed manifest restarts the ledger on the next archive run', async () => {
    const store = fakeStore();
    await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages().download, fetchManifest: async () => manifest() });
    await db.collection('books').updateOne({ id: BOOK }, { $unset: { archive_status: '' } });
    const r = await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages().download, fetchManifest: async () => manifest(N + 1, 'x') });
    expect(r.archived).toBe(N);                  // every imaged canvas again, under the new list
    expect((await ledgerOf(db)).canvases).toBe(N + 1);
  });

  it('is resumable: a second run fetches only what is missing', async () => {
    const store = fakeStore();
    const first = fakeImages({ 2: 503, 5: 503 });
    const r1 = await archiveFromManifest(db, BOOK, { put: store.put, download: first.download, fetchManifest: async () => manifest() });
    expect(r1.status).toBe('partial');
    expect(r1.failed).toBe(2);
    expect((await db.collection('books').findOne({ id: BOOK }))?.archive_status).toBeUndefined();
    const second = fakeImages();
    const r2 = await archiveFromManifest(db, BOOK, { put: store.put, download: second.download, fetchManifest: async () => manifest() });
    expect(second.calls.map(u => Number(/(\d+)\.jpg$/.exec(u)?.[1])).sort()).toEqual([2, 5]);
    expect(r2.status).toBe('complete');
  });

  it('a 404 is a page miss; after MISS_LIMIT it is a gap, and a book with nothing left to fetch is exhausted, not re-drawn', async () => {
    const store = fakeStore();
    let r: any;
    for (let i = 0; i < 3; i++) {
      r = await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages({ 6: 404 }).download, fetchManifest: async () => manifest() });
    }
    // 2 gaps of 6 is over the 5% gap tolerance (bookVerdict): not complete, but nothing to fetch.
    expect(r.status).toBe('exhausted');
    expect(r.gaps).toBe(2);                      // canvas 4 (no image) + canvas 6 (404 ×3)
    expect((await ledgerOf(db)).exhausted).toBe(true);
    const again = fakeImages();
    await archiveFromManifest(db, BOOK, { put: store.put, download: again.download, fetchManifest: async () => manifest() });
    expect(again.calls).toHaveLength(0);
    const view = openLedger(await ledgerOf(db));
    expect(view.missCount(6)).toBe(3);
    expect(view.isDone(6)).toBe(false);
  });

  it('refuses the MDZ 1×1 over-quota placeholder: it is a throttle, never a stored page (#7371)', async () => {
    const store = fakeStore();
    const r = await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages({}, new Set([3])).download, fetchManifest: async () => manifest() });
    expect(r.failed).toBe(1);
    expect(store.objects.has(ledgerKey(BOOK, 3))).toBe(false);
    expect(openLedger(await ledgerOf(db)).isDone(3)).toBe(false);
  });

  it('materialized WHILE archiving: later pages go straight to the page docs', async () => {
    const store = fakeStore();
    // Materialize before archiving starts its first flush: every flush then finds the book not lazy.
    await materializePages(db, BOOK, { trigger: 'reader', fetchManifest: async () => manifest() });
    await db.collection('books').updateOne({ id: BOOK }, { $set: { 'pages_state.state': 'manifest_only' } }); // lazy at selection time
    const img = fakeImages();
    const download = async (u: string) => {
      // The reader's materialization lands mid-run.
      await db.collection('books').updateOne({ id: BOOK }, { $set: { 'pages_state.state': 'materialized' } });
      return img.download(u);
    };
    const r = await archiveFromManifest(db, BOOK, { put: store.put, download, fetchManifest: async () => manifest(), pageConcurrency: 1 });
    expect(r.status).toBe('materialized_meanwhile');
    const pages = await db.collection('pages').find({ book_id: BOOK, archived_photo: { $exists: true } }).sort({ page_number: 1 }).toArray();
    expect(pages.map(p => p.page_number)).toEqual([1, 2, 3, 5, 6]);
    for (const p of pages) expect((await sharp(store.objects.get(p.archived_photo.slice(BASE.length + 1))!).metadata()).width).toBe(widthOf(p.page_number));
  });

  it('never touches a book that is not lazy', async () => {
    await db.collection('books').updateOne({ id: BOOK }, { $unset: { pages_state: '' } });
    const store = fakeStore();
    const r = await archiveFromManifest(db, BOOK, { put: store.put, download: fakeImages().download, fetchManifest: async () => manifest() });
    expect(r.status).toBe('not_lazy');
    expect(store.objects.size).toBe(0);
  });
});

describe('a manifest-only book whose pages all 500 (#5448)', () => {
  it('is abandoned after FAIL_STREAK requests without pausing the host', async () => {
    await cleanDb();
    const db = getTestDb();
    await seed(db);
    const { createHostBreaker } = await import('../../scripts/lib/host-breaker.mjs');
    const { FAIL_STREAK } = await import('../../scripts/lib/archive-miss.mjs');
    const breaker = createHostBreaker();
    const calls: string[] = [];
    const r = await archiveFromManifest(db, BOOK, {
      put: fakeStore().put, breaker, pageConcurrency: 1, fetchManifest: async () => manifest(),
      download: async (u: string) => { calls.push(u); throw new Error('HTTP 500'); },
    });
    expect(calls).toHaveLength(FAIL_STREAK);
    expect(r.status).toBe('partial');
    expect(breaker.allow('img.example.org')).toBe(true);
  });
});

describe('a miss from a host that has served nothing this run is not kept (#5448)', () => {
  it('outage-time 404s leave the ledger clean; once the host serves, a 404 is recorded', async () => {
    await cleanDb();
    const db = getTestDb();
    await seed(db);
    const { createHostBreaker } = await import('../../scripts/lib/host-breaker.mjs');
    const { openLedger } = await import('../../scripts/lib/manifest-ledger.mjs');
    // Run 1: the host answers 404 to everything (an outage). Nothing is kept.
    await archiveFromManifest(db, BOOK, { put: fakeStore().put, breaker: createHostBreaker(), pageConcurrency: 1, fetchManifest: async () => manifest(), download: async () => { throw new Error('HTTP 404'); } });
    let led = (await db.collection('books').findOne({ id: BOOK }))!.archive_metadata.manifest_ledger;
    for (const p of [1, 2, 3, 5, 6]) expect(openLedger(led).missCount(p)).toBe(0);
    // Run 2: the host serves, but page 6 is really gone. That miss is kept.
    const img = fakeImages({ 6: 404 });
    await archiveFromManifest(db, BOOK, { put: fakeStore().put, breaker: createHostBreaker(), pageConcurrency: 1, fetchManifest: async () => manifest(), download: img.download });
    led = (await db.collection('books').findOne({ id: BOOK }))!.archive_metadata.manifest_ledger;
    expect(openLedger(led).missCount(6)).toBe(1);
  });
});
