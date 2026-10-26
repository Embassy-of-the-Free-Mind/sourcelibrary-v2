/**
 * The wave importer (#7343): a candidate becomes ONE hidden, held,
 * archive-blocked book; `manifestOnly` writes the true page count and no pages.
 *
 * PRIOR ART: tests/integration/lazy-pages.test.ts pins the materializer and the
 * counters on a hand-seeded lazy book; nothing pinned what an importer writes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId, type Db } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import {
  importCandidate, isHijriSuspect, HostParker, spreadSample, licenseOf, canonicalLanguage,
} from '../../scripts/iiif-discovery/lib/wave-import.mjs';
import { materializePages, pageIdFor, PAGES_MATERIALIZED_FILTER } from '../../scripts/lib/lazy-pages.mjs';
import { recountBook } from '../../scripts/lib/page-counts.mjs';
import { syncPageCounts } from '../../scripts/workers/sync-worker.mjs';

const N = 9;
const MANIFEST_URL = 'https://iiif.example.org/bsb0001/manifest';
const HOLD = { reason: 'manifest-only-lazy-pages', release: 'Derek releases them for OCR', issue: 7343 };
const CAMPAIGN = 'acquisition-wave-test';

function manifest(n = N) {
  return {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    '@id': MANIFEST_URL,
    license: 'http://creativecommons.org/publicdomain/mark/1.0/',
    sequences: [{ canvases: Array.from({ length: n }, (_, i) => ({ '@id': `c${i}`, images: [{ resource: { '@id': `https://img.example.org/${i}/full/full/0/default.jpg` } }] })) }],
  };
}

async function seedCandidate(db: Db, extra: Record<string, unknown> = {}) {
  const _id = new ObjectId();
  await db.collection('import_candidates').insertOne({
    _id, source: 'bsb', source_id: 'bsb0001', manifest_url: MANIFEST_URL, status: 'discovered',
    title: 'Historia naturalis', author: 'Plinius', date_text: '1530', date_earliest: 1530,
    source_url: 'https://www.digitale-sammlungen.de/view/bsb0001', provider_name: 'MDZ', ...extra,
  });
  return db.collection('import_candidates').findOne({ _id });
}

const opts = (over: Record<string, unknown> = {}) => ({
  fetchManifest: async () => manifest(), language: 'Latin', campaign: CAMPAIGN, hold: HOLD, manifestOnly: true, ...over,
});

describe('importCandidate (#7343)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('manifest-only: one hidden, held, archive-blocked book with the true count and no page docs', async () => {
    const db = getTestDb();
    const c = await seedCandidate(db);
    const r = await importCandidate(db, c, opts());
    expect(r.outcome).toBe('imported');
    expect(r.pages).toBe(N);

    const b = await db.collection('books').findOne({ id: r.book_id });
    expect(b?.pages_count).toBe(N);
    expect(b?.pages_state?.state).toBe('manifest_only');
    expect(b?.hidden).toBe(true);
    expect(b?.visible).toBe(false);
    expect(b?.pipeline_auto?.status).toBe('held');
    expect(b?.pipeline_auto?.hold?.reason).toBe(HOLD.reason);
    expect(b?.archive_metadata?.blocked).toBe(true);
    expect(b?.acquisition_campaign).toBe(CAMPAIGN);
    expect(b?.image_source?.iiif_manifest).toBe(MANIFEST_URL);
    expect(b?.image_source?.license).toBe('publicdomain');
    expect(b?.language).toBe('Latin');
    expect(b?.thumbnail).toMatch(/^https:\/\/img\.example\.org\/0\//);
    expect(await db.collection('pages').countDocuments({})).toBe(0);
    // No lane that pays for work over pages can select it.
    expect(await db.collection('books').countDocuments({ id: r.book_id, ...PAGES_MATERIALIZED_FILTER })).toBe(0);

    expect((await db.collection('import_candidates').findOne({ _id: c!._id }))?.status).toBe('imported');
    expect(await db.collection('book_events').countDocuments({ book_id: r.book_id, type: 'pipeline_hold' })).toBe(1);
  });

  it('the declared count survives the counter writers, and materializing gives the same count', async () => {
    const db = getTestDb();
    const r = await importCandidate(db, await seedCandidate(db), opts());
    await recountBook(db, r.book_id, { reason: 'test' });
    await syncPageCounts(db);
    await syncPageCounts(db);
    expect((await db.collection('books').findOne({ id: r.book_id }))?.pages_count).toBe(N);

    const m = await materializePages(db, r.book_id, { trigger: 'reader', fetchManifest: async () => manifest() });
    expect(m.status).toBe('materialized');
    const pages = await db.collection('pages').find({ book_id: r.book_id }).sort({ page_number: 1 }).toArray();
    expect(pages).toHaveLength(N);
    expect(pages[0].id).toBe(pageIdFor(r.book_id, 1));
    expect(pages[0].photo).toMatch(/^https:\/\/img\.example\.org\//);
    expect((await db.collection('books').findOne({ id: r.book_id }))?.pages_count).toBe(N);
  });

  it('without manifestOnly the pages are written at once through the materializer', async () => {
    const db = getTestDb();
    const r = await importCandidate(db, await seedCandidate(db), opts({ manifestOnly: false }));
    expect(r.outcome).toBe('materialized');
    expect(await db.collection('pages').countDocuments({ book_id: r.book_id })).toBe(N);
    expect((await db.collection('books').findOne({ id: r.book_id }))?.pages_state?.state).toBe('materialized');
  });

  it('the gate declines a second copy of the same digital object', async () => {
    const db = getTestDb();
    await importCandidate(db, await seedCandidate(db), opts());
    const again = await importCandidate(db, await seedCandidate(db), opts());
    expect(again.outcome).toBe('gate_declined');
    expect(await db.collection('books').countDocuments({})).toBe(1);
  });

  it('skips: an imported row, too few canvases, a failed fetch, a Hijri-suspect date', async () => {
    const db = getTestDb();
    expect((await importCandidate(db, await seedCandidate(db, { status: 'imported' }), opts())).outcome).toBe('not_candidate');
    expect((await importCandidate(db, await seedCandidate(db), opts({ fetchManifest: async () => manifest(3) }))).outcome).toBe('too_few_canvases');
    const failed = await importCandidate(db, await seedCandidate(db), opts({ fetchManifest: async () => { throw new Error('HTTP 403'); } }));
    expect(failed).toMatchObject({ outcome: 'fetch_failed', http_status: 403 });
    expect((await importCandidate(db, await seedCandidate(db, { date_text: '1250' }), opts({ language: 'Arabic' }))).outcome).toBe('hijri_suspect');
    expect(await db.collection('books').countDocuments({})).toBe(0);
  });

  it('a dry run fetches and counts but writes nothing', async () => {
    const db = getTestDb();
    const r = await importCandidate(db, await seedCandidate(db), opts({ dryRun: true }));
    expect(r).toMatchObject({ outcome: 'dry_run', pages: N });
    expect(await db.collection('books').countDocuments({})).toBe(0);
  });
});

describe('wave-import helpers', () => {
  it('isHijriSuspect: one number in an Arabic-script row is suspect; a CE gloss is not', () => {
    expect(isHijriSuspect('Arabic', '1250')).toBe(true);
    expect(isHijriSuspect('Persian', '1250 [1834]')).toBe(false);
    expect(isHijriSuspect('Latin', '1530')).toBe(false);
  });

  it('HostParker parks after two identical refusals in a row, and any other outcome resets', () => {
    const p = new HostParker(2);
    expect(p.note('a', 403)).toBe(false);
    expect(p.note('a', undefined)).toBe(false);
    expect(p.note('a', 403)).toBe(false);
    expect(p.note('a', 403)).toBe(true);
    expect(p.isParked('a')).toBe(true);
    expect(p.note('b', 404)).toBe(false);
    expect(p.note('b', 404)).toBe(false);
  });

  it('spreadSample takes from every source × language cell before a second from any', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ source: 'bsb', language: 'Latin', i })),
      { source: 'sbb', language: 'German', i: 0 },
      { source: 'ia', language: 'French', i: 0 },
    ];
    const s = spreadSample(rows, 4);
    expect(s.map(r => r.source).sort()).toEqual(['bsb', 'bsb', 'ia', 'sbb']);
  });

  it('canonicalLanguage maps catalogue names in Italian and "no language" phrases; keeps the rest', () => {
    expect(canonicalLanguage('Greco')).toBe('Greek');
    expect(canonicalLanguage('Italiano')).toBe('Italian');
    expect(canonicalLanguage('Sans contenu linguistique')).toBe('Unknown');
    expect(canonicalLanguage('Latin')).toBe('Latin');
    expect(canonicalLanguage('')).toBe('Unknown');
    expect(canonicalLanguage('Old Norse')).toBe('Old Norse');
  });

  it('licenseOf reads v2 license and v3 rights', () => {
    expect(licenseOf({ rights: 'http://creativecommons.org/publicdomain/zero/1.0/' })).toBe('publicdomain');
    expect(licenseOf({ license: 'https://rightsstatements.org/vocab/NoC-NC/1.0/' })).toBe('https://rightsstatements.org/vocab/NoC-NC/1.0/');
    expect(licenseOf({})).toBe('unknown');
  });
});
