/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #5734: the Tibetan run (gemini-3-flash-preview, 2026-10-01) wrote Korean 그 ("that") for the
 * English word on 605 pages and Chinese tokens (卓越, 第九) mid-sentence on 27 more; no writer
 * asked whether a script in the English belonged there. Fixtures are excerpts of those pages.
 *
 * Pins: (1) the two copies of the rule (scripts/lib/stray-script.mjs, src/lib/stray-script.ts)
 * agree on every fixture; (2) what is stray and what is not — a gloss in a <note>/<term>, OCR filler
 * echoed from the source, a Greek quotation the source carries; (3) the mechanical 그 repair and
 * nothing beyond it; (4) the .mjs door repairs or refuses, stamps and keeps the text; (5) every
 * production translation writer asks the gate.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn(async () => ({})) }));

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as mjs from '../../scripts/lib/stray-script.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { writePageTranslation, assessTranslationHealth, strayScriptGate as gateMjs } from '../../scripts/lib/translate-core.mjs';
import * as ts from '@/lib/stray-script';
import { strayScriptGate as gateTs } from '@/lib/translate-write';

const TIBETAN_OCR = 'དེའི་ཚེ་མེ་ཏོག་གི་ཆར་བབ། ཨ་འབྲས་དགུན་འབྲུམ་པ་ན་སེ།';
const FILLER_OCR = `${TIBETAN_OCR} 妟妉妟妟妁妟妉妉妉如妉妟`;

type Case = { name: string; tr: string; ocr: string | null; language?: string; stray: string[]; repaired?: string };
const CASES: Case[] = [
  { name: 'Korean 그 for "that" (69e7613c… p31)', tr: 'At 그 time a rain of flowers fell from the sky.', ocr: TIBETAN_OCR, language: 'Tibetan', stray: ['Hangul'], repaired: 'At that time a rain of flowers fell from the sky.' },
  { name: 'fused 그at / 그hat', tr: 'At 그at time the retinue gathered; walk seven times in 그hat direction.', ocr: TIBETAN_OCR, language: 'Tibetan', stray: ['Hangul', 'Hangul'], repaired: 'At that time the retinue gathered; walk seven times in that direction.' },
  { name: 'Chinese ordinal mid-sentence (第九)', tr: 'the intention never moves from the intrinsic nature. 第九, the intention of the vast expanse', ocr: TIBETAN_OCR, language: 'Tibetan', stray: ['Han'] },
  { name: 'Chinese token glossed by its own note (卓越)', tr: 'The卓越 <note>surpassing</note> <term>Bindus</term> of form', ocr: TIBETAN_OCR, language: 'Tibetan', stray: ['Han'] },
  { name: 'kana inside a note is in a carrier tag', tr: 'begin to laugh <note>anいった expression for the crackling of fire</note>, they become slow', ocr: TIBETAN_OCR, language: 'Tibetan', stray: [] },
  { name: 'a Chinese term inside <note><term> is a gloss', tr: 'the Complete Enjoyment Body <note><term>報身</term></note>—the nature', ocr: TIBETAN_OCR, language: 'Tibetan', stray: [] },
  { name: 'OCR filler echoed in running text is the source, not a stray', tr: 'to mark the end of a section.</note> 妟妉妟妟妁妟妉妉妉如妉妟', ocr: FILLER_OCR, language: 'Tibetan', stray: [] },
  { name: 'Greek quoted by a Latin source', tr: 'which the Greeks call ἐντελέχεια, that is, perfection', ocr: 'quam Graeci ἐντελέχειαν vocant, id est perfectionem', language: 'Latin', stray: [] },
  { name: 'Greek in a Greek book whose OCR line lacks it', tr: 'the word λόγος here means reason', ocr: 'καὶ ὁ', language: 'Ancient Greek', stray: [] },
  { name: 'Hangul in the English of a Korean source is expected', tr: 'At 그 time the king said', ocr: '그 때 왕이 말하기를', language: 'Korean', stray: [], repaired: 'At 그 time the king said' },
  { name: 'Hebrew in a Latin page whose OCR has none is stray', tr: 'the name אדני is spoken', ocr: 'nomen Adonai dicitur', language: 'Latin', stray: ['Hebrew'] },
  { name: 'Persian "then" standing in for the English word', tr: 'They سپس thicken these extractions.', ocr: 'Deinde haec extracta inspissant.', language: 'Latin', stray: ['Arabic'] },
  { name: 'Russian "thus" mid-sentence', tr: 'But if, being так set together, they are positioned', ocr: 'Si vero sic composita', language: 'Latin', stray: ['Cyrillic'] },
  { name: 'transliteration marks and the micro sign belong to no script', tr: 'Abū al-Ḥasan ʿAlī; spores 3.5 µ long; the Hebrew ℵ', ocr: 'ابو الحسن علي', language: 'Arabic', stray: [] },
  { name: 'a mixed run is split by script', tr: 'φθειροντα[ς پασι γαρ', ocr: 'φθειροντας πασι γαρ', language: 'Greek', stray: ['Arabic'] },
  { name: 'plain English', tr: 'In the beginning was the Word, and the Word was with God.', ocr: 'In principio erat verbum', language: 'Latin', stray: [] },
];

