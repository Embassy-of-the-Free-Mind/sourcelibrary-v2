import { describe, it, expect } from 'vitest';
import { applyPeriodEditionBoost, PERIOD_EDITION_BOOST, PERIOD_EDITION_YEAR } from '@/lib/search/librarian-search';

// The Librarian's retrieval hands the model a 1928 handbook as readily as the
// 1591 imprint it paraphrases (#4704: 35% of citations on 1850–1949
// compendia). This nudge is a multiplier on the fused score, applied to the
// head of the list only, and it must stay a nudge: a clearly better modern hit
// keeps first place, and an undated book is left alone.
const hit = (book_id: string, score: number) => ({ book_id, page_number: 1, text: '', score, source: 'kw' });

describe('applyPeriodEditionBoost', () => {
  const years: Record<string, number | null> = { hall1928: 1928, khunrath1595: 1595, undated: null, waite1893: 1893 };
  const yearOf = (id: string) => years[id] ?? null;

  it('lifts a period edition above a slightly better-scored compendium', () => {
    const out = applyPeriodEditionBoost([hit('hall1928', 0.050), hit('khunrath1595', 0.045)], 8, yearOf);
    expect(out.map(h => h.book_id)).toEqual(['khunrath1595', 'hall1928']);
    expect(out[0].score).toBeCloseTo(0.045 * PERIOD_EDITION_BOOST, 6);
  });

  it('is a nudge, not a filter: a clearly better compendium stays first', () => {
    const out = applyPeriodEditionBoost([hit('hall1928', 0.080), hit('khunrath1595', 0.045)], 8, yearOf);
    expect(out.map(h => h.book_id)).toEqual(['hall1928', 'khunrath1595']);
  });

  it('leaves undated books and the tail beyond the head untouched', () => {
    const list = [hit('waite1893', 0.05), hit('undated', 0.04), hit('khunrath1595', 0.03), hit('khunrath1595', 0.02)];
    const out = applyPeriodEditionBoost(list, 3, yearOf);
    expect(out[1].book_id).toBe('undated');
    expect(out[1].score).toBe(0.04);
    // Fourth hit is beyond head=3: same object, same score, same position.
    expect(out[3]).toBe(list[3]);
  });

  it('treats the boundary year as period', () => {
    const out = applyPeriodEditionBoost([hit('a', 0.05), hit('b', 0.045)], 8, id => (id === 'b' ? PERIOD_EDITION_YEAR : PERIOD_EDITION_YEAR + 1));
    expect(out[0].book_id).toBe('b');
  });
});
