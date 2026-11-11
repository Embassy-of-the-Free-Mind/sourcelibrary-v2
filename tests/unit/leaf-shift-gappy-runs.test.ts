/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * The audit's gappy run rule (#5021, 2026-11-03): votes in one direction with silent pages between
 * them make a run; the write-time gate keeps the strict (adjacent) rule.
 *
 * Fixtures: tests/fixtures/leaf-shift-controls-5021.json, captured from production with
 * scripts/audit/leaf-shift-controls-fixture-5021.mjs (see the experiment 2026-11-03-leaf-shift-library-5021.md):
 * each control's transcription and English as they stood before containment, reduced to the
 * numbers the detector reads (running head in <header>, body numbers on the second line). No text.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  classifyBook,
  blockLeafShiftRuns,
  MAX_GAP,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/leaf-shift.mjs';

const controls = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/leaf-shift-controls-5021.json'), 'utf8'));
const runsOf = (pages: any[], opts?: any) => classifyBook(pages, opts).runs.map((r: any) => [r.dir, r.start, r.end, r.tail ?? null]);

describe('leaf-shift gappy runs: the four by-eye controls', () => {
  it('Karl Grosherzog pp.16-20: next, -, next, -, prev is one run ending on the footnote tail', () => {
    const { pages } = controls.karl;
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([['next', 16, 20, 20]]);
    // The 2026-10-13 rule did not see it: no two adjacent voting pages.
    expect(runsOf(pages)).toEqual([]);
  });

  it('Śakuntalā pp.291-294: the adjacent run is found by both rules', () => {
    const { pages } = controls.sakuntala;
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([['next', 291, 294, null]]);
    expect(runsOf(pages)).toEqual([['next', 291, 294, null]]);
  });

  it('Corpus Medicorum p.83: one voting page (p.82) is not a run — a known miss, not a pass', () => {
    const { pages } = controls['corpus-medicorum'];
    const res = classifyBook(pages, { rule: 'gappy' });
    expect(res.rows.find((r: any) => r.page_number === 82).cls).toBe('next');
    expect(res.rows.find((r: any) => r.page_number === 83).cls).toBe('none');
    expect(res.runs).toEqual([]);
  });

  it('Postel scans 179-184: no printed numbers, no claim — a known miss', () => {
    const { pages } = controls.postel;
    const res = classifyBook(pages, { rule: 'gappy' });
    expect(res.rows.filter((r: any) => r.translated).every((r: any) => r.cls === 'none')).toBe(true);
    expect(res.runs).toEqual([]);
  });
});