describe('#5734 · what is stray — both copies of the rule', () => {
  it('the fixture can fail both ways', () => {
    expect(CASES.some((c) => c.stray.length)).toBe(true);
    expect(CASES.some((c) => !c.stray.length)).toBe(true);
  });
  for (const c of CASES) {
    it(`${c.stray.length ? 'stray' : 'clean'}: ${c.name}`, () => {
      const ctx = { ocr: c.ocr, language: c.language };
      const a = mjs.strayScripts(c.tr, ctx).map((r: any) => r.script);
      expect(a).toEqual(c.stray);
      expect(ts.strayScripts(c.tr, ctx).map((r) => r.script)).toEqual(a);
      if (c.repaired !== undefined) {
        expect(mjs.repairStrayHangul(c.tr, ctx).text).toBe(c.repaired);
        expect(ts.repairStrayHangul(c.tr, ctx).text).toBe(c.repaired);
      }
      expect(ts.strayScriptVerdict(c.tr, ctx)).toEqual(mjs.strayScriptVerdict(c.tr, ctx));
    });
  }
  it('the two copies share their tag list, scripts and reason', () => {
    expect(ts.CARRIER_TAGS).toEqual(mjs.CARRIER_TAGS);
    expect([...ts.GUARD_EXEMPT_SCRIPTS]).toEqual([...mjs.GUARD_EXEMPT_SCRIPTS]);
    expect(ts.SCRIPT_NAMES).toEqual(mjs.SCRIPT_NAMES);
    expect(ts.STRAY_SCRIPT_REASON).toBe(mjs.STRAY_SCRIPT_REASON);
  });
});

