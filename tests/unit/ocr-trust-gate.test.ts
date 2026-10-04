/**
 * The OCR trust gate (scripts/lib/ocr-trust-gate.mjs, #5700): translate only where the OCR is
 * trusted. Pins the table's strata against #5695's negative controls (Greek print 1800+ and Hebrew
 * print are NOT gated), the free-text year rule, the way OUT (a re-read by a better reader after
 * the gate date), and that every translation enrol path asks the gate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  OCR_TRUST_TABLE, OCR_TRUST_GATE_SINCE, RELEASE_SHARE,
  editionYear, bookHand, ocrTrustStratum, ocrTrustVerdict, ocrTrustCandidate, isReread, isOcrTrustRefusal,
  loadOcrProfile, ocrTrustVerdictForBook, ocrTrustGate,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/ocr-trust-gate.mjs';

type Doc = Record<string, unknown>;
const PRINT = { printed: 200, handwritten: 2, mixed: 3, ocr: 205, reread: {} };
const HAND = { printed: 4, handwritten: 180, mixed: 0, ocr: 184, reread: {} };
const UNTYPED = { printed: 0, handwritten: 0, mixed: 0, ocr: 150, reread: {} };

describe('editionYear — books.published is free text', () => {
  it('reads the year the census reads, never a parseInt', () => {
    expect(editionYear({ published: 'Venice, 1499' })).toBe(1499);
    expect(editionYear({ published: 'c. 1550' })).toBe(1550);
    expect(editionYear({ published: '[1617?]' })).toBe(1617);
    expect(editionYear({ published: '1473-1480' })).toBe(1473);
    expect(editionYear({ year: 1495, published: 'Reprint 1839' })).toBe(1495);   // `year` wins, as in the census
    expect(editionYear({ published: '15th century' })).toBeNull();
    expect(editionYear({ published: 'Aldus' })).toBeNull();
    expect(editionYear({})).toBeNull();
  });
});

describe('bookHand — from pages.script_type, never guessed', () => {
  it('manuscript, print, and unknown below the typed-page floor', () => {
    expect(bookHand(HAND)).toBe('manuscript');
    expect(bookHand(PRINT)).toBe('print');
    expect(bookHand(UNTYPED)).toBe('unknown');
    expect(bookHand({ handwritten: 2, printed: 0, mixed: 0 })).toBe('unknown');
    expect(bookHand(null)).toBe('unknown');
  });
});

describe('the strata', () => {
  const v = (book: Doc, profile: Doc = PRINT) => ocrTrustVerdict(book, profile);

  it('gates the four measured strata, with the stratum and #5700 in the reason', () => {
    expect(v({ language: 'Greek', published: '1100' }, HAND)).toMatchObject({ ok: false, stratum: 'greek-manuscript' });
    expect(v({ language: 'Ancient Greek' }, HAND)).toMatchObject({ ok: false, stratum: 'greek-manuscript' });   // undated manuscripts too
    expect(v({ language: 'Greek', published: 'Venetiis, 1518' })).toMatchObject({ ok: false, stratum: 'greek-print-1450-1599' });
    expect(v({ language: 'Greek-Latin', year: 1599 })).toMatchObject({ ok: false, stratum: 'greek-print-1450-1599' });
    expect(v({ language: 'Persian', published: '1850' })).toMatchObject({ ok: false, stratum: 'persian' });
    expect(v({ language: 'Persian' }, HAND)).toMatchObject({ ok: false, stratum: 'persian' });
    expect(v({ language: 'Latin', published: '1495' })).toMatchObject({ ok: false, stratum: 'latin-incunabula' });
    expect(v({ language: 'Greek', published: '1518' }).reason).toMatch(/^ocr-untrusted \(greek-print-1450-1599; re-read 0\/205 pages, #5700\)$/);
  });

  it('a dated book whose pages carry no script tag is taken by its year row, not waved through', () => {
    expect(v({ language: 'Greek', published: '1550' }, UNTYPED)).toMatchObject({ ok: false, stratum: 'greek-print-1450-1599' });
    expect(v({ language: 'Latin', published: '1480' }, UNTYPED)).toMatchObject({ ok: false, stratum: 'latin-incunabula' });
  });

  it('NEGATIVE CONTROLS (#5695): Greek print 1800+ and 1600–1799, Hebrew, Arabic, later Latin are not gated', () => {
    expect(v({ language: 'Greek', published: '1805' })).toEqual({ ok: true });
    expect(v({ language: 'Ancient Greek', published: 'Leipzig, 1890' })).toEqual({ ok: true });
    expect(v({ language: 'Greek', published: '1600' })).toEqual({ ok: true });
    expect(v({ language: 'Greek', published: '1799' })).toEqual({ ok: true });
    expect(v({ language: 'Hebrew', published: '1560' })).toEqual({ ok: true });
    expect(v({ language: 'Hebrew and Aramaic', published: '1520' })).toEqual({ ok: true });
    expect(v({ language: 'Arabic', published: '1300' }, HAND)).toEqual({ ok: true });
    expect(v({ language: 'Latin', published: '1501' })).toEqual({ ok: true });
    expect(v({ language: 'Latin', published: '1650' })).toEqual({ ok: true });
    expect(v({ language: 'Latin' })).toEqual({ ok: true });                          // undated Latin
    expect(v({ language: 'Latin', published: '1480' }, HAND)).toEqual({ ok: true }); // a Latin manuscript: not the measured stratum
    expect(v({ language: 'Tibetan' })).toEqual({ ok: true });
    expect(v(null)).toEqual({ ok: true });
  });

  it('matches the FIRST language label only, as translation routing does', () => {
    expect(v({ language: 'Latin; Greek', published: '1520' })).toEqual({ ok: true });
    expect(v({ language: 'Hebrew, Judeo-Persian, and Aramaic' })).toEqual({ ok: true });
  });

  it('an undated Greek book of unknown hand is not gated (nothing says which stratum it is)', () => {
    expect(v({ language: 'Greek' }, UNTYPED)).toEqual({ ok: true });
  });

  it('a listed row with gated: false is reported but lets the book through', () => {
    const table = OCR_TRUST_TABLE.map((r: Doc) => (r.id === 'latin-incunabula' ? { ...r, gated: false } : r));
    expect(ocrTrustVerdict({ language: 'Latin', published: '1495' }, PRINT, table)).toEqual({ ok: true, stratum: 'latin-incunabula' });
    expect(ocrTrustCandidate({ language: 'Latin', published: '1495' }, table)).toBe(false);
  });

  it('every row cites its #5695 evidence, a gate date and at least one reader (the table is the edit surface)', () => {
    expect(OCR_TRUST_TABLE.map((r: Doc) => r.id)).toEqual(['greek-manuscript', 'greek-print-1450-1599', 'persian', 'latin-incunabula']);
    for (const r of OCR_TRUST_TABLE) {
      expect(r.evidence).toMatch(/#5695 T\d/);
      expect(typeof r.gated).toBe('boolean');
      expect(Number.isNaN(+new Date(r.since))).toBe(false);
      expect(r.readers.length).toBeGreaterThan(0);
    }
  });
});

describe('the way out — a re-read by a better reader after the gate date', () => {
  const row = OCR_TRUST_TABLE[0];
  const after = new Date('2026-10-20T00:00:00Z');
  const before = new Date('2026-09-01T00:00:00Z');

  it('a page counts as re-read only when BOTH the reader and the date say so', () => {
    expect(isReread({ ocr: { model: 'gemini-3.1-pro-preview', updated_at: after } }, row)).toBe(true);
    expect(isReread({ ocr: { source: 'kraken', updated_at: after } }, row)).toBe(true);
    expect(isReread({ ocr: { source: 'manual', updated_at: after } }, row)).toBe(true);
    expect(isReread({ ocr: { model: 'gemini-3.1-pro-preview', updated_at: before } }, row)).toBe(false);          // the old read
    expect(isReread({ ocr: { model: 'gemini-3.1-flash-lite', updated_at: after } }, row)).toBe(false);           // the measured reader, again
    expect(isReread({ ocr: { model: 'gemini-3-flash-preview', updated_at: after } }, row)).toBe(false);
    expect(isReread({ ocr: { model: 'gemini-3.1-pro-preview' } }, row)).toBe(false);                             // no date, no claim
    expect(new Date(OCR_TRUST_GATE_SINCE) <= after).toBe(true);
  });

  it('releases at RELEASE_SHARE of the OCR\'d pages, not before', () => {
    const book = { language: 'Greek', published: '1518' };
    const at = (n: number) => ({ ...PRINT, ocr: 100, reread: { 'greek-print-1450-1599': n } });
    expect(ocrTrustVerdict(book, at(89))).toMatchObject({ ok: false });
    expect(ocrTrustVerdict(book, at(Math.ceil(RELEASE_SHARE * 100)))).toEqual({ ok: true, stratum: 'greek-print-1450-1599', released: true });
    // re-reads counted for ANOTHER row do not release this one
    expect(ocrTrustVerdict(book, { ...PRINT, ocr: 100, reread: { persian: 100 } })).toMatchObject({ ok: false });
    // a book with no OCR'd pages is not "released" by 0/0
    expect(ocrTrustVerdict(book, { ...PRINT, ocr: 0, reread: {} })).toMatchObject({ ok: false });
  });
});

describe('against a database', () => {
  const pagesOf = (n: number, over: Doc = {}) => Array.from({ length: n }, (_, i) => ({ book_id: 'b', page_number: i + 1, script_type: 'printed', ocr: { model: 'gemini-3.1-flash-lite', updated_at: new Date('2026-08-01') }, ...over }));
  function fakeDb(book: Doc, pages: Doc[]) {
    const calls = { pages: 0, books: 0, events: [] as Doc[] };
    return {
      calls,
      collection(name: string) {
        if (name === 'pages') return { find: () => { calls.pages += 1; return { toArray: async () => pages }; } };
        if (name === 'books') return { findOne: async () => { calls.books += 1; return book; } };
        return { updateOne: async (f: Doc, u: Doc, o: Doc) => { calls.events.push({ f, u, o }); return {}; } };
      },
    };
  }

  it('builds the profile from script_type and the OCR stamps', async () => {
    const pages = [...pagesOf(8), ...pagesOf(2, { ocr: { model: 'gemini-3.1-pro-preview', updated_at: new Date('2026-11-01') } }), { book_id: 'b', page_number: 11, script_type: 'handwritten', ocr: { unreadable: true, model: 'x' } }];
    const p = await loadOcrProfile(fakeDb({}, pages), 'b');
    expect(p).toMatchObject({ printed: 10, handwritten: 1, ocr: 10 });
    expect(p.reread['greek-print-1450-1599']).toBe(2);
  });

  it('reads no pages for a book no gated row could take', async () => {
    const db = fakeDb({}, pagesOf(5));
    expect(await ocrTrustVerdictForBook(db, { id: 'b', language: 'Latin', published: '1650' })).toEqual({ ok: true });
    expect(await ocrTrustVerdictForBook(db, { id: 'b', language: 'German', published: '1480' })).toEqual({ ok: true });
    expect(db.calls.pages).toBe(0);
  });

  it('a book handed over under a projection without year/published is re-read, not treated as undated', async () => {
    const db = fakeDb({ id: 'b', language: 'Latin', published: 'Venetiis, 1495' }, pagesOf(5));
    const res = await ocrTrustVerdictForBook(db, { id: 'b', language: 'Latin' });
    expect(db.calls.books).toBe(1);
    expect(res).toMatchObject({ ok: false, stratum: 'latin-incunabula' });
  });

  it('ocrTrustGate records ONE upserted book_events row per (book, stratum); a dry run and an override record nothing', async () => {
    const book = { id: 'b', language: 'Persian', published: '1850' };
    const db = fakeDb(book, pagesOf(5));
    const res = await ocrTrustGate(db, book, { lane: 'chained-enrol' });
    expect(res.ok).toBe(false);
    expect(db.calls.events).toHaveLength(1);
    const { f, u, o } = db.calls.events[0] as Record<string, Record<string, unknown>>;
    expect(f).toEqual({ book_id: 'b', type: 'ocr_trust_refusal', 'details.stratum': 'persian' });
    expect(o).toEqual({ upsert: true });
    expect(u.$inc).toEqual({ 'details.refusals': 1 });
    expect(u.$addToSet).toEqual({ 'details.lanes': 'chained-enrol' });
    await ocrTrustGate(db, book, { lane: 'x', record: false });
    expect(await ocrTrustGate(db, book, { lane: 'pilot', allow: true })).toMatchObject({ ok: true, overridden: true, stratum: 'persian' });
    expect(db.calls.events).toHaveLength(1);
  });

  it('isOcrTrustRefusal recognises the reason and nothing else', () => {
    expect(isOcrTrustRefusal('ocr-untrusted (persian; re-read 0/5 pages, #5700)')).toBe(true);
    expect(isOcrTrustRefusal('book-held (x)')).toBe(false);
    expect(isOcrTrustRefusal(undefined)).toBe(false);
  });
});

/**
 * The sweeping check: a file that picks a translation MODEL for a book is a file that sends the
 * book to be translated, and must ask the gate. A new enrol path that forgets fails here, not in
 * production (CLAUDE.md: "don't guard a single helper and call it done").
 */
