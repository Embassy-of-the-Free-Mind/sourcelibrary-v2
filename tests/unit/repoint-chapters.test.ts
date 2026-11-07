import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs script module, no types
import { repointChapters, headingInText } from '../../scripts/lib/text-shift.mjs';

/**
 * #5803: after "40-49:+1" moves each slot's text one back, a chapter derived from the shifted
 * text points one page late. It moves only when its heading is on the new slot and not the old.
 */
const text: Record<number, string> = { 44: 'CHAPTER V.—PIPEOLOGY. The pipe', 45: 'smoke rose', 60: 'CHAPTER VI.—SNIFFING' };
const on = (n: number, title: string) => headingInText(title, text[n]);
const idOf = (n: number) => `id${n}`;
const segs = [{ from: 40, to: 49, delta: 1 }];

describe('repointChapters', () => {
  it('moves a chapter whose heading is now one slot earlier, and its predecessor end', () => {
    const { chapters, moved } = repointChapters(
      [{ title: 'Chapter IV—Smoke', pageNumber: 30, pageId: 'id30', endPage: 44 }, { title: 'CHAPTER V.—PIPEOLOGY.', pageNumber: 45, pageId: 'id45', endPage: 59 }],
      segs, on, idOf,
    );
    expect(moved).toEqual([{ title: 'CHAPTER V.—PIPEOLOGY.', from: 45, to: 44 }]);
    expect(chapters[1]).toMatchObject({ pageNumber: 44, pageId: 'id44', endPage: 59 });
    expect(chapters[0].endPage).toBe(43);
  });
  it('leaves a chapter outside the moved range, or whose heading is not on the new slot', () => {
    const { moved } = repointChapters([{ title: 'CHAPTER VI.—SNIFFING', pageNumber: 60 }, { title: 'Chapter VII—Absent', pageNumber: 46 }], segs, on, idOf);
    expect(moved).toEqual([]);
  });
});
