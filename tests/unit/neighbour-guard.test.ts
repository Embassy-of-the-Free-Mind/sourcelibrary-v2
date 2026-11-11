/**
 * The write-time neighbour guard (#5026): a page's English that is its neighbour's is refused at both translation
 * doors. 'neighbour-leak' = a shared run with the stored English of n-1 / n+1 the sources do not share, on the side
 * that holds the copy; 'absorbs-neighbour' = book-relative length that is this page's source plus a neighbour's.
 *
 * Every refusal case has a negative twin that differs in the one condition the rule turns on, so deleting that
 * condition fails a test. Sizing (false-refusal rate on random pages, the L'escole / Atalanta controls) is in
 * scripts/eval/experiments/2026-11-08-neighbour-guard-5026.md, not here.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn(async () => state.db) }));

import { neighbourVerdict, checkNeighbours, sharedRun, LEAK_MIN_CHARS, openingEcho, ECHO_MIN_SHARE } from '../../scripts/lib/neighbour-guard.mjs';
import { sharedRun as auditSharedRun, LEAK_MIN_CHARS as AUDIT_MIN } from '../../scripts/audit/translation-page-boundaries.mjs';
import { writePageTranslation, neighbourGate } from '../../scripts/lib/translate-core.mjs';
import { writePageTranslation as writeTs } from '@/lib/translate-write';
import { geminiEngine, translationInput, notRecorded } from '@/lib/write-provenance';

// Deterministic prose that shares no 40-char shingle between seeds.
const WORDS = 'the of salt mercury sulphur fire water earth air stone king queen vessel heat light dark green lion eagle dragon moon sun gold silver tree root seed glass furnace ash tincture'.split(' ');
function prose(seed: number, n: number): string {
  let x = seed * 2654435761 % 4294967296, out = '';
  while (out.length < n) { x = (x * 1103515245 + 12345) % 2147483648; out += WORDS[x % WORDS.length] + (x % 7 === 0 ? `${seed}. ` : ' '); }
  return out.slice(0, n);
}
const src = (seed: number, n = 1000) => prose(seed + 1000, n); // the "source", a different text from its English
const K0 = 0; // English as long as its source, book-wide

describe('sharedRun moved, not copied', () => {
  it('the audit re-exports the guard\'s sharedRun and floor', () => {
    expect(auditSharedRun).toBe(sharedRun);
    expect(AUDIT_MIN).toBe(LEAK_MIN_CHARS);
  });
});

describe("neighbourVerdict — 'neighbour-leak'", () => {
  const prevEn = prose(1, 1000), ownEn = prose(2, 1000);
  const copied = prevEn.slice(500, 900); // 400 chars of p.n-1's English

  it('refuses a page carrying the previous page\'s English (the BACKWARD context leak)', () => {
    const v = neighbourVerdict({ page: { src: src(2), en: `${copied} ${ownEn}` }, prev: { src: src(1), en: prevEn }, k: K0 });
    expect(v).toMatchObject({ refuse: true, reason: 'neighbour-leak', side: 'prev' });
  });
  it('refuses the FORWARD shape too (the next page\'s English appended)', () => {
    const nextEn = prose(3, 1000);
    const v = neighbourVerdict({ page: { src: src(2), en: `${ownEn} ${nextEn.slice(0, 400)}` }, next: { src: src(3), en: nextEn }, k: K0 });
    expect(v).toMatchObject({ refuse: true, reason: 'neighbour-leak', side: 'next' });
  });
  it('NEGATIVE: the same pages with no shared run are written', () => {
    expect(neighbourVerdict({ page: { src: src(2), en: `${prose(9, 400)} ${ownEn}` }, prev: { src: src(1), en: prevEn }, k: K0 }).refuse).toBe(false);
  });
  it('NEGATIVE: a run under LEAK_MIN_CHARS is not a leak', () => {
    const short = prevEn.slice(500, 500 + LEAK_MIN_CHARS - 20);
    expect(neighbourVerdict({ page: { src: src(2), en: `${short} ${ownEn}` }, prev: { src: src(1), en: prevEn }, k: K0 }).refuse).toBe(false);
  });
  it('NEGATIVE: re-translating the page the text belongs to, beside a neighbour that still holds the copy', () => {
    // p.n-1 stored its own English plus 400 chars of ours; our clean English must still be written.
    const v = neighbourVerdict({ page: { src: src(2), en: ownEn }, prev: { src: src(1), en: `${prevEn} ${ownEn.slice(0, 400)}` }, k: K0 });
    expect(v.refuse).toBe(false);
  });
  it('NEGATIVE: the sources share the run too (a refrain, a repeated table)', () => {
    const refrainSrc = src(50, 300);
    const v = neighbourVerdict({
      page: { src: `${refrainSrc} ${src(2, 700)}`, en: `${copied} ${ownEn}` },
      prev: { src: `${src(1, 700)} ${refrainSrc}`, en: prevEn }, k: K0,
    });
    expect(v.refuse).toBe(false);
  });
  it('NEGATIVE: two short near-identical title pages (sources repeat by half the shorter)', () => {
    const titleEn = prose(7, 260), titleSrc = src(7, 90);
    const v = neighbourVerdict({ page: { src: titleSrc, en: `${titleEn} again` }, prev: { src: titleSrc.slice(0, 80), en: titleEn }, k: K0 });
    expect(v.refuse).toBe(false);
  });
  it('NEGATIVE: a copy that does not explain the page\'s length (page no longer than the book allows)', () => {
    // The page runs short of the book's ratio even with the copy: own <= 0, share < LEAK_WHOLE_SHARE.
    const v = neighbourVerdict({ page: { src: src(2, 2000), en: `${copied} ${ownEn}` }, prev: { src: src(1, 4000), en: prevEn }, k: K0 });
    expect(v.refuse).toBe(false);
  });
  it('a run that is most of the page is refused whatever the length (the page was replaced)', () => {
    const v = neighbourVerdict({ page: { src: src(2, 3000), en: `${prevEn.slice(0, 900)} ${prose(2, 200)}` }, prev: { src: src(1, 4000), en: prevEn }, k: K0 });
    expect(v).toMatchObject({ refuse: true, reason: 'neighbour-leak' });
  });
  it('with no book K: refused at LEAK_NO_K_SHARE of the page, not under it', () => {
    expect(neighbourVerdict({ page: { src: src(2), en: `${copied} ${ownEn}` }, prev: { src: src(1), en: prevEn }, k: null }).refuse).toBe(true);
    const long = `${prevEn.slice(500, 720)} ${prose(2, 2400)}`; // 220 / ~2620 ≈ 8%
    expect(neighbourVerdict({ page: { src: src(2, 2400), en: long }, prev: { src: src(1, 900), en: prevEn }, k: null }).refuse).toBe(false);
  });
});

describe("neighbourVerdict — 'absorbs-neighbour'", () => {
  it('refuses a page whose English is its own source plus the next page\'s', () => {
    const v = neighbourVerdict({ page: { src: src(2), en: prose(2, 2000) }, prev: { src: src(1), en: prose(1, 1000) }, next: { src: src(3), en: prose(3, 1000) }, k: K0 });
    expect(v).toMatchObject({ refuse: true, reason: 'absorbs-neighbour' });
  });
  it('NEGATIVE: a long neighbourhood (the neighbour runs as long) is not refused', () => {
    const v = neighbourVerdict({ page: { src: src(2), en: prose(2, 2000) }, prev: { src: src(1), en: prose(1, 1800) }, next: { src: src(3), en: prose(3, 1800) }, k: K0 });
    expect(v.refuse).toBe(false);
  });
  it('NEGATIVE: long, but not the length of two leaves', () => {
    const v = neighbourVerdict({ page: { src: src(2), en: prose(2, 3200) }, prev: { src: src(1), en: prose(1, 1000) }, next: { src: src(3), en: prose(3, 1000) }, k: K0 });
    expect(v.refuse).toBe(false);
  });
  it('NEGATIVE: no book K, no length check', () => {
    expect(neighbourVerdict({ page: { src: src(2), en: prose(2, 2000) }, next: { src: src(3), en: prose(3, 1000) }, k: null }).refuse).toBe(false);
  });
  it('NEGATIVE: a skip type (index) is not judged on length', () => {
    expect(neighbourVerdict({ page: { src: src(2), en: prose(2, 2000), type: 'index' }, next: { src: src(3), en: prose(3, 1000) }, k: K0 }).refuse).toBe(false);
  });
});

// ── the doors ───────────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, any>;
function makeDb(pages: Doc[], { k = [1000, 1000, 1000] as number[] | null } = {}) {
  const calls = { pageUpdates: [] as Array<[Doc, Doc]>, revisions: [] as Doc[] };
  const db = {
    collection(name: string) {
      return {
        findOne: async (q: Doc) => (name === 'pages' ? pages.find((p) => p.id === q.id) ?? null : null),
        find: (q: Doc) => ({ toArray: async () => pages.filter((p) => p.book_id === q.book_id && q.page_number.$in.includes(p.page_number)) }),
        aggregate: () => ({ toArray: async () => (k ? k.map((n) => ({ type: null, src: n, en: n })) : []) }),
        updateOne: async (f: Doc, u: Doc) => { if (name === 'pages') calls.pageUpdates.push([f, u]); return { matchedCount: 1, modifiedCount: 1 }; },
        insertOne: async (d: Doc) => { if (name === 'page_revisions') calls.revisions.push(d); return { insertedId: 'r' }; },
        insertMany: async (ds: Doc[]) => { if (name === 'page_revisions') calls.revisions.push(...ds); return {}; },
      };
    },
  };
  return { db, calls };
}
const written = (c: { pageUpdates: Array<[Doc, Doc]> }) => c.pageUpdates.find(([, u]) => u?.$set?.translation?.data !== undefined)?.[1].$set.translation.data;
const stamp = (c: { pageUpdates: Array<[Doc, Doc]> }) => c.pageUpdates.find(([, u]) => u?.$set?.['translation.health_blocked'])?.[1].$set['translation.health_blocked'];
const call = { call_site: 'tests/unit/neighbour-guard.test.ts', promptText: 'PROMPT', generationConfig: {}, run: { code_version: 'test', host: 'test' } };
const promptRef = { id: 'x', name: 'n', version: 21 };

let bookSeq = 0;
function book() {
  const id = `nb-book-${++bookSeq}`; // K is cached per book id within the process
  const prevEn = prose(1, 1000);
  const pages = [
    { id: `${id}-1`, book_id: id, page_number: 1, ocr: { data: src(1) }, translation: { data: prevEn, source: 'ai' } },
    { id: `${id}-2`, book_id: id, page_number: 2, ocr: { data: src(2) }, translation: null },
    { id: `${id}-3`, book_id: id, page_number: 3, ocr: { data: src(3) }, translation: { data: prose(3, 1000), source: 'ai' } },
  ];
  return { id, pages, leak: `${prevEn.slice(500, 900)} ${prose(2, 1000)}`, clean: prose(2, 1000) };
}

describe('writePageTranslation (the .mjs door) — always on', () => {
  it('refuses page 2 holding page 1\'s English: stamped, kept in page_revisions, nothing written', async () => {
    const b = book(); const { db, calls } = makeDb(b.pages);
    const r = await writePageTranslation(db, { page: { id: b.pages[1].id }, book: { id: b.id, language: 'Latin' }, text: b.leak, promptRef, call });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'neighbour-leak' });
    expect(written(calls)).toBeUndefined();
    expect(stamp(calls)).toBe('neighbour-leak');
    expect(calls.revisions[0]).toMatchObject({ page_id: b.pages[1].id, source: 'health-gate-refused', reason: 'neighbour-leak' });
  });
  it('NEGATIVE CONTROL: the clean English is written', async () => {
    const b = book(); const { db, calls } = makeDb(b.pages);
    const r = await writePageTranslation(db, { page: { id: b.pages[1].id }, book: { id: b.id }, text: b.clean, promptRef, call });
    expect(r.written).toBe(true);
    expect(written(calls)).toBe(b.clean);
  });
  it('`neighbours` (a block written together) overrides the stored English', async () => {
    const b = book(); const { db } = makeDb(b.pages);
    const r = await writePageTranslation(db, { page: { id: b.pages[1].id }, book: { id: b.id }, text: b.leak, promptRef, call, neighbours: { 1: prose(11, 1000) } });
    expect(r.written).toBe(true);
  });
  it('a restore (writeGuard: false) is not judged', async () => {
    const b = book(); const { db } = makeDb(b.pages);
    const r = await writePageTranslation(db, { page: { id: b.pages[1].id }, book: { id: b.id }, text: b.leak, promptRef, engine: notRecorded('restore test'), writeGuard: false });
    expect(r.written).toBe(true);
  });
  it('fails open: a neighbour read that throws does not block the write', async () => {
    const b = book(); const { db } = makeDb(b.pages);
    const broken = { collection: (n: string) => ({ ...db.collection(n), find: () => { throw new Error('down'); } }) };
    const r = await writePageTranslation(broken, { page: { id: b.pages[1].id }, book: { id: b.id }, text: b.leak, promptRef, call });
    expect(r.written).toBe(true);
  });
});

describe('writePageTranslation (the TS door)', () => {
  const engineFor = (ocr: string) => geminiEngine({
    call_site: 'tests/unit/neighbour-guard.test.ts', api: 'realtime', model: 'gemini-3-flash', prompt: { text: 'PROMPT' }, generationConfig: {},
    run: { code_version: 'test', host: 'test' }, input: translationInput({ ocrText: ocr }),
  });
  it('refuses the leak with refused: neighbour-leak and stamps the page', async () => {
    const b = book(); const { db, calls } = makeDb(b.pages); state.db = db;
    const r = await writeTs({ pageId: b.pages[1].id, text: b.leak, model: 'gemini-3-flash', engine: engineFor(src(2)) });
    expect(r).toMatchObject({ written: false, refused: 'neighbour-leak' });
    expect(written(calls)).toBeUndefined();
    expect(stamp(calls)).toBe('neighbour-leak');
  });
  it('NEGATIVE CONTROL: the clean English is written', async () => {
    const b = book(); const { db, calls } = makeDb(b.pages); state.db = db;
    const r = await writeTs({ pageId: b.pages[1].id, text: b.clean, model: 'gemini-3-flash', engine: engineFor(src(2)) });
    expect(r.written).toBe(true);
    expect(written(calls)).toBe(b.clean);
  });
});

describe('checkNeighbours', () => {
  it('returns no verdict for a page with no page_number', async () => {
    const { db } = makeDb([]);
    expect(await checkNeighbours(db, { page: { id: 'x', book_id: 'b' }, text: 'x', ocr: 'y' })).toEqual({ refuse: false });
  });
});

describe('neighbourGate — a block judged against itself', () => {
  it("refuses page 2 against the reply's own page 1, though the stored page 1 is different English", async () => {
    const b = book(); b.pages[0].translation = { data: prose(12, 1000), source: 'ai' }; // the old page 1, being replaced
    const { db, calls } = makeDb(b.pages);
    const newP1 = prose(1, 1000);
    const r = await neighbourGate(db, { id: b.pages[1].id }, `${newP1.slice(500, 900)} ${prose(2, 1000)}`, { neighbours: { 1: newP1 } });
    expect(r).toMatchObject({ refused: true, reason: 'neighbour-leak' });
    expect(stamp(calls)).toBe('neighbour-leak');
  });
  it('dryRun judges without stamping', async () => {
    const b = book(); const { db, calls } = makeDb(b.pages);
    const r = await neighbourGate(db, { id: b.pages[1].id }, b.leak, { dryRun: true });
    expect(r.refused).toBe(true);
    expect(stamp(calls)).toBeUndefined();
  });
});

// Every production writer of model translation text asks the gate before it stores a page — the list the stray-script
// and hidden-meta guards keep (#5734, #5376). Catches a writer LOSING its check.
describe('the writers', () => {
  const WRITERS: Record<string, RegExp> = {
    'scripts/lib/translate-core.mjs': /neighbourGate\(db, at, clean/,                         // the door
    'scripts/workers/translate-worker.mjs': /neighbourGate\(db, page, text, \{ neighbours/,     // Hetzner realtime, one page
    'scripts/workers/batch-collector.mjs': /neighbourGate\(db, \{ id: pageId[^\n]*neighbours: jobEnglish/, // Hetzner batch collector
    'scripts/batch/collect-batch-results.mjs': /neighbourGate\([^\n]*neighbours: jobEnglish/,  // manual batch collect
    'scripts/maintenance/recover-uncollected-batches.mjs': /h\.neighbourGate\(/,
    'src/lib/translate-write.ts': /neighbourGate\(db, at, finalText/,                          // the TS door
    'src/workers/translation-processor-logic.ts': /neighbourGate\(/,                          // Lambda
    'src/app/api/books/[id]/batch-translate-async/route.ts': /neighbourGate\(/,
    'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts': /neighbourGate\(/,
    'src/app/api/batch-save/route.ts': /neighbourGate\(/,
    'src/app/api/process/route.ts': /neighbourGate\(/,
    'src/app/api/contribute/process/route.ts': /neighbourGate\(/,
  };
  for (const [f, re] of Object.entries(WRITERS)) {
    it(`${f} asks the neighbour gate`, () => {
      expect(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).toMatch(re);
    });
  }
  it('the worker judges a block against its own pages', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../scripts/workers/translate-worker.mjs'), 'utf8')).toMatch(/neighbourGate\(db, e\.page, e\.text, \{ neighbours: blockText/);
  });
});

describe('openingEcho — n-1\'s English at the head of n (#8399)', () => {
  const prevEn = prose(1, 1200);
  const tail = prevEn.slice(-260);            // n-1's last sentence or so, under the leak floor's reach
  const ownEn = prose(2, 1200);
  it('flags a page that opens with n-1\'s closing words', () => {
    const r = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn, ocr: src(2), prevOcr: src(1) });
    expect(r.share).toBeGreaterThanOrEqual(ECHO_MIN_SHARE);
    expect(r.sourceRepeats).toBe(false);
    expect(r.echo).toBe(true);
  });
  it('twin: the page\'s own opening is not an echo', () => {
    const r = openingEcho({ tr: ownEn, prevTr: prevEn, ocr: src(2), prevOcr: src(1) });
    expect(r.share).toBeLessThan(ECHO_MIN_SHARE);
    expect(r.echo).toBe(false);
  });
  it('twin: the same words inside the <meta> continuity note are invisible to readers, so not an echo', () => {
    const r = openingEcho({ tr: `<meta>continues from previous page: ${tail}</meta> ${ownEn}`, prevTr: prevEn });
    expect(r.echo).toBe(false);
  });
  it('twin: when the SOURCES open the same way, the book repeats itself, so not an echo', () => {
    const r = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn, ocr: `${src(1).slice(-300)} ${src(2)}`, prevOcr: src(1) });
    expect(r.sourceRepeats).toBe(true);
    expect(r.echo).toBe(false);
  });
  it('without the sources it still judges the English (sourceRepeats null)', () => {
    const r = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn });
    expect(r.sourceRepeats).toBeNull();
    expect(r.echo).toBe(true);
  });
  it('a facing-page edition (Latin page beside its English) is parallel, not an echo', () => {
    const la = 'et in principio erat verbum quod est in deo et cum deo sed non sine homine neque ad finem est '.repeat(6);
    const en = 'and in the beginning was the word which is in god and with god but not without the man and to the end '.repeat(6);
    const r = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn, ocr: en, prevOcr: la });
    expect(r.parallel).toBe(true);
    expect(r.echo).toBe(false);
    // twin: both pages Latin, so the same English repeat IS an echo
    const twin = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn, ocr: la.replace(/verbum/g, 'lux'), prevOcr: la });
    expect(twin.parallel).toBe(false);
  });
  it('a source without spaces leaves the source test unknown (null), not "the sources differ"', () => {
    const zh = '天地玄黃宇宙洪荒日月盈昃辰宿列張寒來暑往秋收冬藏'.repeat(20);
    const r = openingEcho({ tr: `${tail} ${ownEn}`, prevTr: prevEn, ocr: zh, prevOcr: zh });
    expect(r.sourceShare).toBeNull();
    expect(r.sourceRepeats).toBeNull();
    expect(openingEcho({ tr: zh, prevTr: zh }).share).toBe(0);
  });
});
