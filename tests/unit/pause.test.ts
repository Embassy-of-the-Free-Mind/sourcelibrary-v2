import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PAUSE_KEYS,
  PAUSE_ALIASES,
  PHASE_ONLY_ENTRIES,
  PHASE_PAUSE_KEY,
  classifyPauseEntry,
  pausedKeys,
  unknownPauseEntries,
  validatePauseKeys,
  isPaused,
  resetPauseWarnings,
  // @ts-expect-error — plain .mjs helper, no types
} from '../../scripts/lib/pause.mjs';

/**
 * #5492: `paused_phases` had two vocabularies that did not overlap — `'ocr'`/`'images'`
 * paused nothing, numbers missed every worker outside the orchestrator. These pin the one
 * vocabulary: every alias resolves to its step, and every word no lane reads is reported.
 */

// Every legacy entry, and the step it must now pause.
const ALIAS_CASES: Array<[unknown, string]> = [
  ['translation', 'translate'],
  ['enrichment', 'enrich'],
  [1.5, 'ocr'],
  ['1.5', 'ocr'],
  [2, 'ocr'],
  ['2', 'ocr'],
  [4, 'translate'],
  [5, 'translate'],
  [6, 'enrich'],
  [7, 'enrich'],
  [8, 'images'],
  ['8', 'images'],
];

// Words somebody could plausibly write that no lane reads. Each must be reported, never
// silently ignored.
const UNKNOWN_CASES: unknown[] = [
  'image', 'imgs', 'image_extraction', 'OCR', 'Images', ' ocr', 'ocr ', 'translations', 'translate_batch',
  'chained', 'enrich-worker', 'embedding', 'embed', 'archiving', 'all', '*', '', 'preview', 'summary',
  10, 2.5, 4.5, -1, 99, NaN, null, undefined, true, {}, [], ['ocr'],
];

beforeEach(() => resetPauseWarnings());

describe('vocabulary', () => {
  it('is the pipeline steps plus embeddings', () => {
    expect([...PAUSE_KEYS]).toEqual(['archive', 'ocr', 'translate', 'enrich', 'images', 'embeddings']);
  });

  it.each(PAUSE_KEYS as string[])('canonical key %s classifies as itself', (k) => {
    expect(classifyPauseEntry(k)).toEqual({ kind: 'key', key: k });
  });

  it.each(ALIAS_CASES)('alias %j pauses %s', (entry, key) => {
    expect(classifyPauseEntry(entry)).toEqual({ kind: 'alias', key });
    expect([...pausedKeys({ paused_phases: [entry] })]).toEqual([key]);
    expect(isPaused({ paused_phases: [entry] }, key, { log: () => {} })).toBe(true);
  });

  it('covers every alias the module declares', () => {
    const tested = new Set(ALIAS_CASES.map(([e]) => String(Number.isFinite(Number(e)) ? Number(e) : e)));
    for (const a of Object.keys(PAUSE_ALIASES)) expect(tested.has(a)).toBe(true);
  });

  it.each(UNKNOWN_CASES.map((u) => [u]))('unknown entry %j pauses nothing and is reported', (entry) => {
    expect(classifyPauseEntry(entry)).toEqual({ kind: 'unknown' });
    const control = { paused_phases: [entry] };
    expect(pausedKeys(control).size).toBe(0);
    expect(unknownPauseEntries(control)).toEqual([entry]);
    const log = vi.fn();
    for (const k of PAUSE_KEYS) expect(isPaused(control, k, { log })).toBe(false);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/UNKNOWN paused_phases entry/);
    expect(validatePauseKeys([entry]).ok).toBe(false);
  });

  it.each(PHASE_ONLY_ENTRIES.map((p: number) => [p]))('orchestrator phase %s is valid but pauses no step', (p) => {
    expect(classifyPauseEntry(p)).toEqual({ kind: 'phase', phase: p });
    expect(pausedKeys({ paused_phases: [p] }).size).toBe(0);
    expect(unknownPauseEntries({ paused_phases: [p] })).toEqual([]);
  });

  it('maps every keyed orchestrator phase to a real key', () => {
    for (const k of Object.values(PHASE_PAUSE_KEY)) expect(PAUSE_KEYS).toContain(k);
  });
});

describe('isPaused', () => {
  it('a step pause is independent of the global flag (a scope cannot bypass it)', () => {
    const c = { paused: false, paused_phases: ['translate'], allow_scopes: { a: { book_ids: ['x'] } } };
    expect(isPaused(c, 'translate')).toBe(true);
    expect(isPaused(c, 'ocr')).toBe(false);
  });

  it('a global pause alone is not a step pause (lanes check it separately)', () => {
    expect(isPaused({ paused: true }, 'ocr')).toBe(false);
  });

  it('no control document, or no list, pauses nothing', () => {
    expect(isPaused(null, 'ocr')).toBe(false);
    expect(isPaused({}, 'ocr')).toBe(false);
    expect(isPaused({ paused_phases: 'ocr' }, 'ocr')).toBe(false);
  });

  it('throws when a lane asks with a word that is not a key', () => {
    expect(() => isPaused({}, 'translation')).toThrow(/not a pause key/);
    expect(() => isPaused({}, 2)).toThrow(/not a pause key/);
  });

  it('logs an unknown entry once per minute, not once per call', () => {
    const log = vi.fn();
    const c = { paused_phases: ['image'] };
    isPaused(c, 'images', { log, now: 0 });
    isPaused(c, 'images', { log, now: 1000 });
    expect(log).toHaveBeenCalledTimes(1);
    isPaused(c, 'images', { log, now: 61_000 });
    expect(log).toHaveBeenCalledTimes(2);
  });
});

describe('validatePauseKeys', () => {
  it('canonicalises aliases and keeps phase-only numbers', () => {
    expect(validatePauseKeys(['translation', 2, 'ocr', 1.97])).toEqual({ ok: true, keys: ['translate', 'ocr', 1.97], unknown: [] });
  });
  it('lists every unknown entry', () => {
    expect(validatePauseKeys(['ocr', 'image', 10])).toEqual({ ok: false, keys: ['ocr'], unknown: ['image', 10] });
  });
  it('rejects a non-array', () => {
    expect(validatePauseKeys('ocr').ok).toBe(false);
  });
});
