/**
 * Pins the comparators of the translation-state reconciling audit (#5290):
 *
 *  - compareRung / summarizeRecount: a stored rung HIGHER than the recount fails
 *    on a single book; lagging rungs fail only above 1%; an unstamped book and a
 *    wrong english_original are disagreements, not passes.
 *  - rungPositiveControl: perturbing one agreeing book must be flagged, and a
 *    sample with nothing to perturb is a broken probe, never a pass.
 *  - checkHeadline: stale beats drift, a missing number is `unreadable`.
 *  - parseReadableFigures: the four live page shapes (2026-10-12 markup).
 *  - isCarryForwardShape: the preview stub is caught, the blank-verso facsimile is not.
 *  - auditVerdict: FAIL > probe_broken > PASS.
 */
import { describe, it, expect } from 'vitest';
import {
  compareRung, summarizeRecount, rungPositiveControl, checkHeadline, headlinePositiveControl,
  parseReadableFigures, isCarryForwardShape, auditVerdict,
  // @ts-expect-error — plain .mjs helper, no types
} from '../../scripts/lib/translation-state-audit.mjs';

const row = (id: string, stored: string | null, recount: string, eng = false, recEng = false) => ({
  id,
  stored: stored ? { rung: stored, english_original: eng } : null,
  recount: { rung: recount, english_original: recEng },
});

describe('compareRung', () => {
  it('agrees on the same rung and flag', () => {
    expect(compareRung(row('a', 'readable', 'readable'))).toMatchObject({ agree: true, direction: 'same' });
  });
  it('names the direction of a disagreement', () => {
    expect(compareRung(row('a', 'complete', 'transcribed'))).toMatchObject({ agree: false, direction: 'higher' });
    expect(compareRung(row('a', 'translating', 'readable'))).toMatchObject({ agree: false, direction: 'lower' });
  });
  it('treats a missing or unknown stamp as a disagreement', () => {
    expect(compareRung(row('a', null, 'readable')).direction).toBe('unstamped');
    expect(compareRung(row('a', 'translated', 'readable')).direction).toBe('unstamped');
  });
  it('flags a wrong english_original on an otherwise right rung', () => {
    expect(compareRung(row('a', 'transcribed', 'transcribed', true, false))).toMatchObject({ agree: false, direction: 'english_original' });
  });
});

describe('summarizeRecount', () => {
  const agreeing = (n: number) => Array.from({ length: n }, (_, i) => compareRung(row(`b${i}`, 'readable', 'readable')));
  it('passes a clean sample', () => {
    expect(summarizeRecount(agreeing(300)).fails).toEqual([]);
  });
  it('fails on ONE overstated rung, well under 1%', () => {
    const s = summarizeRecount([...agreeing(299), compareRung(row('x', 'complete', 'translating'))]);
    expect(s.higher).toBe(1);
    expect(s.fails).toHaveLength(1);
  });
  it('tolerates lag up to 1% and fails above it', () => {
    const lag = (n: number) => Array.from({ length: n }, (_, i) => compareRung(row(`l${i}`, 'translating', 'readable')));
    expect(summarizeRecount([...agreeing(297), ...lag(3)]).fails).toEqual([]);
    expect(summarizeRecount([...agreeing(296), ...lag(4)]).fails).toHaveLength(1);
  });
});

describe('rungPositiveControl', () => {
  it('fires on a perturbed book, upward when there is room', () => {
    expect(rungPositiveControl([row('a', 'readable', 'readable')])).toMatchObject({ ok: true, to: 'complete', got: 'higher' });
  });
  it('perturbs downward from the top rung', () => {
    expect(rungPositiveControl([row('a', 'complete', 'complete')])).toMatchObject({ ok: true, to: 'readable', got: 'lower' });
  });
  it('is broken when no sampled book agrees', () => {
    expect(rungPositiveControl([row('a', null, 'readable')]).ok).toBe(false);
    expect(rungPositiveControl([]).ok).toBe(false);
  });
});

