/**
 * Split before read (#7605): no OCR or translation lane reads a book that is still an unsplit spread. In the 14 days
 * to 2026-10-28 five writers did (paddle-print, Phase 2's spread prompt, cli-ocr, cli-translate, Yigdzin). The guard
 * is one predicate in scripts/lib/pipeline-hold.mjs; this pins its meaning and that each lane that leaked still asks it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { isUnsplitSpread, unsplitReadRefusal, NOT_UNSPLIT_SPREAD } from '../../scripts/lib/pipeline-hold.mjs';

describe('split before read', () => {
  it('refuses a page of a flagged, unsplit book and nothing else', () => {
    const flagged = { needs_splitting: true };
    expect(isUnsplitSpread(flagged)).toBe(true);
    expect(isUnsplitSpread({ needs_splitting: true, split_completed: true })).toBe(false);
    expect(isUnsplitSpread({ needs_splitting: false })).toBe(false);
    expect(isUnsplitSpread({})).toBe(false);
    expect(unsplitReadRefusal(flagged, { id: 'p' })).toMatch(/split it first/);
    // a page that is already a leaf is read, whatever the book flag says
    expect(unsplitReadRefusal(flagged, { split_from_spread: true })).toBeNull();
    expect(unsplitReadRefusal(flagged, { cropped_photo: 'https://images.sourcelibrary.org/x.jpg' })).toBeNull();
    expect(unsplitReadRefusal({}, { id: 'p' })).toBeNull();
  });

  it('the selector fragment composes with a selector that has its own $or', () => {
    expect(Object.keys(NOT_UNSPLIT_SPREAD)).toEqual(['$nor']);
  });

  it('every lane that wrote onto unsplit spreads asks the predicate', () => {
    const lanes = ['scripts/batch/cli-ocr.mjs', 'scripts/batch/cli-translate.mjs', 'scripts/workers/paddle-print-lane.mjs', 'scripts/workers/pipeline-orchestrator.mjs'];
    const missing = lanes.filter((f) => !/unsplitReadRefusal\(|isUnsplitSpread\(|NOT_UNSPLIT_SPREAD/.test(fs.readFileSync(path.join(__dirname, '../..', f), 'utf8')));
    expect(missing).toEqual([]);
  });
});