describe('every translation enrol path asks the gate', () => {
  const ROOT = path.resolve(__dirname, '../..');
  // Not enrol paths, with the reason each is exempt.
  const EXEMPT: Record<string, string> = {
    'scripts/lib/translate-core.mjs': 'defines the router; writePageTranslation is the write door, reached only through gated lanes',
    'scripts/lib/ocr-routing.mjs': 'a comment about the split',
    'src/lib/types/ai-models.ts': 'the TS twin of the router',
    'src/data/public-models.ts': 'a comment',
    'src/workers/translation-processor-logic.ts': 'the Lambda processor: consumes jobs queued by the gated /api/jobs/queue-books route',
    'scripts/maintenance/relabel-language-4884.mjs': 'asks the router only to REPORT the model before and after a language relabel (#4884); enrols and translates nothing',
  };
  const files = execSync("git grep -l getTranslateModelForBook -- scripts/lib scripts/batch scripts/workers scripts/maintenance src ':!*.test.ts' ':!*.md'", { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);

  it('finds the enrol paths', () => {
    expect(files).toEqual(expect.arrayContaining([
      'scripts/lib/translate-batch-chained.mjs', 'scripts/lib/translate-batch-seam.mjs', 'scripts/workers/translate-worker.mjs',
      'scripts/workers/pipeline-orchestrator.mjs', 'src/app/api/jobs/queue-books/route.ts',
    ]));
  });

  for (const f of files) {
    if (EXEMPT[f]) continue;
    it(`${f} calls ocrTrustGate`, () => {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toMatch(/ocrTrustGate\(/);
    });
  }
});
