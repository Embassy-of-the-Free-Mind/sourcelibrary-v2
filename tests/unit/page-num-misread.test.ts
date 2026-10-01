/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * O11 (#5142): a <page-num> the book's own pagination says is wrong for its scan.
 *
 * The sequences are synthetic but carry the shapes the 2026-09-25 taxonomy read on real books:
 * Perotti's Cornucopiae (`<page-num>XLI` read from show-through of LIX), a photographer's mount
 * number on a plate-less text run, a single digit misread. Negative controls: a clean run, a new
 * part restarting at 1, and a book whose "page numbers" are section numbers are never verdicts.
 */
import { describe, it, expect } from 'vitest';
import {
  pageNumMisreads,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';

const page = (p: number, num: string | null, type = 'text') =>
  ({ p, type, ocr: `${num == null ? '' : `<page-num>${num}</page-num>\n`}Lorem ipsum dolor sit amet page ${p}.` });
const run = (from: number, nums: (string | null)[]) => nums.map((n, i) => page(from + i, n));

describe('O11 · <page-num> off the book\'s pagination line (#5142)', () => {
  it('reads XLI among LVII…LXII as show-through of LIX (the Cornucopiae example)', () => {
    const pages = run(10, ['LIV', 'LV', 'LVI', 'LVII', 'LVIII', 'XLI', 'LX', 'LXI', 'LXII', 'LXIII', 'LXIV', 'LXV']);
    expect(pageNumMisreads(pages)).toEqual([{ p: 15, numbering: 'roman', tag: 'XLI', value: 41, expected: 59, expectedPrinted: 'lix', cause: 'show-through' }]);
  });
  it('reads transposed digits (16 for 61) as show-through', () => {
    const pages = run(60, ['56', '57', '58', '59', '60', '16', '62', '63', '64', '65', '66', '67']);
    expect(pageNumMisreads(pages)).toMatchObject([{ p: 65, tag: '16', expectedPrinted: '61', cause: 'show-through' }]);
  });
  it('reads a mount number far off the line as another counter', () => {
    const pages = run(1, ['101', '102', '103', '1987', '105', '106', '107', '108', '109', '110', '111', '112']);
    expect(pageNumMisreads(pages)).toMatchObject([{ p: 4, tag: '1987', expected: 104, cause: 'other-counter' }]);
  });
  it('reads a near miss as a misread', () => {
    const pages = run(1, ['114', '115', '116', '113', '118', '119', '120', '121', '122', '123', '124', '125']);
    expect(pageNumMisreads(pages)).toMatchObject([{ p: 4, tag: '113', expected: 117, cause: 'misread' }]);
  });
  it('NEGATIVE CONTROL: a clean pagination has no verdicts, untagged pages included', () => {
    expect(pageNumMisreads(run(1, ['1', '2', null, '4', '5', '6', '7', '8']))).toEqual([]);
  });
  it('NEGATIVE CONTROL: a second part restarting at 1 is a restart, not a misread', () => {
    expect(pageNumMisreads(run(1, ['201', '202', '203', '204', '205', '1', '2', '3', '4', '5']))).toEqual([]);
  });
  it('NEGATIVE CONTROL: section numbers that are not a pagination are unjudged', () => {
    expect(pageNumMisreads(run(1, ['10', '10', '10', '11', '11', '12', '12', '12', '13', '13']))).toEqual([]);
  });
});