describe('leaf-shift gappy runs: rule edges', () => {
  // A page whose English carries `eng` and whose transcription carries `own`.
  const pg = (n: number, own: number | null, eng: number | null) => ({
    page_number: n,
    ocr: `text\n${own ?? ''} word`,
    tr: `text\n${eng ?? ''} word`,
  });
  // Each page n prints the number 100 + 7n, so a vote is unambiguous.
  const v = (n: number) => 100 + 7 * n;

  it('bridges up to MAX_GAP silent pages and no more', () => {
    const near = [pg(1, v(1), v(1)), pg(2, v(2), v(3)), pg(3, v(3), null), pg(4, v(4), null), pg(5, v(5), v(6)), pg(6, v(6), null), pg(7, v(7), v(7))];
    expect(MAX_GAP).toBe(2);
    expect(runsOf(near, { rule: 'gappy' })).toEqual([['next', 2, 5, null]]);
    const far = [pg(1, v(1), v(1)), pg(2, v(2), v(3)), pg(3, v(3), null), pg(4, v(4), null), pg(5, v(5), null), pg(6, v(6), v(7)), pg(7, v(7), null), pg(8, v(8), v(8))];
    expect(runsOf(far, { rule: 'gappy' })).toEqual([]);
  });

  it('an own page between two next pages breaks the run', () => {
    const pages = [pg(1, v(1), v(1)), pg(2, v(2), v(3)), pg(3, v(3), v(3)), pg(4, v(4), v(5)), pg(5, v(5), v(5))];
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([]);
  });

  it('one next page followed by a prev page is not a run (the tail does not count toward MIN_RUN)', () => {
    const pages = [pg(1, v(1), v(1)), pg(2, v(2), v(3)), pg(3, v(3), null), pg(4, v(4), v(3)), pg(5, v(5), v(5))];
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([]);
  });

  it('a prev run takes no next tail', () => {
    const pages = [pg(1, v(1), v(1)), pg(2, v(2), v(1)), pg(3, v(3), v(2)), pg(4, v(4), v(5)), pg(5, v(5), v(5))];
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([['prev', 2, 3, null]]);
  });

  it('widening a strong strict run over a weak voter keeps it strong (tier A is not demoted)', () => {
    // p.2 and p.3 lose their own number and vote the next leaf's (strong); p.5 votes next with no own number (weak).
    const pages = [pg(1, v(1), v(1)), pg(2, v(2), v(3)), pg(3, v(3), v(4)), pg(4, v(4), null), pg(5, null, v(6)), pg(6, v(6), v(6))];
    const res = classifyBook(pages, { rule: 'gappy' });
    expect(res.strictRuns.map((r: any) => [r.start, r.end, r.strong])).toEqual([[2, 3, true]]);
    expect(res.runs.map((r: any) => [r.start, r.end, r.strong])).toEqual([[2, 5, true]]);
  });

  it('absorption: a block page whose English is as long as its own leaf plus the next, corroborated by a next vote', () => {
    const at = '2026-04-01T12:30:07.000Z';
    const later = '2026-04-01T12:40:00.000Z';
    const src = (n: number) => `text\n${v(n)} ${'x'.repeat(600)}`;
    // English runs about 0.9 of the source on every page; page 4's carries leaves 4 and 5; page 5's votes next.
    const en = (chars: number, num: number | null) => `text\n${num ?? ''} ${'y'.repeat(chars)}`;
    const pages = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({
      page_number: n,
      ocr: src(n),
      tr: n === 4 ? en(1100, v(4)) : n === 5 ? en(540, v(6)) : en(540, v(n)),
      updated: n <= 3 ? later : at,
      page_type: 'text',
    }));
    const res = classifyBook(pages, { rule: 'gappy', absorb: true });
    expect(res.absorptions.map((a: any) => [a.p, a.corroborated.map((c: any) => c.p)])).toEqual([[4, [5]]]);
    // Not one block with its successor: the same page does not absorb.
    const split = pages.map(p => (p.page_number === 5 ? { ...p, updated: later } : p));
    expect(classifyBook(split, { rule: 'gappy', absorb: true }).absorptions).toEqual([]);
  });

  it('#8464: leaves with no transcription and no English are skipped, so a one-slot slip across them is a run', () => {
    // Cicero De natura deorum 1546: pp.57-58 and 61-63 had no OCR; pp.56, 59, 60 carried the next OCR'd leaf's English.
    const blank = (n: number) => ({ page_number: n, ocr: '', tr: '' });
    const pages = [pg(55, v(55), v(55)), pg(56, v(56), v(59)), blank(57), blank(58), pg(59, v(59), v(60)), pg(60, v(60), v(64)), blank(61), blank(62), blank(63), pg(64, v(64), v(64))];
    expect(runsOf(pages, { rule: 'gappy' })).toEqual([['next', 56, 60, null]]);
    expect(runsOf(pages)).toEqual([['next', 56, 60, null]]);
    // An OCR'd leaf that is merely untranslated is still a neighbour: it splits the run at p.58.
    const held = pages.map(p => (p.page_number === 58 ? { page_number: 58, ocr: `text\n${v(58)} word`, tr: '' } : p));
    expect(runsOf(held, { rule: 'gappy' })).toEqual([['next', 59, 60, null]]);
  });

  it('the write-time gate keeps the strict rule: the Karl shape passes blockLeafShiftRuns', () => {
    const pages = controls.karl.pages.map((p: any) => ({ page_number: p.page_number, ocr: { data: p.ocr } }));
    const tr = new Map(controls.karl.pages.map((p: any) => [p.page_number, p.tr]));
    expect(blockLeafShiftRuns(pages, tr)).toEqual([]);
  });
});
