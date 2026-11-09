import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import fixtures from '../fixtures/facing-translation-8321.json';
import { setInProcessCaller } from '@/lib/inprocess-caller';

/** get_book_text reaches /text in-process (src/lib/mcp-inprocess.ts); mark the request the same way (#8235). */
function asMcpCall(req: NextRequest): NextRequest {
  setInProcessCaller(req, { kind: 'anon' });
  return req;
}

/**
 * A facing-page Loeb serves the PUBLISHED English, from every door (#8321).
 *
 * The fixtures are copied from production (tests/fixtures/facing-translation-8321.json,
 * 2026-11-07), never written toward the verdict:
 *
 * - L118: Herodotus, The Persian Wars II (Loeb, Godley 1921), catalogued Greek.
 *   Scan 321 (printed p. 296) is Greek; scan 322 (p. 297) is Godley's English, over
 *   which the stored "translation" rewords IV.95 — "the Thracians were a
 *   meanly-living and simple-witted folk" became "a people who lived quite
 *   simply and were somewhat naive".
 * - LATIN: Cicero, De Senectute (Loeb, Falconer 1923), catalogued Latin. Scans
 *   40/41, printed pp. 28/29.
 * - CONTROL: the same L118 leaves on a copy of the book WITHOUT the flag, which
 *   must read exactly as before (a corpus-wide "English leaf → OCR" rule is
 *   unsafe: most English leaves of non-English books are library stamps).
 */

type Doc = Record<string, unknown>;
type PageFx = { id: string; book_id: string; page_number: number; ocr: { data: string }; translation: { data: string }; printed_page?: { label: string } };
const L118_BOOK = fixtures.l118.book as unknown as Doc & { id: string; slug: string };
const [L118_GREEK, L118_ENGLISH] = fixtures.l118.pages as unknown as PageFx[];
const LATIN_BOOK = fixtures.latin.book as unknown as Doc & { id: string; slug: string };
const [LATIN_LATIN, LATIN_ENGLISH] = fixtures.latin.pages as unknown as PageFx[];

const GODLEY = 'the Thracians were a meanly-living and simple-witted folk';
const REWORDING = 'somewhat naive';
const FALCONER = 'would he be repenting of his old age';

// The unflagged control: same leaves, book without `facing_translation`.
const CONTROL_BOOK = { ...L118_BOOK, id: 'control-l118', slug: 'control-l118' } as Doc & { id: string };
delete (CONTROL_BOOK as Doc).facing_translation;
const CONTROL_ENGLISH = { ...L118_ENGLISH, id: 'control-322', book_id: CONTROL_BOOK.id };
const CONTROL_GREEK = { ...L118_GREEK, id: 'control-321', book_id: CONTROL_BOOK.id };

