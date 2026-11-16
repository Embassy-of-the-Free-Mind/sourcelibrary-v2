import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { segmentGate } from '../../scripts/lib/canvas-label-alignment.mjs';

/**
 * Pins the write gate of scripts/maintenance/repair-text-offset-segments.mjs (v2#5924).
 * A book whose second half is shifted reads `mixed` before the move; the gate must pass it
 * when the simulated move aligns it, and must still refuse a move that does not align the
 * book, a book that was already aligned, and a book the labels cannot score.
 */
const v = (verdict: string, h: Record<string, number>) => ({
  verdict, histogram: h, scored: Object.values(h).reduce((a, b) => a + b, 0),
});

describe('segmentGate', () => {
  it('passes a partly shifted (mixed) book that the move aligns', () => {
    const g = segmentGate(v('mixed', { 0: 346, 2: 190, 3: 126 }), v('aligned', { 0: 648, 2: 6, 4: 5, 1: 1, '-6': 1, '-2': 1 }));
    expect(g.ok).toBe(true);
  });
  it('passes a wholly shifted book that the move aligns', () => {
    expect(segmentGate(v('shifted', { 1: 95, 0: 5 }), v('aligned', { 0: 98, 1: 2 })).ok).toBe(true);
  });
  it('refuses when the move leaves the book below the bar', () => {
    const g = segmentGate(v('mixed', { 0: 50, 2: 50 }), v('mixed', { 0: 90, '-2': 10 }));
    expect(g.ok).toBe(false);
    expect(g.why).toMatch(/after/);
  });
  it('refuses a book that was already aligned', () => {
    expect(segmentGate(v('aligned', { 0: 97, 1: 3 }), v('aligned', { 0: 99, 1: 1 })).ok).toBe(false);
  });
  it('refuses an unscored book (that goes to the by-eye gate)', () => {
    expect(segmentGate({ verdict: 'unscored', scored: 3, histogram: { 0: 3 } }, v('aligned', { 0: 100 })).ok).toBe(false);
  });
});
