/**
 * Interior page sampling for the free IA text gate (scripts/lib/interior-sample.mjs, #4763/#5014).
 *
 * The gate scores the Archive's reading against ours on a sample and then writes EVERY remaining
 * page of the book on that verdict, so which pages it sees decides what the whole book gets.
 * Measured on #5014: one book scored 0.624 on its front matter and was REJECTED at the 0.80
 * English cutoff while its body agreed at 0.987.
 *
 * Pins four things, each of which would be a real defect:
 *   - the sample actually AVOIDS the front matter (the bug being fixed: every other page selector
 *     here is `sort({page_number:1}).limit(n)`);
 *   - it is SPREAD, not a contiguous block, so a median over it is not one chapter's opinion;
 *   - a short book comes back whole rather than EMPTY, because an empty sample reads to the caller
 *     as "nothing to do" and the book silently leaves both lanes;
 *   - it never returns duplicates, which would let one page vote twice in that median.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { interiorSpread, FRONT_TRIM, BACK_TRIM } from '../../scripts/lib/interior-sample.mjs';

const pages = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

describe('interiorSpread', () => {
  it('skips the front matter — the whole point', () => {
    const got = interiorSpread(pages(300), 8);
    // 15% of 300 = leaf 45. Nothing before it may appear, or we are sampling title pages again.
    expect(Math.min(...got)).toBeGreaterThanOrEqual(300 * FRONT_TRIM);
    expect(got.every((p: number) => p > 25)).toBe(true);
  });

  it('skips the back matter (index, ads, colophon)', () => {
    const got = interiorSpread(pages(300), 8);
    expect(Math.max(...got)).toBeLessThanOrEqual(300 * (1 - BACK_TRIM));
  });

  it('spreads across the body instead of taking a contiguous block', () => {
    const got: number[] = interiorSpread(pages(400), 8);
    expect(got).toHaveLength(8);
    const span = Math.max(...got) - Math.min(...got);
    // A contiguous run of 8 would span ~8. Require it to cover most of the trimmed body (~320).
    expect(span).toBeGreaterThan(200);
    // And no two picks adjacent, which a block would produce.
    const gaps = got.slice(1).map((p, i) => p - got[i]);
    expect(Math.min(...gaps)).toBeGreaterThan(1);
  });

  it('returns a SHORT book whole rather than empty', () => {
    // 6 candidate pages, 8 wanted. Trimming would leave almost nothing; an empty array would read
    // to the caller as "no pages need OCR" and the book would vanish from both lanes.
    expect(interiorSpread(pages(6), 8)).toEqual(pages(6));
    expect(interiorSpread(pages(1), 8)).toEqual([1]);
    // A book whose BODY is shorter than the request still yields its body, never nothing.
    expect(interiorSpread(pages(10), 8).length).toBeGreaterThan(0);
  });

  it('never repeats a page, so none can vote twice in the gate median', () => {
    for (const total of [12, 20, 37, 100, 901]) {
      const got: number[] = interiorSpread(pages(total), 8);
      expect(new Set(got).size).toBe(got.length);
    }
  });

  it('honours gaps in the candidate list (pages already transcribed are absent)', () => {
    // Callers pass only pages still LACKING text, so the numbers are not contiguous. The function
    // must index the candidate array, never assume page N is at position N.
    const sparse = [3, 9, 14, 28, 40, 55, 61, 77, 90, 102, 118, 133, 150, 166, 180, 199];
    const got: number[] = interiorSpread(sparse, 5);
    expect(got.every((p: number) => sparse.includes(p))).toBe(true);
    expect(new Set(got).size).toBe(got.length);
  });

  it('with lead pages, keeps the FRONT as well as the body', () => {
    // Measured regression guard: dropping the front left 49.4% of real title pages blank, because
    // the Archive's text for them fails the ingester's >=20-token candidate filter (#4763).
    const got: number[] = interiorSpread(pages(300), 8, 2);
    expect(got).toContain(1);
    expect(got).toContain(2);
    expect(got).toHaveLength(10);
    // The body picks must STILL avoid the front matter — the lead is an addition, not a shift.
    const body = got.filter((p: number) => p > 2);
    expect(Math.min(...body)).toBeGreaterThanOrEqual(300 * FRONT_TRIM);
  });

  it('lead pages cannot duplicate a body pick', () => {
    for (const total of [14, 25, 60, 500]) {
      const got: number[] = interiorSpread(pages(total), 8, 2);
      expect(new Set(got).size).toBe(got.length);
    }
  });

  it('a short book with lead pages still returns pages, never nothing', () => {
    expect(interiorSpread(pages(5), 8, 2)).toEqual(pages(5));
    expect(interiorSpread(pages(9), 8, 2).length).toBeGreaterThan(0);
  });

  it('degenerate inputs return an empty array rather than throwing', () => {
    expect(interiorSpread([], 8)).toEqual([]);
    expect(interiorSpread(pages(50), 0)).toEqual([]);
    expect(interiorSpread(null as unknown as number[], 8)).toEqual([]);
  });
});
