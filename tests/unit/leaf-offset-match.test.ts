/**
 * The off-leaf matcher (scripts/lib/leaf-offset-match.mjs, #5309).
 *
 * Pins that it finds the leaf a text was read from at a non-zero offset, that it ABSTAINS rather
 * than guessing when no leaf matches or two match equally (an abstention is never counted as
 * aligned or as shifted), and that runs group only pages shifted by the same offset.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { bigramCounts, dice, pageOffset, shiftRuns } from '../../scripts/lib/leaf-offset-match.mjs';

// Distinct pseudo-pages: each leaf is its own word sequence over a SHARED vocabulary, so a unigram
// bag would call them similar and only word order (bigrams) tells them apart.
const VOCAB = 'the of and to in that is was he for it with as his on be at by this had not are but from or'.split(' ');
function leafTokens(seed: number, n = 120): string[] {
  let s = seed * 2654435761 >>> 0; const out: string[] = [];
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out.push(VOCAB[s % VOCAB.length]); }
  return out;
}
const LEAVES = Array.from({ length: 30 }, (_, i) => bigramCounts(leafTokens(i + 1)));

describe('dice', () => {
  it('is 1 for identical text and low for two leaves over the same vocabulary', () => {
    expect(dice(LEAVES[3], LEAVES[3])).toBe(1);
    expect(dice(LEAVES[3], LEAVES[4])).toBeLessThan(0.3);
  });
});

describe('pageOffset', () => {
  it('calls a page read from its own leaf aligned', () => {
    expect(pageOffset(bigramCounts(leafTokens(11)), LEAVES, 10)).toMatchObject({ verdict: 'aligned', offset: 0 });
  });
  it('finds the neighbouring leaf a page was read from (−1 and −5, the Strutt and Yucatán cases)', () => {
    expect(pageOffset(bigramCounts(leafTokens(10)), LEAVES, 10)).toMatchObject({ verdict: 'shifted', offset: -1 });
    expect(pageOffset(bigramCounts(leafTokens(6)), LEAVES, 10)).toMatchObject({ verdict: 'shifted', offset: -5 });
  });
  it('still matches through OCR noise (a fifth of the words wrong)', () => {
    const noisy = leafTokens(10).map((w, i) => (i % 5 === 0 ? 'xx' + i : w));
    expect(pageOffset(bigramCounts(noisy), LEAVES, 10)).toMatchObject({ verdict: 'shifted', offset: -1 });
  });
  it('abstains (low) when no leaf matches — junk Archive OCR is never read as a shift', () => {
    expect(pageOffset(bigramCounts(leafTokens(999)), LEAVES, 10).verdict).toBe('low');
  });
  it('abstains (ambiguous) when two leaves match equally', () => {
    const dup = [...LEAVES]; dup[9] = LEAVES[10];
    expect(pageOffset(bigramCounts(leafTokens(11)), dup, 10).verdict).toBe('ambiguous');
  });
  it('reports a match outside the window as far, not shifted', () => {
    expect(pageOffset(bigramCounts(leafTokens(26)), LEAVES, 5)).toMatchObject({ verdict: 'far', offset: 20 });
  });
});

describe('shiftRuns', () => {
  it('groups one offset across abstaining pages and breaks on aligned pages and on a new offset', () => {
    const rows = [
      { page_number: 1, verdict: 'aligned', offset: 0 },
      { page_number: 2, verdict: 'shifted', offset: -1 },
      { page_number: 3, verdict: 'plate' },
      { page_number: 4, verdict: 'shifted', offset: -1 },
      { page_number: 5, verdict: 'shifted', offset: -3 },
      { page_number: 6, verdict: 'aligned', offset: 0 },
      { page_number: 7, verdict: 'shifted', offset: -1 },
    ];
    expect(shiftRuns(rows)).toEqual([
      { from: 2, to: 4, offset: -1, decided: 2, span: 3 },
      { from: 5, to: 5, offset: -3, decided: 1, span: 1 },
      { from: 7, to: 7, offset: -1, decided: 1, span: 1 },
    ]);
  });
});
