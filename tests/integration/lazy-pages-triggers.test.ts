/**
 * Lazy pages (#7343): every trigger that needs a book's pages goes through the one
 * materializer — releasing the pipeline hold (OCR dispatch) and publishing — and a
 * book whose pages cannot be created is neither dispatched nor published.
 *
 * PRIOR ART: tests/integration/lazy-pages.test.ts pins the materializer itself;
 * this file pins its callers.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { initialPagesState, _setManifestFetcherForTest } from '../../scripts/lib/lazy-pages.mjs';
import { holdBook, releaseBook } from '../../scripts/lib/pipeline-hold.mjs';
import * as mjsPublication from '../../scripts/lib/publication.mjs';
import * as tsPublication from '@/lib/publication';

const BOOK = 'lazy-trigger';
const N = 4;
const manifest = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  items: Array.from({ length: N }, (_, i) => ({ items: [{ items: [{ body: { id: `https://img.example.org/${i}.jpg` } }] }] })),
};

async function seed(db: Db) {
  await db.collection('books').insertOne({
    id: BOOK, slug: BOOK, title: 'Lazy', visible: false, hidden: true,
    image_source: { provider: 'iiif', iiif_manifest: 'https://iiif.example.org/m.json' },
    pages_count: N, pages_translatable: N, pages_ocr: 0, pages_translated: 0, pages_blank: 0, pages_archived: 0,
    pages_state: initialPagesState(),
  });
}
const pages = (db: Db) => db.collection('pages').countDocuments({ book_id: BOOK });
const book = (db: Db) => db.collection('books').findOne({ id: BOOK });

describe('lazy-pages triggers (#7343)', () => {
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

  it('releasing the hold materializes first, then re-enters at queued (not ocr_complete)', async () => {
    const db = getTestDb();
    await seed(db);
    await holdBook(db, BOOK, { reason: 'manifest-only-lazy-pages', release: 'released when someone dispatches it', release_when: { kind: 'issue', ref: 7343 } });
    expect(await pages(db)).toBe(0);
    const res = await releaseBook(db, BOOK, { note: 'dispatch' });
    expect(res).toMatchObject({ outcome: 'released', to: 'queued' });
    expect(await pages(db)).toBe(N);
    expect((await book(db))?.pages_state?.state).toBe('materialized');
  });

  it('a release whose pages cannot be created leaves the book held, with its count', async () => {
    const db = getTestDb();
    await seed(db);
    await holdBook(db, BOOK, { reason: 'manifest-only-lazy-pages', release: 'released when someone dispatches it', release_when: { kind: 'issue', ref: 7343 } });
    fail = true;
    const res = await releaseBook(db, BOOK, { note: 'dispatch' });
    expect(res.outcome).toBe('pages_not_ready');
    const b = await book(db);
    expect(b?.pipeline_auto?.status).toBe('held');
    expect(b?.pages_count).toBe(N);
    expect(await pages(db)).toBe(0);
  });

  for (const [name, pub] of [['mjs', mjsPublication], ['ts', tsPublication]] as const) {
    it(`${name} setPublication('public') materializes before the book goes public`, async () => {
      const db = getTestDb();
      await seed(db);
      const res = await pub.setPublication(db, BOOK, { state: 'public', by: 'test', evict: false } as never);
      expect(res.status).toBe('written');
      expect(await pages(db)).toBe(N);
      expect((await book(db))?.visible).toBe(true);
    });

    it(`${name} setPublication('public') refuses when the pages cannot be created`, async () => {
      const db = getTestDb();
      await seed(db);
      fail = true;
      await expect(pub.setPublication(db, BOOK, { state: 'public', by: 'test', evict: false } as never)).rejects.toThrow(/failed/);
      const b = await book(db);
      expect(b?.visible).toBe(false);
      expect(await pages(db)).toBe(0);
    });

    it(`${name} setPublicationMany refuses only the book whose pages cannot be created`, async () => {
      const db = getTestDb();
      await seed(db);
      await db.collection('books').insertOne({ id: 'plain', slug: 'plain', pages_count: 2, visible: false, hidden: true });
      fail = true;
      const res = await pub.setPublicationMany(db, [BOOK, 'plain'], { state: 'public', by: 'test', evict: false } as never);
      expect(res.refused).toEqual([BOOK]);
      expect(res.written).toEqual(['plain']);
    });
  }
});
