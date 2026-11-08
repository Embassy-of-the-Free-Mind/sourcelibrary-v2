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

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn(async () => state.db) }));

import { neighbourVerdict, checkNeighbours, sharedRun, LEAK_MIN_CHARS } from '../../scripts/lib/neighbour-guard.mjs';
import { sharedRun as auditSharedRun, LEAK_MIN_CHARS as AUDIT_MIN } from '../../scripts/audit/translation-page-boundaries.mjs';
import { writePageTranslation } from '../../scripts/lib/translate-core.mjs';
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
