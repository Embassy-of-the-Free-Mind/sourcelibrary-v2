/**
 * The reasoning-leak write guard (#6117): a "translation" that is the model's scratchpad or a chat
 * reply is never stored as a page's English. One predicate (`refusableReasoningLeak`) serves the
 * corpus count, the withhold of the pages already stored, and both write paths pinned here:
 *   - `assessTranslationHealth`, which the realtime worker and the chained/seam Batch lanes
 *     (`refuseUnhealthy: true`) ask before a write;
 *   - `writePageTranslation`, where the refusal is always on for every other caller.
 * The phrase fixtures themselves are in page-integrity.test.ts; this file pins the gate.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  refusableReasoningLeak, translationReasoningLeak, REASONING_LEAK_REASON,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';
import {
  assessTranslationHealth, writePageTranslation,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

const BODY = 'In the beginning the philosophers held that all metals grow in the earth from one seed, and that art may finish what nature left undone. '.repeat(6);
const SCRATCHPAD = `*Wait, the prompt says:* Style: warm museum label.\n\n*Final check:* tags closed.\n\n${BODY}`;
const CHAT_REPLY = 'Please provide the OCR transcription you would like me to translate.';
const OCR = 'Principio philosophi tenuerunt omnia metalla in terra ex uno semine crescere, et artem perficere posse quod natura imperfectum reliquit. '.repeat(6);

describe('refusableReasoningLeak', () => {
  it('refuses the scratchpad and the chat reply (positive controls)', () => {
    expect(refusableReasoningLeak(SCRATCHPAD)).toMatchObject({ kind: 'reasoning', readerVisible: true });
    expect(refusableReasoningLeak(CHAT_REPLY)).toMatchObject({ kind: 'assistant-reply', readerVisible: true });
  });
  it('lets a translation through (negative control)', () => {
    expect(refusableReasoningLeak(BODY)).toBeNull();
    expect(refusableReasoningLeak('')).toBeNull();
    expect(refusableReasoningLeak(null)).toBeNull();
  });
  it('does not refuse the milder kinds, or a phrase that sits only in the metadata panel', () => {
    const metaOnly = `<meta>The user wants "warm museum label" style.</meta>\n${BODY}`;
    expect(translationReasoningLeak(metaOnly)).toMatchObject({ kind: 'reasoning', readerVisible: false });
    expect(refusableReasoningLeak(metaOnly)).toBeNull();
    expect(refusableReasoningLeak(`thought\n${BODY}`)).toBeNull();
    expect(refusableReasoningLeak('The provided text contains no content to modernize, as it consists only of a blank page.')).toBeNull();
  });
  it('book text that says such things in its own voice is left alone', () => {
    expect(refusableReasoningLeak('**SALV.** *Wait, I pray you, Signor Sagredo, for just now a way occurs to me')).toBeNull();
    expect(refusableReasoningLeak('such details will be settled in a friendly spirit once you provide the further information you promised.')).toBeNull();
  });
  it('stays fast on a long junk page', () => {
    const junk = '* wait, the *'.repeat(40000); // ~520 KB
    const t0 = Date.now();
    refusableReasoningLeak(junk);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('assessTranslationHealth — the gate the worker and the Batch lanes ask', () => {
  it(`refuses a leak as '${REASONING_LEAK_REASON}'`, () => {
    expect(REASONING_LEAK_REASON).toBe('reasoning-leak');
    expect(assessTranslationHealth(OCR, SCRATCHPAD, { lang: 'Latin' })).toEqual({ healthy: false, reason: 'reasoning-leak' });
    // A chat reply is short: without this tier it would be filed as 'collapsed'.
    expect(assessTranslationHealth(OCR, CHAT_REPLY, { lang: 'Latin' })).toEqual({ healthy: false, reason: 'reasoning-leak' });
  });
  it('passes the same page translated (negative control)', () => {
    expect(assessTranslationHealth(OCR, BODY, { lang: 'Latin' })).toEqual({ healthy: true, reason: null });
  });
});

type Update = { $set?: Record<string, unknown> & { translation?: { data?: string } } };
function makeDb(pageDoc: Record<string, unknown> = { id: 'p1', book_id: 'b1' }) {
  const calls = { pageUpdates: [] as Array<[unknown, Update]>, revisions: [] as Array<Record<string, unknown>> };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
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
const call = { call_site: 'tests/unit/reasoning-leak-guard.test.ts', promptText: 'PROMPT', generationConfig: {}, run: { code_version: 'test', host: 'test' } };
const promptRef = { id: 'x', name: 'n', version: 13 };
const wroteTranslation = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.some(([, u]) => u?.$set?.translation?.data !== undefined);
const stamp = (calls: ReturnType<typeof makeDb>['calls']) => calls.pageUpdates.find(([, u]) => u?.$set?.['translation.health_blocked'])?.[1].$set;

describe('writePageTranslation (the .mjs door) — always on, no opt-in', () => {
  for (const [name, text] of [['scratchpad', SCRATCHPAD], ['chat reply', CHAT_REPLY]] as const) {
    it(`refuses a ${name}, stamps the reason and keeps the text`, async () => {
      const { db, calls } = makeDb();
      const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1', ocr: { data: OCR } }, book: { language: 'Latin' }, text, promptRef, call });
      expect(r).toMatchObject({ written: false, protected: false, unhealthy: true, reason: 'reasoning-leak' });
      expect(wroteTranslation(calls)).toBe(false);
      expect(stamp(calls)?.['translation.health_blocked']).toBe('reasoning-leak');
      expect(calls.revisions).toHaveLength(1);
      expect(calls.revisions[0]).toMatchObject({ page_id: 'p1', book_id: 'b1', field: 'translation', source: 'health-gate-refused', reason: 'reasoning-leak' });
    });
  }
  it('with the opt-in gate the refusal is returned to the caller, which stamps it (the Batch lanes)', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1', ocr: { data: OCR } }, book: { language: 'Latin' }, text: SCRATCHPAD, promptRef, call, refuseUnhealthy: true });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'reasoning-leak' });
    expect(wroteTranslation(calls)).toBe(false);
    expect(calls.revisions[0]).toMatchObject({ source: 'health-gate-refused', reason: 'reasoning-leak' });
  });
  it('writes an ordinary page (negative control: the gate is not refusing everything)', async () => {
    const { db, calls } = makeDb();
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1', ocr: { data: OCR } }, book: { language: 'Latin' }, text: BODY, promptRef, call });
    expect(r.written).toBe(true);
    expect(wroteTranslation(calls)).toBe(true);
    expect(stamp(calls)).toBeUndefined();
  });
  it('does not stamp a page a person translated', async () => {
    const { db, calls } = makeDb({ id: 'p1', book_id: 'b1', translation: { data: 'BY HAND', source: 'manual' } });
    const r = await writePageTranslation(db, { page: { id: 'p1', book_id: 'b1' }, book: { language: 'Latin' }, text: SCRATCHPAD, promptRef, call });
    expect(r).toMatchObject({ written: false, protected: true });
    expect(calls.pageUpdates).toHaveLength(0);
  });
});

describe('the lanes go through the gate', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('translate-worker asks assessTranslationHealth on both of its write paths', () => {
    const src = read('scripts/workers/translate-worker.mjs');
    expect(src.match(/assessTranslationHealth\(page\.ocr\?\.data, text, \{ lang: book\?\.language \}\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it('the chained and seam Batch lanes write through the door with refuseUnhealthy', () => {
    for (const f of ['scripts/lib/translate-batch-chained.mjs', 'scripts/lib/translate-batch-seam.mjs']) {
      const src = read(f);
      expect(src, f).toMatch(/deps\.writePage \|\| writePageTranslation/);
      expect(src, f).toMatch(/refuseUnhealthy: true/);
    }
  });
  it('the corpus count and the withhold use the gate\'s predicate', () => {
    expect(read('scripts/audit/translation-reasoning-leak.mjs')).toMatch(/refusableReasoningLeak\(/);
    expect(read('scripts/maintenance/withhold-leaked-reasoning-6117.mjs')).toMatch(/refusableReasoningLeak\(/);
  });
});