describe('checkHeadline', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const base = { surface: 's', view: 'readable_in_english', expected: 20000, now };
  it('passes inside the tolerance and the bound', () => {
    expect(checkHeadline({ ...base, value: 20150, at: now - 3_600_000, maxAgeMs: 26 * 3_600_000 }).status).toBe('ok');
  });
  it('fails a value from another definition', () => {
    expect(checkHeadline({ ...base, value: 22300 }).status).toBe('drift');
    expect(checkHeadline({ ...base, value: 17000 }).status).toBe('drift');
  });
  it('reports stale before drift', () => {
    expect(checkHeadline({ ...base, value: 20000, at: now - 48 * 3_600_000, maxAgeMs: 26 * 3_600_000 }).status).toBe('stale');
  });
  it('never passes a missing number or a missing stamp', () => {
    expect(checkHeadline({ ...base, value: null }).status).toBe('unreadable');
    expect(checkHeadline({ ...base, value: 20000, at: null, maxAgeMs: 3_600_000 }).status).toBe('unreadable');
  });
  it('gives small collections a floor of slack', () => {
    expect(checkHeadline({ ...base, expected: 12, value: 14, slack: 2 }).status).toBe('ok');
    expect(checkHeadline({ ...base, expected: 12, value: 15, slack: 2 }).status).toBe('drift');
  });
  it('has a control that fires', () => {
    expect(headlinePositiveControl(20000, now).ok).toBe(true);
  });
});

describe('parseReadableFigures', () => {
  it('reads the live page shapes', () => {
    expect(parseReadableFigures('<div class="x">20,189</div><div class="y">books readable in English</div>')).toEqual([20189]);
    expect(parseReadableFigures('<p>20,189<!-- --> books readable in English</p>')).toEqual([20189]);
    expect(parseReadableFigures('<meta content="42289 books, 20189 of them readable in English">')).toEqual([20189]);
    expect(parseReadableFigures('<b>20,189</b><span class="a b">readable in English</span>')).toEqual([20189]);
    expect(parseReadableFigures('<p>42,289 books, 20189 of them readable in English</p><b>20,189</b> readable in English')).toEqual([20189]);
  });
  it('returns nothing when the copy changed', () => {
    expect(parseReadableFigures('<p>20,189 translated books</p>')).toEqual([]);
  });
});

describe('isCarryForwardShape', () => {
  it('catches the preview stub (#5063)', () => {
    expect(isCarryForwardShape({ translation_state: { rung: 'complete' }, pages_count: 300, pages_blank: 0, pages_translated: 25 })).toBe(true);
  });
  it('leaves a facsimile with blank versos alone', () => {
    expect(isCarryForwardShape({ translation_state: { rung: 'complete' }, pages_count: 168, pages_blank: 86, pages_translated: 82 })).toBe(false);
  });
  it('ignores pamphlets and lower rungs', () => {
    expect(isCarryForwardShape({ translation_state: { rung: 'complete' }, pages_count: 30, pages_translated: 5 })).toBe(false);
    expect(isCarryForwardShape({ translation_state: { rung: 'translating' }, pages_count: 300, pages_translated: 25 })).toBe(false);
  });
});

describe('auditVerdict', () => {
  it('orders FAIL over probe_broken over PASS', () => {
    expect(auditVerdict({ fails: ['x'], controlsOk: false, unreadable: ['s'] })).toEqual({ verdict: 'FAIL', exit: 1 });
    expect(auditVerdict({ fails: [], controlsOk: false, unreadable: [] })).toEqual({ verdict: 'probe_broken', exit: 2 });
    expect(auditVerdict({ fails: [], controlsOk: true, unreadable: ['s'] })).toEqual({ verdict: 'probe_broken', exit: 2 });
    expect(auditVerdict({ fails: [], controlsOk: true, unreadable: [] })).toEqual({ verdict: 'PASS', exit: 0 });
  });
});