// ── A minimal in-memory Mongo (same shape as english-original-serve.test.ts) ──
const store: Record<string, Doc[]> = { books: [], pages: [], chapter_texts: [] };
function get(doc: Doc, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Doc)[k] : undefined), doc);
}
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    const v = k === '_id' ? doc.id : get(doc, k);
    if (cond === null) return v == null;
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Doc;
      if ('$in' in c) return (c.$in as unknown[]).map(String).includes(String(v));
      // Ranges as Mongo reads them, so a door that asks for the wrong pages is seen to.
      if ('$gte' in c || '$lte' in c || '$gt' in c || '$lt' in c) {
        if (typeof v !== 'number') return false;
        return (!('$gte' in c) || v >= (c.$gte as number)) && (!('$lte' in c) || v <= (c.$lte as number))
          && (!('$gt' in c) || v > (c.$gt as number)) && (!('$lt' in c) || v < (c.$lt as number));
      }
      if ('$exists' in c || '$nin' in c || '$ne' in c) return true;
      return String(v) === String(cond);
    }
    return v === cond || String(v) === String(cond);
  });
}
// An inclusion projection as Mongo applies it, so a door that leaves a field
// out of its projection is seen to (review of af03c609, finding 1).
function applyProjection(doc: Doc, proj?: Record<string, unknown>): Doc {
  const keep = Object.entries(proj || {}).filter(([, v]) => v === 1 || v === true).map(([k]) => k);
  if (!keep.length) return doc;
  const out: Doc = {};
  for (const path of keep) {
    const v = get(doc, path);
    if (v === undefined) continue;
    const keys = path.split('.');
    let o = out;
    for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Doc;
    o[keys[keys.length - 1]] = structuredClone(v);
  }
  return out;
}
function cursor(docs: Doc[], initial?: Record<string, unknown>) {
  let proj = initial;
  const c = {
    project: (p: Record<string, unknown>) => { proj = p; return c; },
    sort: () => c, limit: () => c, skip: () => c, maxTimeMS: () => c,
    toArray: async () => docs.map((d) => applyProjection(structuredClone(d), proj)),
  };
  return c;
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (filter: Doc) => {
      const d = (store[name] || []).find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    },
    find: (filter: Doc = {}, opts?: { projection?: Record<string, unknown> }) =>
      cursor((store[name] || []).filter((x) => matches(x, filter)), opts?.projection),
    aggregate: () => cursor([]),
    countDocuments: async () => 0,
    updateOne: async () => ({}),
    insertOne: async () => ({}),
  }),
};

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => fakeDb,
  getReadDb: async () => fakeDb,
  default: Promise.resolve({ db: () => fakeDb }),
}));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));
// The page package (a signed-in member's download): no cap, no scan fetch.
vi.mock('@/lib/membership-status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/membership-status')>()),
  sessionHasMemberBenefits: () => true,
}));
vi.mock('@/lib/purchases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/purchases')>()),
  classifyImageAccess: async () => 'blocked', hasPurchased: async () => false,
}));
// /book/[id]/read: the request-side gates, off (a reader in a browser, no tenant).
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/tenant-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-context')>()),
  getTenantContext: async () => null,
  resolveTenantId: async (slug: string) => (slug === 'loeb-room' ? 'tenant-loeb' : null),
}));
vi.mock('@/lib/tenant-catalog-books', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant-catalog-books')>()),
  findBookForTenant: async (db: typeof fakeDb, id: string) => {
    const book = await db.collection('books').findOne({ id });
    return book ? { book } : null;
  },
}));
vi.mock('@/lib/metered-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/metered-gate')>()),
  isMeteredAnonRequest: async () => false,
}));
vi.mock('@/lib/hunt-payloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/hunt-payloads')>()),
  primeHuntPayloads: async () => {},
}));
vi.mock('@/lib/auth-helpers', () => ({
  withAuth: (h: unknown) => h, withAdminAuth: (h: unknown) => h,
  isInnerCircle: async () => false, getSessionRole: async () => null,
}));

beforeEach(() => {
  store.books = [L118_BOOK, LATIN_BOOK, CONTROL_BOOK] as unknown as Doc[];
  store.pages = [L118_GREEK, L118_ENGLISH, LATIN_LATIN, LATIN_ENGLISH, CONTROL_GREEK, CONTROL_ENGLISH] as unknown as Doc[];
  store.chapter_texts = [];
});

const stripMarks = (s: unknown) => String(s ?? '').replace(/[​-‏⁠-⁤﻿]/g, '');

describe('the fixtures are what the issue says they are', () => {
  it('the English leaf holds Godley, and the stored text over it rewords him', () => {
    expect(L118_ENGLISH.ocr.data).toContain(GODLEY);
    expect(L118_ENGLISH.translation.data).toContain(REWORDING);
    expect(L118_ENGLISH.translation.data).not.toContain(GODLEY);
    expect(L118_GREEK.printed_page?.label).toBe('296');
    expect(L118_ENGLISH.printed_page?.label).toBe('297');
  });
});

describe('pairing — src/lib/facing-translation.ts and its scripts-side twin', () => {
  it('pairs each original leaf with the next English leaf one printed page on, on both sides', async () => {
    const ts = await import('@/lib/facing-translation');
    const mjs = await import('../../scripts/lib/facing-translation.mjs');
    for (const [a, b] of [[L118_GREEK, L118_ENGLISH], [LATIN_LATIN, LATIN_ENGLISH]]) {
      expect(ts.leafRole(a.ocr.data)).toBe('original');
      expect(ts.leafRole(b.ocr.data)).toBe('translation');
      expect(ts.isFacingPair(a, b)).toBe(true);
      // Never the other way round.
      expect(ts.isFacingPair(b, a)).toBe(false);
      for (const p of [a, b]) {
        expect(mjs.leafRole(p.ocr.data)).toBe(ts.leafRole(p.ocr.data));
        expect(mjs.printedNumber(p)).toBe(ts.printedNumber(p));
      }
      expect(mjs.isFacingPair(a, b)).toBe(true);
    }
    // Printed numbers that are not consecutive do not pair.
    const skipped = { ...L118_ENGLISH, printed_page: { label: '299' } };
    expect(ts.isFacingPair(L118_GREEK, skipped)).toBe(false);
    expect(mjs.isFacingPair(L118_GREEK, skipped)).toBe(false);
    expect(ts.FACING_PAIRING_RULE).toBe(mjs.FACING_PAIRING_RULE);
    expect(ts.hasPublishedFacingTranslation(L118_BOOK)).toBe(true);
    expect(ts.hasPublishedFacingTranslation(CONTROL_BOOK)).toBe(false);
    expect(mjs.hasPublishedFacingTranslation(CONTROL_BOOK)).toBe(false);
  });

  it('labels the pane with the translator and year', async () => {
    const { facingTranslationLabel } = await import('@/lib/facing-translation');
    expect(facingTranslationLabel(L118_BOOK)).toBe('Loeb translation · A. D. Godley, 1921');
    expect(facingTranslationLabel(LATIN_BOOK)).toBe('Loeb translation · William Armistead Falconer, 1923');
  });
});

