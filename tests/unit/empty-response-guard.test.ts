/**
 * The empty-response guard (#4685): an empty or whitespace-only model answer is never stored as a
 * page's translation. It used to be written as `translation.data: ''` — over the English when the
 * page was a retranslation (a reader saw a blank page), and as a "done" page when it had none.
 * Now the page is marked `translation.fail_reason: 'empty_response'` (+ failed_at, fail_count)
 * and its existing text stands.
 *
 * One test per writer:
 *   - translate-core.mjs writePageTranslation (the .mjs door)  — behaviour, stub db
 *   - src/lib/translate-write.ts writePageTranslation (TS door) — behaviour, stub db
 *   - translate-worker.mjs single + bulk writers                — source shape (the worker runs on import)
 *   - batch-collector.mjs, collect-batch-results.mjs            — source shape (same reason)
 * The door tests import only what origin/main already exports, so on main they fail on the
 * behaviour (the empty text is written), not on a missing import.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// ── Stub db: records page updates, and honours the one filter the stamp depends on ──
const state = vi.hoisted(() => ({
  pageDoc: null as Record<string, unknown> | null,
  updates: [] as Array<[Record<string, unknown>, Record<string, Record<string, unknown>>]>,
}));

function filterMatches(filter: Record<string, unknown>): boolean {
  const cond = filter['translation.data'] as { $not?: RegExp } | undefined;
  if (cond?.$not instanceof RegExp) {
    const data = (state.pageDoc?.translation as { data?: unknown } | undefined)?.data;
    // Mongo: { $not: /re/ } matches a missing or non-string field, and a string the regex misses.
    return typeof data !== 'string' || !cond.$not.test(data);
  }
  return true;
}

function makeDb() {
  return {
    collection(name: string) {
      return {
        findOne: async () => state.pageDoc,
        find: () => ({ toArray: async () => (state.pageDoc ? [state.pageDoc] : []) }),
        updateOne: async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
          if (name !== 'pages' || !filterMatches(filter)) return { matchedCount: 0, modifiedCount: 0 };
          state.updates.push([filter, update]);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        insertOne: async () => ({ insertedId: 'rev1' }),
        insertMany: async () => ({}),
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
}

vi.mock('@/lib/mongodb', () => ({ getDb: vi.fn(async () => makeDb()) }));

import * as tsDoor from '@/lib/translate-write';
import { geminiEngine, translationInput } from '@/lib/write-provenance';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as core from '../../scripts/lib/translate-core.mjs';

const OCR = 'Principio philosophi tenuerunt omnia metalla in terra ex uno semine crescere.';
const ENGLISH = 'In the beginning the philosophers held that all metals grow in the earth from one seed.';
const call = { call_site: 'tests/unit/empty-response-guard.test.ts', promptText: 'PROMPT', generationConfig: {}, run: { code_version: 'test', host: 'test' } };
const promptRef = { id: 'x', name: 'n', version: 13 };
const tsEngine = geminiEngine({
  call_site: 'tests/unit/empty-response-guard.test.ts', api: 'realtime', model: 'gemini-test',
  prompt: { id: 'x', name: 'n', version: 13, hash: 'h', text: 'PROMPT' }, generationConfig: {},
  run: { code_version: 'test', host: 'test' }, input: translationInput({ ocrText: OCR }),
});

const wroteData = () => state.updates.some(([, u]) => {
  const set = u.$set || {};
  return (set.translation as { data?: unknown } | undefined)?.data !== undefined || 'translation.data' in set;
});
const stamp = () => state.updates.find(([, u]) => u.$set?.['translation.fail_reason'])?.[1];

function setPage(translation?: Record<string, unknown>) {
  state.pageDoc = { id: 'p1', book_id: 'b1', ocr: { data: OCR }, ...(translation ? { translation } : {}) };
}

beforeEach(() => { state.pageDoc = null; state.updates = []; });

const EMPTIES = [['empty', ''], ['whitespace-only', '  \n\t ']] as const;

describe('isEmptyTranslation (both twins)', () => {
  it('is true for nothing and for whitespace, false for any text (positive and negative controls)', () => {
    for (const fn of [core.isEmptyTranslation, tsDoor.isEmptyTranslation]) {
      expect(fn('')).toBe(true);
      expect(fn('  \n\t ')).toBe(true);
      expect(fn(null)).toBe(true);
      expect(fn(undefined)).toBe(true);
      expect(fn(ENGLISH)).toBe(false);
      expect(fn(' a ')).toBe(false);
    }
    expect(core.EMPTY_RESPONSE_REASON).toBe('empty_response');
    expect(tsDoor.EMPTY_RESPONSE_REASON).toBe('empty_response');
  });
});

describe('translate-core.mjs writePageTranslation (the .mjs door)', () => {
  const write = (text: string) => core.writePageTranslation(makeDb(), {
    page: { id: 'p1', book_id: 'b1', ocr: { data: OCR } }, book: { language: 'Latin' }, text, promptRef, call,
  });
  for (const [name, text] of EMPTIES) {
    it(`an ${name} answer on an untranslated page is marked, not written`, async () => {
      setPage();
      const r = await write(text);
      expect(r.written).toBe(false);
      expect(wroteData()).toBe(false);
      const s = stamp();
      expect(s?.$set?.['translation.fail_reason']).toBe('empty_response');
      expect(s?.$set?.['translation.failed_at']).toBeInstanceOf(Date);
      expect(s?.$inc).toEqual({ 'translation.fail_count': 1 });
    });
    it(`an ${name} answer never replaces a page's English`, async () => {
      setPage({ data: ENGLISH, source: 'ai' });
      const r = await write(text);
      expect(r.written).toBe(false);
      expect(r.text).toBe(ENGLISH); // continuity gets the real text
      expect(wroteData()).toBe(false);
      expect(stamp()).toBeUndefined(); // the real translation stands, unmarked
    });
  }
  it('writes a real translation (negative control: the guard is not refusing everything)', async () => {
    setPage();
    const r = await write(ENGLISH);
    expect(r.written).toBe(true);
    expect(wroteData()).toBe(true);
    expect(stamp()).toBeUndefined();
  });
});

describe('src/lib/translate-write.ts writePageTranslation (the TS door)', () => {
  const write = (text: string, source: string = 'ai') => tsDoor.writePageTranslation({
    pageId: 'p1', text, model: 'gemini-test', source, engine: source === 'manual' ? undefined : tsEngine,
  } as Parameters<typeof tsDoor.writePageTranslation>[0]);
  for (const [name, text] of EMPTIES) {
    it(`an ${name} model answer on an untranslated page is marked, not written`, async () => {
      setPage();
      const r = await write(text);
      expect(r.written).toBe(false);
      expect(wroteData()).toBe(false);
      expect(stamp()?.$set?.['translation.fail_reason']).toBe('empty_response');
      expect(stamp()?.$inc).toEqual({ 'translation.fail_count': 1 });
    });
    it(`an ${name} model answer never replaces a page's English`, async () => {
      setPage({ data: ENGLISH, source: 'ai' });
      const r = await write(text);
      expect(r.written).toBe(false);
      expect(r.text).toBe(ENGLISH);
      expect(wroteData()).toBe(false);
      expect(stamp()).toBeUndefined();
    });
  }
  it('writes a real translation (negative control)', async () => {
    setPage();
    const r = await write(ENGLISH);
    expect(r.written).toBe(true);
    expect(wroteData()).toBe(true);
  });
  it('leaves a non-model source alone: a person may save an empty page', async () => {
    setPage();
    const r = await write('', 'manual');
    expect(r.written).toBe(true);
    expect(stamp()).toBeUndefined();
  });
});

describe('the script writers guard before they write', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  it('translate-worker: the single-page writer checks before its health gate', () => {
    const src = read('scripts/workers/translate-worker.mjs');
    const fn = src.slice(src.indexOf('async function writePageTranslation('), src.indexOf('async function bulkWritePageTranslations('));
    expect(fn).toMatch(/if \(isEmptyTranslation\(text\)\) \{\s*await recordEmptyTranslation\(db, page\);[\s\S]{0,200}return \{ written: false/);
    expect(fn.indexOf('isEmptyTranslation(text)')).toBeLessThan(fn.indexOf('assessTranslationHealth('));
  });
  it('translate-worker: the bulk writer drops and marks empty entries before any write', () => {
    const src = read('scripts/workers/translate-worker.mjs');
    const fn = src.slice(src.indexOf('async function bulkWritePageTranslations('));
    expect(fn).toMatch(/entries = entries\.filter\(\(\{ text \}\) => !isEmptyTranslation\(text\)\)/);
    expect(fn).toMatch(/for \(const \{ page \} of empty\) \{\s*await recordEmptyTranslation\(db, page\)/);
    expect(fn.indexOf('isEmptyTranslation(')).toBeLessThan(fn.indexOf('bulkWrite('));
  });
  for (const f of ['scripts/workers/batch-collector.mjs', 'scripts/batch/collect-batch-results.mjs']) {
    it(`${f}: an empty translation answer is marked and skipped, and a real write clears the mark`, () => {
      const src = read(f);
      expect(src).toMatch(/if \(isEmptyTranslation\(text\)\) \{[\s\S]{0,300}recordEmptyTranslation\(db, \{ id: pageId \}\);[\s\S]{0,200}continue;/);
      // the guard sits before the translation write
      expect(src.indexOf('isEmptyTranslation(text)')).toBeLessThan(src.indexOf("'translation.data': text"));
      expect(src).toMatch(/\$unset: \{ \.\.\.CLEAR_STALE_UNSET, \.\.\.CLEAR_EMPTY_RESPONSE_UNSET \}/);
    });
  }
});