describe('#5734 · the mechanical repair touches only 그-for-"that"', () => {
  const both = (t: string, ctx = { ocr: TIBETAN_OCR }) => { const a = mjs.repairStrayHangul(t, ctx); expect(ts.repairStrayHangul(t, ctx)).toEqual(a); return a; };
  it('capitalises at a sentence start and nowhere else', () => {
    expect(both('He left. 그 man stayed.').text).toBe('He left. That man stayed.');
    expect(both('그 time came.').text).toBe('That time came.');
  });
  it('drops 그 written beside its own "that"; leaves 그 before another determiner', () => {
    expect(both('at 그 that time, and from 그 that basis').text).toBe('at that time, and from that basis');
    expect(both('At 그 that time.').text).toBe('At that time.');
    expect(both('and from 그 그 that time').other).toEqual(['그']);
    const r = both('not even 그 the shadow of comfort');
    expect(r).toMatchObject({ count: 0, other: ['그'] });
  });
  it('leaves every other Hangul for a reader and says so', () => {
    const r = both('At 그때, the king; at 그that time; 이렇게 said');
    expect(r.count).toBe(0);
    expect(r.other).toEqual(['그때', '그', '이렇게']);
  });
  it('the verdict repairs and then writes; with Han left over it refuses', () => {
    expect(mjs.strayScriptVerdict('At 그 time.', { ocr: TIBETAN_OCR })).toMatchObject({ text: 'At that time.', refuse: false, repaired: 1, judged: true });
    expect(mjs.strayScriptVerdict('At 그 time, 第九.', { ocr: TIBETAN_OCR })).toMatchObject({ text: 'At that time, 第九.', refuse: true, reason: 'stray-script' });
  });
  it('Greek and Hebrew are reported but never refused at the write (sigla, variables)', () => {
    const ctx = { ocr: 'nomen Adonai dicitur', language: 'Latin' };
    expect(mjs.strayScripts('Sinaiticus (א) and the angle β', ctx).map((r: any) => r.script)).toEqual(['Hebrew', 'Greek']);
    expect(mjs.guardStray('Sinaiticus (א) and the angle β', ctx)).toEqual([]);
    expect(ts.guardStray('Sinaiticus (א) and the angle β', ctx)).toEqual([]);
    expect(mjs.strayScriptVerdict('Sinaiticus (א) and the angle β', ctx)).toMatchObject({ refuse: false, judged: true });
  });
  it('does not judge without the source, nor a translation into another language', () => {
    expect(mjs.strayScriptVerdict('At 그 time.', {})).toMatchObject({ refuse: false, judged: false, text: 'At 그 time.' });
    expect(mjs.strayScriptVerdict('第九', { ocr: TIBETAN_OCR, targetLanguage: 'German' })).toMatchObject({ refuse: false, judged: false });
  });
});

describe('assessTranslationHealth', () => {
  it("names a stray script 'stray-script' when the source is in hand", () => {
    const body = 'the intention never moves from the intrinsic nature and the vast expanse remains. '.repeat(4);
    expect(assessTranslationHealth(TIBETAN_OCR.repeat(6), `${body} 第九, the intention`)).toEqual({ healthy: false, reason: 'stray-script' });
    expect(assessTranslationHealth(TIBETAN_OCR.repeat(6), body)).toEqual({ healthy: true, reason: null });
  });
});

// ── the doors ───────────────────────────────────────────────────────────────────────────────────

type Update = { $set?: Record<string, any> };
function makeDb(pageDoc: Record<string, unknown> = { id: 'p1', book_id: 'b1' }) {
  const calls = { pageUpdates: [] as Array<[unknown, Update]>, revisions: [] as Array<Record<string, unknown>>, finds: 0 };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => { calls.finds++; return name === 'books' ? { id: 'b1', language: 'Tibetan' } : pageDoc; },
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (filter: unknown, update: Update) => { if (name === 'pages') calls.pageUpdates.push([filter, update]); return { matchedCount: 1, modifiedCount: 1 }; },
        insertOne: async (doc: Record<string, unknown>) => { if (name === 'page_revisions') calls.revisions.push(doc); return {}; },
        insertMany: async (docs: Array<Record<string, unknown>>) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}
const call = { call_site: 'tests/unit/stray-script-guard.test.ts', promptText: 'PROMPT', generationConfig: {}, run: { code_version: 'test', host: 'test' } };
const written = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.find(([, u]) => u?.$set?.translation?.data !== undefined)?.[1].$set?.translation?.data;
const stamp = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.find(([, u]) => u?.$set?.['translation.health_blocked'])?.[1].$set?.['translation.health_blocked'];
const page = { id: 'p1', book_id: 'b1', ocr: { data: TIBETAN_OCR } };
const promptRef = { id: 'x', name: 'n', version: 13 };