describe('serveEnglishOriginalPage — the reader payload and /read', () => {
  it('a flagged book\'s English leaf serves the printed English, never the rewording', async () => {
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    for (const [page, book, words] of [[L118_ENGLISH, L118_BOOK, GODLEY], [LATIN_ENGLISH, LATIN_BOOK, FALCONER]] as const) {
      const served = serveEnglishOriginalPage(page, book);
      expect(served.translation).toBeUndefined();
      expect(served.ocr.data).toContain(words);
    }
    expect(JSON.stringify(serveEnglishOriginalPage(L118_ENGLISH, L118_BOOK))).not.toContain(REWORDING);
  });

  it('the original leaf keeps its translation; the unflagged control is unchanged', async () => {
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    expect(serveEnglishOriginalPage(L118_GREEK, L118_BOOK)).toBe(L118_GREEK);
    expect(serveEnglishOriginalPage(LATIN_LATIN, LATIN_BOOK)).toBe(LATIN_LATIN);
    expect(serveEnglishOriginalPage(CONTROL_ENGLISH, CONTROL_BOOK)).toBe(CONTROL_ENGLISH);
    expect(serveEnglishOriginalPage(CONTROL_GREEK, CONTROL_BOOK)).toBe(CONTROL_GREEK);
  });

  it('the TS and MJS serving rules agree on every fixture', async () => {
    const ts = await import('@/lib/english-original-text');
    const mjs = await import('../../scripts/lib/english-original-text.mjs');
    for (const [page, book, want] of [
      [L118_ENGLISH, L118_BOOK, true], [L118_GREEK, L118_BOOK, false],
      [LATIN_ENGLISH, LATIN_BOOK, true], [LATIN_LATIN, LATIN_BOOK, false],
      [CONTROL_ENGLISH, CONTROL_BOOK, false],
    ] as const) {
      expect(ts.servesTranscriptionInsteadOfTranslation(page, book)).toBe(want);
      expect(mjs.servesTranscriptionInsteadOfTranslation(page, book)).toBe(want);
    }
  });

  it('findFacingPartner finds the leaf opposite, in both directions, and nothing on the control', async () => {
    const { findFacingPartner } = await import('@/lib/facing-translation');
    const fromGreek = await findFacingPartner(fakeDb, L118_BOOK, L118_GREEK);
    expect(fromGreek?.role).toBe('original');
    expect(fromGreek?.page.page_number).toBe(322);
    const fromEnglish = await findFacingPartner(fakeDb, L118_BOOK, L118_ENGLISH);
    expect(fromEnglish?.role).toBe('translation');
    expect(fromEnglish?.page.page_number).toBe(321);
    expect(await findFacingPartner(fakeDb, CONTROL_BOOK, CONTROL_GREEK)).toBeNull();
  });
});

describe('/api/pages/batch — reader page turns', () => {
  it('serves the English leaf\'s OCR with no translation, and the control unchanged', async () => {
    const { POST } = await import('@/app/api/pages/batch/route');
    const res = await POST(new NextRequest('https://sourcelibrary.org/api/pages/batch', {
      method: 'POST', body: JSON.stringify({ ids: [L118_GREEK.id, L118_ENGLISH.id, CONTROL_ENGLISH.id] }),
    }));
    const { pages } = await res.json() as { pages: Array<Doc & { translation?: { data: string }; ocr: { data: string } }> };
    const by = new Map(pages.map((p) => [p.id, p]));
    expect(by.get(L118_ENGLISH.id)?.translation).toBeUndefined();
    expect(by.get(L118_ENGLISH.id)?.ocr.data).toContain(GODLEY);
    expect(by.get(L118_GREEK.id)?.translation?.data).toBeTruthy();
    expect(stripMarks(by.get(CONTROL_ENGLISH.id)?.translation?.data)).toContain(REWORDING);
  });
});

