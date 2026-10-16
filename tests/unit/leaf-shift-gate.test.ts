/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * Whole-leaf shift at write time (#5021): a block that comes back complete and one leaf ahead
 * (each page's running head right, its body the next leaf's) is dropped whole by
 * dropDriftedPages, so every block lane sends its pages to single-page translation.
 *
 * The fixture is the Śakuntalā shape (pp.291-294, verse numbers ॥171॥… voting for the next leaf).
 * The controls on real pages, run against production, are scripts/audit/leaf-shift-gate-controls-5021.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  dropDriftedPages,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/block-drift.mjs';
import {
  blockLeafShiftRuns,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/leaf-shift.mjs';

const verse = (n: number) => `${n + 100} || Act VII ||\n\nपाठः ॥${n}॥ the king speaks.\n\nVerse ${n}.`;
const english = (n: number, v: number) => `${n + 100} || Act VII ||\n\nThe king speaks.\n\n<note>Verse ${v}</note>`;
const block = (shift: number) => {
  const pages = Array.from({ length: 8 }, (_, i) => ({ page_number: 290 + i, ocr: { data: verse(170 + i) } }));
  // A shift that starts at page 292: from there on, each page's English carries the next verse.
  const tr = new Map(pages.map((p, i) => [p.page_number, english(p.page_number, 170 + i + (i >= 2 ? shift : 0))]));
  return { pages, tr };
};

describe('leaf-shift gate in dropDriftedPages', () => {
  it('drops every page of a block whose English slipped one leaf', () => {
    const { pages, tr } = block(1);
    expect(blockLeafShiftRuns(pages, tr).map((r: any) => [r.dir, r.start, r.end])).toEqual([['next', 292, 296]]);
    const { translations, drifted } = dropDriftedPages(pages, tr);
    expect(drifted.map((d: any) => d.kind)).toEqual(['leaf-shift']);
    expect(translations.size).toBe(0);
  });

  it('passes the same block when each page carries its own leaf', () => {
    const { pages, tr } = block(0);
    expect(blockLeafShiftRuns(pages, tr)).toEqual([]);
    const { translations, drifted } = dropDriftedPages(pages, tr);
    expect(drifted).toEqual([]);
    expect(translations.size).toBe(8);
  });

  it('makes no claim on a block with no printed numbers', () => {
    const pages = Array.from({ length: 8 }, (_, i) => ({ page_number: 10 + i, ocr: { data: 'Sine numero textus.' } }));
    const tr = new Map(pages.map(p => [p.page_number, 'Text without numbers.']));
    expect(dropDriftedPages(pages, tr).translations.size).toBe(8);
  });
});