describe('writePageTranslation (the .mjs door) — always on', () => {
  it('repairs 그 and writes the page', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page, book: { language: 'Tibetan' }, text: 'At 그 time a rain of flowers fell.', promptRef, call });
    expect(r.written).toBe(true);
    expect(written(calls)).toBe('At that time a rain of flowers fell.');
  });
  it('refuses a stray Han token, stamps the reason and keeps the text', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page, book: { language: 'Tibetan' }, text: 'the intrinsic nature. 第九, the intention', promptRef, call });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'stray-script' });
    expect(written(calls)).toBeUndefined();
    expect(stamp(calls)).toBe('stray-script');
    expect(calls.revisions[0]).toMatchObject({ page_id: 'p1', source: 'health-gate-refused', reason: 'stray-script' });
  });
  it('NEGATIVE CONTROL: a Greek quotation the source carries is written', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1', ocr: { data: 'quam Graeci ἐντελέχειαν vocant' } }, book: { language: 'Latin' }, text: 'which the Greeks call ἐντελέχεια', promptRef, call });
    expect(r.written).toBe(true);
    expect(stamp(calls)).toBeUndefined();
  });
});

describe('strayScriptGate — the collectors\' door, both copies', () => {
  for (const [label, gate] of [['mjs', gateMjs], ['ts', gateTs]] as Array<[string, any]>) {
    it(`${label}: a Latin-only page costs no read`, async () => {
      const { db, calls } = makeDb();
      expect(await gate(db, { id: 'p1', book_id: 'b1' }, 'plain English <note>漢</note>')).toEqual({ text: 'plain English <note>漢</note>', refused: false });
      expect(calls.finds).toBe(0);
    });
    it(`${label}: reads the OCR when not given, repairs 그, refuses Han`, async () => {
      const { db, calls } = makeDb({ id: 'p1', book_id: 'b1', ocr: { data: TIBETAN_OCR } });
      expect(await gate(db, { id: 'p1', book_id: 'b1' }, 'At 그 time.', { language: 'Tibetan' })).toEqual({ text: 'At that time.', refused: false });
      const r = await gate(db, { id: 'p1', book_id: 'b1' }, 'At 그 time, 卓越.', { language: 'Tibetan' });
      expect(r).toMatchObject({ refused: true, reason: 'stray-script', text: 'At that time, 卓越.' });
      expect(stamp(calls)).toBe('stray-script');
      expect(calls.revisions.at(-1)).toMatchObject({ source: 'health-gate-refused', reason: 'stray-script' });
    });
  }
});

// Every production writer of model translation text asks the gate before it stores a page — the
// same list as the hidden-meta guard (#5376). Catches a writer LOSING its check; a NEW writer is
// caught by the read-side scan (scripts/audit/stray-script-scan.mjs).
describe('the writers', () => {
  const WRITERS: Record<string, RegExp> = {
    'scripts/lib/translate-core.mjs': /strayScriptVerdict\(clean/,                         // the door (chained + seam batch lanes, retranslate, restore)
    'scripts/workers/translate-worker.mjs': /strayScriptVerdict\(u\.text/,                  // Hetzner realtime (+ assessTranslationHealth)
    'scripts/workers/batch-collector.mjs': /strayScriptGate\(/,                             // Hetzner batch collector
    'scripts/batch/collect-batch-results.mjs': /strayScriptGate\(/,                         // manual batch collect
    'src/lib/translate-write.ts': /strayScriptGate\(db, \{ id: pageId/,                     // the TS door
    'src/workers/translation-processor-logic.ts': /strayScriptGate\(/,                      // Lambda
    'src/app/api/books/[id]/batch-translate-async/route.ts': /strayScriptGate\(/,
    'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts': /strayScriptGate\(/,
    'src/app/api/batch-save/route.ts': /strayScriptGate\(/,
    'src/app/api/process/route.ts': /strayScriptVerdict\(/,
    'src/app/api/contribute/process/route.ts': /strayScriptVerdict\(/,
  };
  for (const [f, re] of Object.entries(WRITERS)) {
    it(`${f} asks the stray-script gate`, () => {
      expect(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')).toMatch(re);
    });
  }
  it('assessTranslationHealth carries the check (translate-worker, seam, refuseUnhealthy)', () => {
    expect(fs.readFileSync(path.join(__dirname, '../../scripts/lib/translate-core.mjs'), 'utf8')).toMatch(/guardStray\(translationText, \{ ocr: ocrText/);
  });
});
