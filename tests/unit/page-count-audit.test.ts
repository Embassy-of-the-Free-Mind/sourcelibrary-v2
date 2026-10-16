/**
 * Pins the comparators of the page-count audit (#5331):
 *
 *  - compareBookCounters: direction per counter; a missing counter is a mismatch,
 *    not a zero; a HIGH counter is explained only up to the book's recent page writes.
 *  - summarizeCounters: one unexplained HIGH counter fails on a single book; a
 *    lagging counter fails only above 1% of settled books; in-flight books are
 *    judged by the HIGH rule only.
 *  - counterPositiveControl: each of the six counters must fire, and a sample with
 *    nothing to perturb is a broken probe, never a pass.
 *  - checkMissingTranslatable: the 100 bar and week-over-week growth.
 */
import { describe, it, expect } from 'vitest';
import {
  compareBookCounters, summarizeCounters, counterPositiveControl, checkMissingTranslatable,
  // @ts-expect-error — plain .mjs helper, no types
} from '../../scripts/lib/page-count-audit.mjs';

const stats = { total: 10, with_ocr: 8, with_translation: 4, translatable: 9, translated_translatable: 4, blank: 1, archived: 10 };
const exact = { pages_count: 10, pages_ocr: 8, pages_translated: 4, pages_translatable: 9, pages_blank: 1, pages_archived: 10 };
const row = (id: string, book: Record<string, unknown> = exact, recentPages = 0) => ({ id, book, stats, recentPages });

describe('compareBookCounters', () => {
  it('agrees when all six counters match the recount', () => {
    expect(compareBookCounters(row('a')).agree).toBe(true);
  });

  it('names the direction of each disagreeing counter', () => {
    const c = compareBookCounters(row('a', { ...exact, pages_ocr: 11, pages_blank: 0 })).counters;
    expect(c.pages_ocr).toMatchObject({ direction: 'higher', excess: 3, unexplained: true });
    expect(c.pages_blank).toMatchObject({ direction: 'lower' });
    expect(c.pages_count.agree).toBe(true);
  });

  it('reads a missing counter as a mismatch, not a zero', () => {
    const { pages_translatable: _, ...book } = exact;
    expect(compareBookCounters(row('a', book)).counters.pages_translatable).toMatchObject({ agree: false, direction: 'missing' });
  });

  it('explains a HIGH counter only up to the pages written in the last 2 h', () => {
    expect(compareBookCounters(row('a', { ...exact, pages_ocr: 10 }, 2)).counters.pages_ocr.unexplained).toBe(false);
    expect(compareBookCounters(row('a', { ...exact, pages_ocr: 11 }, 2)).counters.pages_ocr.unexplained).toBe(true);
  });

  it('recounts a book with no visible pages to zeros', () => {
    const c = compareBookCounters({ id: 'a', book: exact, stats: null }).counters;
    expect(c.pages_count).toMatchObject({ recount: 0, direction: 'higher' });
  });
});

describe('summarizeCounters', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => compareBookCounters(row(`b${i}`)));

  it('passes a clean sample', () => {
    expect(summarizeCounters(many(300)).fails).toEqual([]);
  });

  it('fails on ONE unexplained HIGH counter, even inside the 1% bar', () => {
    const s = summarizeCounters([...many(299), compareBookCounters(row('x', { ...exact, pages_translated: 9 }))]);
    expect(s.fails).toHaveLength(1);
    expect(s.fails[0]).toMatch(/^pages_translated: 1 of 300 .* HIGHER .*\(5 pages\)/);
  });

  it('tolerates lagging counters up to 1% of settled books, per counter', () => {
    const low = (id: string) => compareBookCounters(row(id, { ...exact, pages_ocr: 7 }));
    expect(summarizeCounters([...many(297), low('l1'), low('l2'), low('l3')]).fails).toEqual([]);
    const f = summarizeCounters([...many(296), low('l1'), low('l2'), low('l3'), low('l4')]).fails;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^pages_ocr: 4 of 300 settled/);
  });

  it('counts a missing counter toward the share', () => {
    const { pages_translatable: _, ...book } = exact;
    const miss = (id: string) => compareBookCounters(row(id, book));
    const s = summarizeCounters([...many(96), miss('m1'), miss('m2'), miss('m3'), miss('m4')]);
    expect(s.by_counter.pages_translatable).toMatchObject({ off: 4, missing: 4 });
    expect(s.fails[0]).toMatch(/^pages_translatable: 4 of 100/);
  });

  it('judges in-flight books by the HIGH rule only', () => {
    const busy = Array.from({ length: 10 }, (_, i) => compareBookCounters(row(`f${i}`, { ...exact, pages_ocr: 7 }, 3)));
    const s = summarizeCounters([...many(90), ...busy]);
    expect(s).toMatchObject({ settled: 90, in_flight: 10 });
    expect(s.fails).toEqual([]);
  });
});

describe('counterPositiveControl', () => {
  it('fires on all six counters of an agreeing settled book', () => {
    expect(counterPositiveControl([row('drift', { ...exact, pages_ocr: 1 }), row('ok')])).toMatchObject({ ok: true, book: 'ok', missed: [] });
  });

  it('is a broken probe when there is nothing to perturb', () => {
    expect(counterPositiveControl([row('drift', { ...exact, pages_ocr: 1 }), row('busy', exact, 4)])).toMatchObject({ ok: false });
    expect(counterPositiveControl([]).ok).toBe(false);
  });
});

describe('checkMissingTranslatable', () => {
  const now = Date.parse('2026-10-13T06:00:00Z');
  const at = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it('fails above 100', () => {
    expect(checkMissingTranslatable(100, [], now).fails).toEqual([]);
    expect(checkMissingTranslatable(101, [], now).fails).toHaveLength(1);
  });

  it('fails on growth over the reading of about a week ago', () => {
    const h = [{ at: at(8), missing: 1 }, { at: at(7), missing: 3 }, { at: at(1), missing: 50 }];
    expect(checkMissingTranslatable(4, h, now)).toMatchObject({ growth: 1, week_ago: { missing: 3 } });
    expect(checkMissingTranslatable(4, h, now).fails).toHaveLength(1);
    expect(checkMissingTranslatable(3, h, now).fails).toEqual([]);
  });

  it('reports no baseline when nothing is six days old', () => {
    expect(checkMissingTranslatable(0, [{ at: at(2), missing: 0 }], now)).toMatchObject({ week_ago: null, growth: null, fails: [] });
  });
});
