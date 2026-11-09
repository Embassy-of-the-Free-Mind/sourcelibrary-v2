/**
 * FINISH FIRST (#8482, Derek 2026-11-10): the agy pools are spent on the pages that finish a book first, untranslated
 * pages of other visible books next, and quality re-reads / re-translations only with what is left.
 * scripts/lib/agy-pools.mjs (FINISH_RESERVE, the finish-queue stamp), scripts/batch/cli-ocr-lane.mjs (the finish order,
 * --finish-first, the finish cohort, books finished), scripts/batch/cli-translate-lane.mjs (finish, the per-page gate).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { weeklyReserve, LANE_RESERVES, FINISH_RESERVE, writeFinishQueue, finishQueueOpen, FINISH_QUEUE_MAX_AGE_H } from '../../scripts/lib/agy-pools.mjs';
import {
  quotaFloor, latinFirstSteps, isFinishBook, finishFirstBook, byFinishFirst, translatedShare, finishedTally, correctablePageMatch,
  finishReadSkip, FINISH_READ_BOOKS, FINISH_MIN_SHARE,
} from '../../scripts/batch/cli-ocr-lane.mjs';
import { gateSplit, gateReleaseNote, finishPages, FINISH_BOOKS, GATE_RELEASE_HOURS } from '../../scripts/batch/cli-translate-lane.mjs';

const H = 3600e3;
const reset = '2026-11-15T22:00:00Z';
const at = (hoursBefore: number) => Date.parse(reset) - hoursBefore * H;
const total = Object.values(LANE_RESERVES).reduce((s, v) => s + v, 0);
const ts = (translated: number, translatable: number, rung = 'translating') => ({ translation_state: { translated, translatable, rung } });

describe('FINISH_RESERVE: quality lanes yield while the finishing lanes have work', () => {
  it('a quality lane keeps FINISH_RESERVE on top of LANE_RESERVES only while the queue is open', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(100), yieldToFinish: true, finishOpen: true })).toBeCloseTo(total + FINISH_RESERVE, 9);
    expect(weeklyReserve({ resetTime: reset, now: at(100), yieldToFinish: true, finishOpen: false })).toBeCloseTo(total, 9);
    // a finishing (or any other) lane never keeps it
    expect(weeklyReserve({ resetTime: reset, now: at(100), finishOpen: true })).toBeCloseTo(total, 9);
    expect(weeklyReserve({ resetTime: reset, now: at(100), lane: 'cli-translate', finishOpen: true })).toBeCloseTo(total - LANE_RESERVES['cli-translate'], 9);
  });
  it('drops with every other reserve in the last 36 h before the reset', () => {
    expect(weeklyReserve({ resetTime: reset, now: at(20), yieldToFinish: true, finishOpen: true })).toBe(0);
  });
  it('quotaFloor: a pool between the two lines is shut for a quality lane and open for a finishing lane', () => {
    const b = (w: number) => [{ id: 'gemini-weekly', remaining_fraction: w, reset_time: reset }, { id: 'gemini-5h', remaining_fraction: 0.9 }];
    const w = total + FINISH_RESERVE / 2;
    expect(quotaFloor(b(w), { now: at(100), yieldToFinish: true, finishOpen: true }).ok).toBe(false);
    expect(quotaFloor(b(w), { now: at(100), lane: 'cli-translate', finishOpen: true }).ok).toBe(true);
    expect(quotaFloor(b(w), { now: at(100), yieldToFinish: true, finishOpen: false }).ok).toBe(true);
  });
  it('the stamp: fresh with pages is open; empty, stale or missing is not', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-q-'));
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(finishQueueOpen({ dir: path.join(dir, 'none'), now }).open).toBe(false);
    writeFinishQueue('a', { books: 3, pages: 0 }, { dir, now });
    expect(finishQueueOpen({ dir, now }).open).toBe(false);
    writeFinishQueue('b', { books: 3, pages: 40 }, { dir, now });
    expect(finishQueueOpen({ dir, now }).open).toBe(true);
    expect(finishQueueOpen({ dir, now: now + (FINISH_QUEUE_MAX_AGE_H + 0.1) * H }).open).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the finish order', () => {
  it('a finish book is >= 80% translated and not complete', () => {
    expect(FINISH_MIN_SHARE).toBe(0.8);
    expect(isFinishBook(ts(80, 100))).toBe(true);
    expect(isFinishBook(ts(79, 100))).toBe(false);
    expect(isFinishBook(ts(100, 100, 'complete'))).toBe(false);
    expect(isFinishBook({})).toBe(false);
    expect(translatedShare(ts(5, 0))).toBe(0);
  });
  it('--finish-first also takes a book the CLI translation lane holds, whatever its share', () => {
    expect(finishFirstBook({ ...ts(1, 100), pipeline_auto: { status: 'held', hold: { reason: 'translate-cli-7075' } } })).toBe(true);
    expect(finishFirstBook({ ...ts(1, 100), pipeline_auto: { status: 'complete' } })).toBe(false);
  });
  it('closest to done first: finish books, then share, then fewest pages left', () => {
    const books = [
      { id: 'low', ...ts(10, 100) }, { id: 'big90', ...ts(900, 1000) }, { id: 'small90', ...ts(90, 100) },
      { id: 'b85', ...ts(85, 100) }, { id: 'none', ...ts(0, 50, 'transcribed') },
    ];
    expect([...books].sort(byFinishFirst).map((b) => b.id)).toEqual(['small90', 'big90', 'b85', 'low', 'none']);
  });
  it('books finished counts crossings into readable or complete, once', () => {
    const before = new Map([['a', 'translating'], ['b', 'readable'], ['c', 'translating'], ['d', 'readable'], ['e', 'transcribing']]);
    const after = new Map([['a', 'readable'], ['b', 'complete'], ['c', 'translating'], ['d', 'readable'], ['e', 'complete']]);
    expect(finishedTally(before, after)).toEqual({ touched: 5, finished: 3, readable: 1, complete: 2 });
  });
});

describe('--finish-first and the finish cohort', () => {
  it('--finish-first selects untranslated Flash-Lite pages only; the default frame is unchanged', () => {
    expect(correctablePageMatch('b', [], { untranslatedOnly: true })['translation.data']).toEqual({ $in: [null, ''] });
    expect(correctablePageMatch('b', [])).not.toHaveProperty('translation.data');
  });
  it('latin-first runs the finishing steps first, then the quality steps, which yield', () => {
    const s = latinFirstSteps({ home: '/root/.agy-milo', root: '/r', date: '2026-11-10', maxPages: 3000, concurrency: 6, apply: true });
    expect(s.map((x) => x.step)).toEqual(['finish-latin', 'finish-german-french', 'latin-priority', 'german-french-correct', 'latin-rest']);
    for (const x of s.slice(0, 2)) { expect(x.args).toContain('--finish-first'); expect(x.args).not.toContain('--yield-to-finish'); }
    for (const x of s.slice(2)) { expect(x.args).toContain('--yield-to-finish'); expect(x.args).not.toContain('--finish-first'); }
    // same day folders as the quality steps: one ledger and one set of claims, so no page is read twice
    expect(s[0].args).toContain('--out=/r/cli-ocr-reread/2026-11-10');
    expect(s[1].args).toContain('--out=/r/cli-ocr-correct/2026-11-10');
  });
  it('the finish cohort reads idle or CLI-held finish books, and says why not', () => {
    expect(FINISH_READ_BOOKS.visible).toBe(true);
    const ok = { id: 'x', visible: true, pages_count: 10, language: 'German', ...ts(9, 10), pipeline_auto: { status: 'complete' } };
    expect(finishReadSkip({ ...ok, ...ts(5, 10) })).toMatch(/under 80%/);
    expect(finishReadSkip({ ...ok, pipeline_auto: { held: true } })).toBe('pipeline_auto.held');
    expect(finishReadSkip(ok, { languages: ['fra'] })).toMatch(/--languages/);
  });
});

describe('cli-translate-lane finish', () => {
  it('reads only idle, unheld, visible books that are not English originals', () => {
    expect(FINISH_BOOKS['pipeline_auto.hold']).toEqual({ $exists: false });
    expect(FINISH_BOOKS['translation_state.english_original']).toEqual({ $ne: true });
  });
  it('translates a withheld page only when its English was withheld because its OCR was replaced', () => {
    const q = finishPages('b');
    expect(q.$and[0].$or).toEqual([{ translation_withheld: { $exists: false } }, { 'translation_withheld.reason': 'stale_after_reocr' }]);
    expect(q.$or).toBeDefined();   // UNTRANSLATED's own clause is kept
  });
  it('the gate per page: other pages go now, Flash-Lite pages wait, and are released after GATE_RELEASE_HOURS', () => {
    const take = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const lite = new Set(['p2']);
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(gateSplit(take, lite, now - H, { now })).toEqual({ now: ['p1', 'p3'], wait: ['p2'], released: [] });
    expect(gateSplit(take, lite, now - GATE_RELEASE_HOURS * H, { now })).toEqual({ now: ['p1', 'p3'], wait: [], released: ['p2'] });
    expect(gateSplit(take, new Set(), null, { now })).toEqual({ now: ['p1', 'p2', 'p3'], wait: [], released: [] });
    // the release names itself, long enough for the readers' --ocr-checked (10 characters)
    expect(gateReleaseNote(now, 2).length).toBeGreaterThan(10);
  });
});
