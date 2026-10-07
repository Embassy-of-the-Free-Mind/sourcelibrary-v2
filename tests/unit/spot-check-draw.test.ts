/**
 * The fortnightly spot check's draw (#5914, scripts/eval/spot-check/lib.mjs).
 *
 * A fortnight's rate is only comparable to the last if the draw is the same instrument each time: the same
 * seed over the same frame gives the same books and pages, whatever order Mongo returned the frame in; the
 * unit is the BOOK (one run of 3 consecutive translated pages per book, never two runs from one book — pages
 * in a book are one observation); and a book with no such run is skipped, not padded with loose pages.
 */
import { describe, it, expect } from 'vitest';
import {
  drawSample, pickRun, bookOrder, seedFromDate, structureCounts, printedToNum,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/eval/spot-check/lib.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { makeRng } from '../../scripts/eval/lib/paired-stats.mjs';

type Pick = { id: string; start: number; pages: number[] };

const frame = Array.from({ length: 500 }, (_, i) => `book${String(i).padStart(4, '0')}`);
// Every book has translated pages 1..40 except every 7th, which has only scattered pages (no run of 3).
const translated = (id: string): number[] => (Number(id.slice(4)) % 7 === 0 ? [1, 3, 5, 9, 12] : Array.from({ length: 40 }, (_, i) => i + 1));

describe('spot-check draw', () => {
  it('is deterministic: same seed and frame → same books and runs', async () => {
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    expect(b).toEqual(a);
  });

  it('does not depend on the order the frame arrives in', async () => {
    const shuffled = [...frame].reverse();
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame: shuffled, n: 10, seed: 20261019, translatedFor: translated });
    expect(b).toEqual(a);
  });

  it('a different seed draws a different sample', async () => {
    const a = await drawSample({ frame, n: 10, seed: 20261019, translatedFor: translated });
    const b = await drawSample({ frame, n: 10, seed: 20261102, translatedFor: translated });
    expect(b.picks.map((p: Pick) => p.id)).not.toEqual(a.picks.map((p: Pick) => p.id));
  });

  it('one run per book: n distinct books, each with exactly 3 consecutive translated pages', async () => {
    for (const seed of [1, 2, 3, 20261006, 20261019]) {
      const { picks, rejected } = await drawSample({ frame, n: 10, seed, translatedFor: translated });
      expect(picks).toHaveLength(10);
      expect(new Set(picks.map((p: Pick) => p.id)).size).toBe(10);
      for (const p of picks) {
        expect(p.pages).toEqual([p.start, p.start + 1, p.start + 2]);
        const ok = new Set(translated(p.id));
        expect(p.pages.every((n: number) => ok.has(n))).toBe(true);
      }
      // books without a run are skipped and recorded, never drawn
      for (const id of rejected) expect(Number(id.slice(4)) % 7).toBe(0);
      expect(picks.some((p: Pick) => Number(p.id.slice(4)) % 7 === 0)).toBe(false);
    }
  });

  it('is uniform per book, not per page', async () => {
    // Half the frame has 1,000 translated pages, half has 3. A page-weighted draw would pick the big books
    // ~99.7% of the time; a book-uniform one picks them about half the time.
    const big = (id: string) => Number(id.slice(4)) % 2 === 0;
    const pagesOf = (id: string) => Array.from({ length: big(id) ? 1000 : 3 }, (_, i) => i + 1);
    let bigCount = 0, total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { picks } = await drawSample({ frame, n: 10, seed, translatedFor: pagesOf });
      for (const p of picks) { total++; if (big(p.id)) bigCount++; }
    }
    expect(bigCount / total).toBeGreaterThan(0.44);
    expect(bigCount / total).toBeLessThan(0.56);
  });

  it('bookOrder never repeats a book, and dedupes the frame', () => {
    const order = [...bookOrder([...frame, ...frame.slice(0, 50)], makeRng(7))];
    expect(order).toHaveLength(frame.length);
    expect(new Set(order).size).toBe(frame.length);
  });

  it('pickRun returns null when no 3 consecutive pages exist', () => {
    expect(pickRun([1, 2, 4, 5, 7], makeRng(1))).toBeNull();
    expect(pickRun([4, 5, 6], makeRng(1))).toBe(4);
  });

  it('seedFromDate', () => {
    expect(seedFromDate('2026-10-19')).toBe(20261019);
    expect(() => seedFromDate('19 Oct')).toThrow();
  });
});

describe('structure counts', () => {
  it('counts printed-number backsteps, repeats and duplicate records', () => {
    const pg = (n: number, printed?: string, tr = 'x') => ({ page_number: n, ocr: { data: printed ? `<page-num>${printed}</page-num> text` : 'text' }, translation: { data: tr } });
    const s = structureCounts([pg(1, '1'), pg(2, '2'), pg(3, '2'), pg(4, '1'), pg(4, undefined, ''), pg(5, '५')]);
    expect(s.page_records).toBe(6);
    expect(s.duplicate_records).toBe(1);
    expect(s.pages_translated).toBe(5);
    expect(s.with_printed_number).toBe(5);
    expect(s.printed_backsteps).toBe(1);
    expect(s.printed_repeats).toBe(2);
    expect(printedToNum('三')).toBe(3);
    expect(printedToNum('xii')).toBeNull();
  });
});
