/**
 * #7605: split-spreads-agy.mjs `propose --sheets` — shape decides portrait frames with no call, a sample of
 * spread-shaped frames sets the book fold, the pixel cut is taken only when it sits on that fold, and a sheet verdict
 * covers its frames unless a page row or bad_pages says otherwise.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { sampleIndexes, shapeOrPixelCut, expandSheetVerdicts, applyRefusal, readVerdicts } from '../../scripts/maintenance/split-spreads-agy.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('sampleIndexes', () => {
  it('samples only spread-shaped frames, evenly, at most n', () => {
    const ars = [0.7, 0.7, ...Array.from({ length: 40 }, () => 1.4), 2.6];
    const s = [...sampleIndexes(ars, 8)];
    expect(s).toHaveLength(8);
    expect(s.every((i) => ars[i] >= 0.9 && ars[i] <= 2.2)).toBe(true);
    expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(30); // spread through the book, not the first eight
  });
  it('takes every spread-shaped frame when there are fewer than n', () => {
    expect([...sampleIndexes([0.7, 1.3, 1.3], 8)].sort()).toEqual([1, 2]);
  });
});

describe('shapeOrPixelCut', () => {
  it('a portrait frame stays whole with no call', () => {
    expect(shapeOrPixelCut(0.7, null, 500)).toMatchObject({ fold: null });
  });
  it('a confident pixel cut on the book fold is taken', () => {
    expect(shapeOrPixelCut(1.4, { pos: 510, conf: 'high' }, 500)).toMatchObject({ fold: 510 });
  });
  it('asks agy when the pixel cut is off the book fold, unsure, the frame is wide, or there is no book fold', () => {
    expect(shapeOrPixelCut(1.4, { pos: 398, conf: 'high' }, 500)).toBeNull(); // the #7454 Hidayah case
    expect(shapeOrPixelCut(1.4, { pos: 500, conf: 'low' }, 500)).toBeNull();
    expect(shapeOrPixelCut(2.5, { pos: 500, conf: 'high' }, 500)).toBeNull();
    expect(shapeOrPixelCut(1.4, { pos: 500, conf: 'high' }, null)).toBeNull();
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
