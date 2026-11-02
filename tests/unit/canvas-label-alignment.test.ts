/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * Text vs IIIF canvas labels (scripts/lib/canvas-label-alignment.mjs) and the segmented text move
 * (scripts/lib/text-shift.mjs computeSegmentMoves), #7949. The shape is Huser's Paracelsus 1589:
 * e-rara's PDF had a cover sheet in front and one leaf photographed twice, so the stored text is
 * one leaf late up to that leaf and three late after it. A uniform shift keeps the printed-number
 * SEQUENCE intact, so the test that matters is against an external numbering.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore -- plain .mjs
import { printedNumber, labelNumber, slotOffsets, bookVerdict, offsetRuns } from '../../scripts/lib/canvas-label-alignment.mjs';
// @ts-ignore -- plain .mjs
import { computeSegmentMoves, parseSegments } from '../../scripts/lib/text-shift.mjs';

const ocr = (n: number | null, body = 'text') => ({ data: `<page-type>text</page-type>\n${n == null ? '' : `<page-num>${n}</page-num>\n`}${body}` });

describe('printedNumber / labelNumber', () => {
  it('reads a plain printed number and refuses anything else', () => {
    expect(printedNumber(ocr(132).data)).toBe(132);
    expect(printedNumber('<page-num>892, 893</page-num>')).toBeNull();
    expect(printedNumber('<page-num>none</page-num>')).toBeNull();
    expect(printedNumber(undefined)).toBeNull();
  });
  it('reads printed-number label forms; a bracketed label is a canvas ordinal, not a printed number', () => {
    expect(labelNumber('136')).toBe(136);
    expect(labelNumber('[78]')).toBeNull();
    expect(labelNumber('S. 12')).toBe(12);
    expect(labelNumber({ '@value': '7' })).toBe(7);
    expect(labelNumber('IV')).toBeNull();
  });
});

describe('slotOffsets / bookVerdict', () => {
  // 40 leaves numbered 1..40; text three leaves late (slot s carries the text of slot s-3).
  const labels = Array.from({ length: 40 }, (_, i) => i + 1);
  const shifted = labels.map((_, i) => ({ page_number: i + 1, ocr: ocr(i + 1 - 3 >= 1 ? i + 1 - 3 : null) }));
  const aligned = labels.map((_, i) => ({ page_number: i + 1, ocr: ocr(i + 1) }));

  it('a uniform shift reads as one non-zero offset, not as nothing', () => {
    const v = bookVerdict(slotOffsets(shifted, labels));
    expect(v.verdict).toBe('shifted');
    expect(v.offset).toBe(-3);
  });
  it('an aligned book reads aligned', () => {
    expect(bookVerdict(slotOffsets(aligned, labels)).verdict).toBe('aligned');
  });
  it('too few numbered pages abstains rather than guessing', () => {
    const sparse = aligned.map((p, i) => (i < 5 ? p : { ...p, ocr: ocr(null) }));
    expect(bookVerdict(slotOffsets(sparse, labels)).verdict).toBe('unscored');
  });
  it('a repeated label in the window (a part restarting at 1) scores nothing for that page', () => {
    const lab = [1, 2, 3, 1, 2, 3];
    const rows = slotOffsets([{ page_number: 1, ocr: ocr(2) }], lab, { window: 8 });
    expect(rows[0].offset).toBeNull();
  });
  it('offsetRuns splits a book whose offset changes', () => {
    const mixed = labels.map((_, i) => {
      const s = i + 1;
      const k = s <= 20 ? 1 : 3;
      return { page_number: s, ocr: ocr(s - k >= 1 ? s - k : null) };
    });
    const runs = offsetRuns(slotOffsets(mixed, labels));
    expect(runs.map((r: any) => r.offset)).toEqual([-1, -3]);
  });
});

describe('computeSegmentMoves', () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ page_number: i + 1, ocr: { data: `leaf ${i + 1}` }, translation: { data: `en ${i + 1}` } }));

  it('moves each target from slot t+delta, reading sources from the pre-move state', () => {
    const moves = computeSegmentMoves(pages, parseSegments('1-3:+1,4-10:+3'));
    const by = new Map(moves.map((m: any) => [m.page_number, m]));
    expect((by.get(1) as any).set.ocr.data).toBe('leaf 2');
    expect((by.get(3) as any).set.ocr.data).toBe('leaf 4');
    expect((by.get(4) as any).set.ocr.data).toBe('leaf 7');
    expect((by.get(7) as any).set.translation.data).toBe('en 10');
  });
  it('clears the targets whose leaf was never read', () => {
    const moves = computeSegmentMoves(pages, parseSegments('1-3:+1,4-10:+3'));
    expect(moves.filter((m: any) => m.cleared).map((m: any) => m.page_number)).toEqual([8, 9, 10]);
    expect((moves.find((m: any) => m.page_number === 9) as any).unset).toContain('ocr');
  });
  it('refuses overlapping or malformed segments', () => {
    expect(() => computeSegmentMoves(pages, parseSegments('1-5:+1,5-10:+3'))).toThrow(/overlap/);
    expect(() => parseSegments('1-5:x')).toThrow();
  });
});
