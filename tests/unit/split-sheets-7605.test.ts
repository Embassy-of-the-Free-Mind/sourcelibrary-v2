/**
 * #7605: split-spreads-agy.mjs `propose --sheets` — shape against the book's own median decides single frames with
 * no call, an agreeing sample sets the book fold for every other spread, and a sheet verdict covers its frames unless
 * a page row or bad_pages says otherwise.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { sampleIndexes, shapeOf, bookFoldOf, shapeOrBookCut, expandSheetVerdicts, applyRefusal, readVerdicts } from '../../scripts/maintenance/split-spreads-agy.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('sampleIndexes', () => {
  it('samples only spread-shaped frames, evenly, at most n', () => {
    const ars = [0.7, 0.7, ...Array.from({ length: 40 }, () => 1.4), 2.6];
    const s = [...sampleIndexes(ars, 8)];
    expect(s).toHaveLength(8);
    expect(s.every((i) => ars[i] === 1.4)).toBe(true);
    expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(30); // spread through the book, not the first eight
  });
  it('takes every spread-shaped frame when there are fewer than n', () => {
    expect([...sampleIndexes([0.7, 1.3, 1.3], 8)].sort()).toEqual([1, 2]);
  });
});

describe('shape against the book', () => {
  it('judges a frame by the book median, not a fixed ratio', () => {
    expect(shapeOf(1.26, 2.52)).toBe('single'); // the gated test: a 2.5:1 book's one single leaf
    expect(shapeOf(2.5, 2.52)).toBe('spread');
    expect(shapeOf(0.73, 1.47)).toBe('single');
    expect(shapeOf(4.0, 1.47)).toBe('wide');
  });
});

describe('book fold', () => {
  it('is the median when the sample agrees within FOLD_SPREAD, else null', () => {
    expect(bookFoldOf([504, 501, 507, 497, 504])).toBe(504);
    expect(bookFoldOf([504, 398, 507])).toBeNull();
    expect(bookFoldOf([504, 506])).toBeNull(); // too few to trust
  });
  it('a non-sampled frame takes the book fold, stays whole when narrow, and asks agy when wide or unsure', () => {
    expect(shapeOrBookCut(1.47, 1.47, 504)).toMatchObject({ fold: 504 });
    expect(shapeOrBookCut(0.7, 1.47, 504)).toMatchObject({ fold: null });
    expect(shapeOrBookCut(4.0, 1.47, 504)).toBeNull();
    expect(shapeOrBookCut(1.47, 1.47, null)).toBeNull();
  });
});

describe('sheet verdicts', () => {
  const proposal = { book_id: 'b', frames: [{ page_number: 1, sheet: 1 }, { page_number: 2, sheet: 1 }, { page_number: 3, sheet: 2 }] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sv-')), 'v.jsonl');
  fs.writeFileSync(file, [
    { book_id: 'b', sheet: 1, verdict: 'ok', checked_by: 'opus', bad_pages: [2] },
    { book_id: 'b', sheet: 2, verdict: 'ok', checked_by: 'opus' },
    { book_id: 'b', page_number: 3, verdict: 'bad', checked_by: 'opus' },
  ].map((r) => JSON.stringify(r)).join('\n'));
  const v = expandSheetVerdicts(proposal, readVerdicts(file));
  it('covers the sheet, marks bad_pages bad, and a page row wins', () => {
    expect(v.get('b:1').verdict).toBe('ok');
    expect(v.get('b:2').verdict).toBe('bad');
    expect(v.get('b:3').verdict).toBe('bad');
  });
  it('apply still refuses a book with any bad frame', () => {
    const pages = proposal.frames.map((f) => ({ page_number: f.page_number, id: `p${f.page_number}` }));
    const p2 = { ...proposal, unresolved: 0, frames: proposal.frames.map((f) => ({ ...f, page_id: `p${f.page_number}`, url: null })) };
    expect(applyRefusal(p2, v, pages, 'b')).toMatch(/verdict bad/);
  });
});