describe('/api/books/[id]/quote and MCP get_quote', () => {
  const quote = async (book: { id: string }, page: number) => {
    const { GET } = await import('@/app/api/books/[id]/quote/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${book.id}/quote?page=${page}`), { params: Promise.resolve({ id: book.id }) });
    return { status: res.status, body: await res.json() };
  };

  it('the English leaf quotes Godley as ocr_original, attributed to the translator, and names the Greek it faces', async () => {
    const { status, body } = await quote(L118_BOOK, 322);
    expect(status).toBe(200);
    expect(body.quote.text_source).toBe('ocr_original');
    expect(stripMarks(body.quote.original)).toContain(GODLEY);
    expect(body.quote.translation).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(REWORDING);
    expect(body.quote.transcription_note).toContain('A. D. Godley');
    expect(body.quote.facing).toMatchObject({ role: 'original', page: 321, printed_page: '296', translator: 'A. D. Godley', year: 1921 });
    expect(body.quote.facing.url).toContain('/page/');
  });

  it('the original leaf names its facing English page', async () => {
    const { status, body } = await quote(L118_BOOK, 321);
    expect(status).toBe(200);
    expect(body.quote.text_source).toBe('translation');
    expect(body.quote.facing).toMatchObject({ role: 'translation', page: 322, printed_page: '297' });
    expect(body.quote.facing.note).toContain('p. 297 [scan 322]');
    const latin = await quote(LATIN_BOOK, 40);
    expect(latin.body.quote.facing).toMatchObject({ role: 'translation', page: 41, printed_page: '29', translator: 'William Armistead Falconer' });
  });

  it('the unflagged control quotes as before, with no facing field', async () => {
    const { body } = await quote(CONTROL_BOOK, 322);
    expect(body.quote.text_source).toBe('translation');
    expect(stripMarks(body.quote.translation)).toContain(REWORDING);
    expect(body.quote.facing).toBeUndefined();
  });

  it('resolveQuoteText (MCP get_quote, the Librarian) quotes the printed English', async () => {
    const { resolveQuoteText } = await import('@/lib/quote-text');
    const q = resolveQuoteText(L118_ENGLISH as never, L118_BOOK.id, 'en', { book: L118_BOOK, mark: false });
    expect(q?.source).toBe('ocr_original');
    expect(q?.text).toContain(GODLEY);
    expect(resolveQuoteText(CONTROL_ENGLISH as never, CONTROL_BOOK.id, 'en', { book: CONTROL_BOOK, mark: false })?.source).toBe('translation');
  });
});

describe('/api/books/[id]/text — get_book_text', () => {
  it('serves Godley, not the rewording', async () => {
    const { GET } = await import('@/app/api/books/[id]/text/route');
    const res = await GET(asMcpCall(new NextRequest(`https://sourcelibrary.org/api/books/${L118_BOOK.id}/text`)), { params: Promise.resolve({ id: L118_BOOK.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const p322 = body.pages.find((p: Doc) => p.page_number === 322);
    expect(stripMarks(p322.ocr)).toContain(GODLEY);
    expect(p322.translation).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(REWORDING);
  });
});

// ── Page turning by opening (#8321 inbox 2026-11-07 10:59Z) ──────────────────
// L118 scans 22–30 and 36–40 as stored: two preface leaves (unpaired English),
// a leaf too short to classify, then openings 25|26, 27|28, 29|30. Scan 37's
// printed number was fitted as non-arabic, so 37 and 38 turn one at a time.
describe('facingStepIndex: the reader turns by opening', () => {
  type Run = Array<{ page_number: number }>;
  const run = fixtures.l118_run.pages as unknown as Run;
  const runA = run.filter((p) => p.page_number <= 30);
  const runB = run.filter((p) => p.page_number >= 36);
  const idx = (r: Run, n: number) => r.findIndex((p) => p.page_number === n);
  const turn = async (r: Run, from: number, dir: 1 | -1, missing: number[] = []) => {
    const { facingStepIndex } = await import('@/lib/facing-translation');
    const at = (i: number) => (missing.includes(r[i]?.page_number) ? undefined : r[i]);
    const to = facingStepIndex(idx(r, from), dir, r.length, at as never);
    return to == null ? null : r[to].page_number;
  };

  it('steps from an original past its English leaf to the next opening, and back', async () => {
    expect(await turn(runA, 25, 1)).toBe(27);
    expect(await turn(runA, 27, -1)).toBe(25);
  });
  it('from the English leaf of an opening (an old link) turns as the opening does', async () => {
    expect(await turn(runA, 26, 1)).toBe(27);
    expect(await turn(runA, 28, -1)).toBe(25);
  });
  it('unpaired introduction leaves turn one at a time, into and out of the first opening', async () => {
    expect(await turn(runA, 22, 1)).toBe(23);
    expect(await turn(runA, 23, 1)).toBe(24);
    expect(await turn(runA, 24, 1)).toBe(25);
    expect(await turn(runA, 25, -1)).toBe(24);
    expect(await turn(runA, 23, -1)).toBe(22);
  });
  it('a misnumbered leaf breaks the pair and turns singly', async () => {
    expect(await turn(runB, 37, 1)).toBe(38);
    expect(await turn(runB, 38, 1)).toBe(39);
    expect(await turn(runB, 39, -1)).toBe(38);
  });
  it('stops at the ends of the book, and an unloaded neighbour falls back to one leaf', async () => {
    expect(await turn(runA, 29, 1)).toBeNull();
    expect(await turn(runA, 22, -1)).toBeNull();
    expect(await turn(runA, 25, 1, [26])).toBe(26);
  });
});

// ── /book/[id]/read: no passage twice, in any of the three views ─────────────
// (#8321 inbox 2026-11-07 11:48Z) On a Loeb the continuous default runs the
// published English alone, ?text=original the Greek alone, ?text=both the pair
// once, side by side. Our AI translation of the Greek leaf (OURS) never stands
// in the running text, and the rewording over the English leaf never shows.
describe('/read on a Loeb: each passage once', () => {
  const OURS = 'impoverished lives and were somewhat simple-minded';
  const GREEK = 'δουλεῦσαι ἐν Σάμῳ';
  const render = async (book: { id: string }, sp: Record<string, string>) => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: LinearReadPage } = await import('@/app/book/[id]/read/page');
    const el = await LinearReadPage({ params: Promise.resolve({ id: book.id }), searchParams: Promise.resolve(sp) });
    const html = renderToStaticMarkup(el);
    const text = stripMarks(html.replace(/<details[\s\S]*?<\/details>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const folded = stripMarks((html.match(/<details[\s\S]*?<\/details>/g) || []).join(' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const count = (hay: string, needle: string) => hay.split(needle).length - 1;
    return { html, text, folded, count };
  };
  const words = (s: string) => stripMarks(s).replace(/\s+/g, ' ');

  it('fixture: the phrases are on the leaves they name', () => {
    expect(words(L118_ENGLISH.ocr.data)).toContain(GODLEY);
    expect(words(L118_GREEK.translation.data)).toContain(OURS);
    expect(L118_GREEK.ocr.data).toContain(GREEK);
  });

  it('continuous (default): the Loeb English once; no Greek, no AI translation, no rewording', async () => {
    const r = await render(L118_BOOK, {});
    expect(r.count(r.text, GODLEY)).toBe(1);
    expect(r.count(r.text + r.folded, OURS)).toBe(0);
    expect(r.count(r.text + r.folded, REWORDING)).toBe(0);
    expect(r.count(r.text + r.folded, GREEK)).toBe(0);
    // The page numbers both stay, linked: the Greek leaf's joins the English one's.
    expect(r.html).toContain(`/page/${L118_GREEK.id}`);
    expect(r.html).toContain(`/page/${L118_ENGLISH.id}`);
  });

  it('?text=original: the Greek once, nothing English', async () => {
    const r = await render(L118_BOOK, { text: 'original' });
    expect(r.count(r.text, GREEK)).toBe(1);
    expect(r.count(r.text + r.folded, GODLEY)).toBe(0);
    expect(r.count(r.text + r.folded, OURS)).toBe(0);
  });

  it('?text=both: the pair once, side by side; our translation only folded, labelled', async () => {
    const r = await render(L118_BOOK, { text: 'both' });
    expect(r.count(r.text, GREEK)).toBe(1);
    expect(r.count(r.text, GODLEY)).toBe(1);
    expect(r.count(r.text, OURS)).toBe(0);
    expect(r.count(r.folded, OURS)).toBe(1);
    expect(r.folded).toContain('Source Library translation');
    expect(r.count(r.text + r.folded, REWORDING)).toBe(0);
    expect(r.html).toMatch(/lg:grid-cols-2/);
  });

  it('?view=pages keeps the lane too: one heading per page, the English leaf in English', async () => {
    const r = await render(L118_BOOK, { view: 'pages' });
    expect(r.count(r.text, GODLEY)).toBe(1);
    expect(r.count(r.text + r.folded, OURS)).toBe(0);
    expect(r.html).toContain('id="h-p322"');
    expect(r.html).not.toContain('id="h-p321"');
    expect(r.html).toMatch(/<div class="prose-manuscript" lang="en">[^]*meanly-living/);
  });

  it('every text block says its language', async () => {
    for (const sp of [{}, { text: 'original' }, { text: 'both' }]) {
      const r = await render(L118_BOOK, sp);
      const blocks = r.html.match(/<div class="prose-manuscript[^"]*"[^>]*>/g) || [];
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) expect(b).toMatch(/ lang="/);
    }
  });

  it('the unflagged control reads as before: our translation is the running text', async () => {
    const r = await render(CONTROL_BOOK, {});
    expect(r.count(r.text, OURS)).toBe(1);
  });
});

// ── The continuous EPUB (Kindle), and the plain text built from it ───────────
// (#8321 inbox 2026-11-07 12:38Z) On L118 every passage came out twice (our AI
// English of the Greek leaf, then the Loeb leaf). The flow EPUB of a flagged
// book carries the Loeb English alone, once; `epub-ocr` the Greek alone; the
// Greek leaf's plate stays in place; the title page credits the translator.
describe('flow EPUB on a Loeb: each passage once', () => {
  const OURS = 'impoverished lives and were somewhat simple-minded';
  const GREEK = 'δουλεῦσαι ἐν Σάμῳ';
  const plate = [{ page_number: L118_GREEK.page_number, description: 'A map of Scythia' }];
  const epubDb = { collection: () => ({ find: () => ({ toArray: async () => plate }) }) };
  // As the download route does: the #7100 strip first, then the flow builder.
  const build = async (book: Doc, leaves: PageFx[], text: 'translation' | 'ocr') => {
    const { buildFlowEpub } = await import('@/lib/export-flow-epub');
    const { servesTranscriptionInsteadOfTranslation } = await import('@/lib/english-original-text');
    const pages = leaves.map((p) => structuredClone(p)) as Array<PageFx & { translation?: { data: string } }>;
    for (const p of pages) if (servesTranscriptionInsteadOfTranslation(p as never, book as never)) delete p.translation;
    const flow = await buildFlowEpub(epubDb as never, book as never, pages as never, { text, baseUrl: 'https://sourcelibrary.org', includeImages: false });
    flow.cleanup();
    const html = flow.chapters.map((c) => c.content).join('\n');
    const plain = stripMarks(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    return { flow, html, plain, count: (n: string) => plain.split(n).length - 1 };
  };

  it('translation: Godley once; no Greek, no AI English, no rewording, no "not yet translated"', async () => {
    const r = await build(L118_BOOK, [L118_GREEK, L118_ENGLISH], 'translation');
    expect(r.count(GODLEY)).toBe(1);
    expect(r.count(OURS)).toBe(0);
    expect(r.count(REWORDING)).toBe(0);
    expect(r.count(GREEK)).toBe(0);
    expect(r.plain).not.toContain('not yet translated');
    // No running head or printed number from the leaf in the text ("BOOK IV. 94-96", "297").
    expect(r.plain).not.toMatch(/BOOK IV\.\s*94/);
    // Both page markers stay; the Greek leaf's plate stays in place.
    expect(r.html).toContain(`?page=${L118_GREEK.page_number}`);
    expect(r.html).toContain(`?page=${L118_ENGLISH.page_number}`);
    expect(r.plain).toContain('A map of Scythia');
    expect(r.flow.translationCredit).toContain('A. D. Godley');
  });

  it('ocr: the Greek once, nothing English', async () => {
    const r = await build(L118_BOOK, [L118_GREEK, L118_ENGLISH], 'ocr');
    expect(r.count(GREEK)).toBe(1);
    expect(r.count(GODLEY)).toBe(0);
    expect(r.flow.translationCredit).toBeNull();
  });

  it('the Latin Loeb too: Falconer once', async () => {
    const r = await build(LATIN_BOOK, [LATIN_LATIN, LATIN_ENGLISH], 'translation');
    expect(r.count(FALCONER)).toBe(1);
  });

  it('the plain-text edition (buildFlowText) reads the same lane', async () => {
    const { buildFlowText } = await import('@/lib/export-flow-text');
    const { servesTranscriptionInsteadOfTranslation } = await import('@/lib/english-original-text');
    const pages = [L118_GREEK, L118_ENGLISH].map((p) => structuredClone(p)) as Array<PageFx & { translation?: { data: string } }>;
    for (const p of pages) if (servesTranscriptionInsteadOfTranslation(p as never, L118_BOOK as never)) delete p.translation;
    const { body } = await buildFlowText(epubDb as never, L118_BOOK as never, pages as never, { text: 'translation', baseUrl: 'https://sourcelibrary.org' });
    const plain = stripMarks(body).replace(/\s+/g, ' ');
    expect(plain.split(GODLEY).length - 1).toBe(1);
    expect(plain).not.toContain(OURS);
  });

  it('the unflagged control is unchanged: our translation of the Greek leaf is the text', async () => {
    const r = await build(CONTROL_BOOK, [CONTROL_GREEK, CONTROL_ENGLISH] as unknown as PageFx[], 'translation');
    expect(r.count(OURS)).toBe(1);
    expect(r.flow.translationCredit).toBeNull();
  });
});

// ── Review of af03c609 (PR #8326, 2026-11-07): every door, on a flagged book ──
// L118 is catalogued Greek, so the #7100 English-edition branches do not fire on
// it; each door below once served the rewording, or credited it to us.
describe('every door on a flagged, Greek-catalogued Loeb (L118)', () => {
  const RUN = fixtures.l118_run as unknown as { pages: PageFx[]; book_chapters: Doc[] };
  // Scan 22: the preface (printed xvii), English, with no original facing it.
  const PREFACE = RUN.pages.find((p) => p.page_number === 22)!;
  const PREFACE_REWORDED = 'This page concludes the critique';
  const text = async (book: { id: string }, qs: string) => {
    const { GET } = await import('@/app/api/books/[id]/text/route');
    return GET(asMcpCall(new NextRequest(`https://sourcelibrary.org/api/books/${book.id}/text?${qs}`)), { params: Promise.resolve({ id: book.id }) });
  };

  it('/text content=translation (MCP get_book_text) never serves the rewording, and says where Godley is', async () => {
    const res = await text(L118_BOOK, 'content=translation');
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(REWORDING);
    expect(body.pages.find((p: Doc) => p.page_number === 322)).toBeUndefined();
    expect(body.pages.find((p: Doc) => p.page_number === 321)?.translation).toBeTruthy();
    expect(body.facing_translation_note).toContain('A. D. Godley');
    const plain = await (await text(L118_BOOK, 'content=translation&format=plain')).text();
    expect(stripMarks(plain)).not.toContain(REWORDING);
    expect(plain).toContain('Facing-page edition');
    // The control still serves it: the test can see the rewording when it is there.
    expect(stripMarks(JSON.stringify(await (await text(CONTROL_BOOK, 'content=translation')).json()))).toContain(REWORDING);
  });

  it('/text chapter=N is read from its pages, not the materialized chapter text that carries the rewording', async () => {
    store.books = store.books.map((b) => (b.id === L118_BOOK.id ? { ...b, chapters: RUN.book_chapters } : b));
    // As materialize-chapters stitches it, from each leaf's stored translation:
    // production holds this for 8 flagged Loebs (the rewording on 61–206 leaves each).
    store.chapter_texts = [{
      book_id: L118_BOOK.id, chapter_index: 2, title: 'Book IV', level: 1, pageStart: 221, pageEnd: 447,
      text: `${L118_GREEK.translation.data}\n\n${L118_ENGLISH.translation.data}`, ocr_text: `${L118_GREEK.ocr.data}\n\n${L118_ENGLISH.ocr.data}`,
    }];
    for (const qs of ['chapter=2', 'chapter=2&content=translation', 'chapter=2&format=plain']) {
      const res = await text(L118_BOOK, qs);
      expect(res.status).toBe(200);
      const out = stripMarks(await res.text());
      expect(out).not.toContain(REWORDING);
      if (!qs.includes('content=translation')) expect(out.replace(/\s+/g, ' ')).toContain(GODLEY);
    }
    // The range is the chapter's (`books.chapters` stores pageNumber/endPage): Book III's leaves stay out.
    store.pages.push({ ...L118_GREEK, id: 'l118-p30', page_number: 30 } as unknown as Doc);
    const body = await (await text(L118_BOOK, 'chapter=2')).json();
    expect(body.chapter).toMatchObject({ pageStart: 221, pageEnd: 447 });
    expect(body.pages.map((p: Doc) => p.page_number)).toEqual([321, 322]);
  });

  it('the page package ships Godley as the leaf\'s text, no rewording, no "trans. Source Library"', async () => {
    const { auth } = await import('@/lib/auth');
    vi.mocked(auth).mockResolvedValue({ user: { id: 'reader-1' } } as never);
    try {
      const { GET } = await import('@/app/api/books/[id]/pages/[pageId]/package/route');
      const files = async (book: { id: string }, pageId: string) => {
        const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${book.id}/pages/${pageId}/package`), { params: Promise.resolve({ id: book.id, pageId }) });
        expect(res.status).toBe(200);
        return readZip(Buffer.from(await res.arrayBuffer()));
      };
      const zip = await files(L118_BOOK, L118_ENGLISH.id);
      expect(zip['translation.txt']).toBeUndefined();
      expect(zip['transcription.txt'].replace(/\s+/g, ' ')).toContain(GODLEY);
      const all = Object.values(zip).join('\n');
      expect(stripMarks(all)).not.toContain(REWORDING);
      expect(all).not.toContain('trans. Source Library');
      expect(all).not.toContain('Translated by Source Library');
      expect(zip['README.txt']).toContain('Loeb translation · A. D. Godley, 1921');
      // The Greek leaf keeps our translation, credited to us; the control is unchanged.
      expect(stripMarks((await files(L118_BOOK, L118_GREEK.id))['translation.txt'])).toBeTruthy();
      expect(stripMarks((await files(CONTROL_BOOK, CONTROL_ENGLISH.id))['translation.txt'])).toContain(REWORDING);
    } finally {
      vi.mocked(auth).mockResolvedValue(null as never);
    }
  });

  it('/quote on an unpaired English leaf says the words are the edition\'s, never "the source\'s own"', async () => {
    store.pages.push(PREFACE as unknown as Doc);
    const { GET } = await import('@/app/api/books/[id]/quote/route');
    const res = await GET(new NextRequest(`https://sourcelibrary.org/api/books/${L118_BOOK.id}/quote?page=22`), { params: Promise.resolve({ id: L118_BOOK.id }) });
    const body = await res.json();
    expect(body.quote.text_source).toBe('ocr_original');
    expect(body.quote.facing).toBeUndefined();
    expect(body.quote.transcription_note).toContain('no original-language leaf facing it');
    expect(body.quote.transcription_note).toContain('A. D. Godley');
    expect(body.quote.transcription_note).not.toContain('needs no translation');
    expect(JSON.stringify(body)).not.toContain(PREFACE_REWORDED);
  });

  it('the tenant /quote: the translator\'s note, paired or not, and no "trans. Source Library"', async () => {
    const T = 'tenant-loeb';
    store.books = [{ ...L118_BOOK, tenantId: T }] as unknown as Doc[];
    store.pages = [L118_GREEK, L118_ENGLISH, PREFACE].map((p) => ({ ...p, tenantId: T })) as unknown as Doc[];
    const { GET } = await import('@/app/api/[tenant]/books/[id]/quote/route');
    const quote = async (page: number) => (await GET(
      new NextRequest(`https://sourcelibrary.org/api/loeb-room/books/${L118_BOOK.id}/quote?page=${page}`),
      { params: Promise.resolve({ tenant: 'loeb-room', id: L118_BOOK.id }) },
    )).json();
    const paired = await quote(322);
    expect(paired.quote.text_source).toBe('ocr_original');
    expect(paired.quote.transcription_note).toContain('A. D. Godley');
    expect(paired.quote.transcription_note).toContain('facing the original text');
    expect(JSON.stringify(paired)).not.toContain('Source Library 20');
    expect(JSON.stringify(paired)).not.toContain('Translated by Source Library');
    expect(JSON.stringify(paired)).not.toContain(REWORDING);
    const unpaired = await quote(22);
    expect(unpaired.quote.transcription_note).toContain('no original-language leaf facing it');
    // The Greek leaf is our translation, and says so.
    expect(JSON.stringify(await quote(321))).toContain('Source Library');
  });

  it('the reader page\'s JSON-LD names Godley as translator of the English leaf, Source Library of the Greek', async () => {
    const { buildPageJsonLd } = await import('@/lib/page-json-ld');
    const { serveEnglishOriginalPage } = await import('@/lib/english-original-text');
    const work = (book: Doc, page: PageFx) => {
      const ld = buildPageJsonLd(book as never, serveEnglishOriginalPage({ ...page, seo_indexable: true }, book) as never, 'u', 'b');
      return (ld!['@graph'] as Doc[])[0];
    };
    const en = work(L118_BOOK, L118_ENGLISH);
    expect(en.translator).toEqual({ '@type': 'Person', name: 'A. D. Godley' });
    expect(en.inLanguage).toBe('en');
    expect(String(en.text)).toContain('meanly-living');
    expect(work(L118_BOOK, L118_GREEK).translator).toEqual({ '@type': 'Organization', name: 'Source Library' });
    expect(work(CONTROL_BOOK, CONTROL_ENGLISH).translator).toEqual({ '@type': 'Organization', name: 'Source Library' });
  });

  it('/read ?view=pages keeps a chapter heading and its Contents anchor when the chapter opens on a Greek leaf', async () => {
    // Production: Book III opens on scan 25, the Greek leaf of the opening 25|26.
    store.books = store.books.map((b) => (b.id === L118_BOOK.id ? { ...b, chapters: RUN.book_chapters } : b));
    store.pages = RUN.pages as unknown as Doc[];
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { default: LinearReadPage } = await import('@/app/book/[id]/read/page');
    const html = renderToStaticMarkup(await LinearReadPage({ params: Promise.resolve({ id: L118_BOOK.id }), searchParams: Promise.resolve({ view: 'pages' }) }));
    expect(html).not.toContain('id="h-p25"');
    expect(html).toContain('id="p25"');
    expect(html).toMatch(/href="[^"]*#p25"/);
    expect(html.match(/<h2[^>]*>Book III<\/h2>/g)).toHaveLength(1);
  });
});

/** The files of a ZIP (deflate or stored), read from its central directory. */
function readZip(buf: Buffer): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
