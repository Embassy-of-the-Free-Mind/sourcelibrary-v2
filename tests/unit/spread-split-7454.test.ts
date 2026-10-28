/**
 * #7454: the leaves split-book.mjs writes (split_from_spread) are read by the CLI OCR lane; the cut that
 * scripts/maintenance/split-spreads-agy.mjs proposes follows its stated rule; and split-book.mjs with reviewed
 * positions neither parks nor clobbers a hold. (cli-ocr.mjs read's own refusal is #7605's unsplitReadRefusal.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { spreadReason } from '../../scripts/batch/cli-ocr-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { parseGeometry, decideCut, leafBoxes, applyRefusal, frameUrl } from '../../scripts/maintenance/split-spreads-agy.mjs';

describe('the lane reads the leaves split-book.mjs writes', () => {
  it('a split_from_spread leaf with no crop data is not a suspected spread', () => {
    expect(spreadReason({}, [{ split_from_spread: true }, { split_from_spread: true }])).toBeNull();
    expect(spreadReason({ needs_splitting: true }, [{ split_from_spread: true }])).toMatch(/needs_splitting/);
  });
});

describe('split-spreads-agy cut rule', () => {
  it('parses the geometry answer and rejects nonsense', () => {
    expect(parseGeometry('{"leaves": 2, "fold": 512.4, "first": "right", "note": "x"}')).toMatchObject({ leaves: 2, fold: 512, first: 'right' });
    expect(parseGeometry('{"leaves": 1, "fold": null}')).toMatchObject({ leaves: 1, fold: null });
    expect(parseGeometry('{"leaves": 3}').problem).toBeTruthy();
    expect(parseGeometry('{"leaves": 2, "fold": 1200}').problem).toBeTruthy();
    expect(parseGeometry('no json').problem).toBeTruthy();
  });
  it('pixel when it agrees with agy, agy when they disagree, whole when agy sees one leaf', () => {
    expect(decideCut({ pos: 498, conf: 'high' }, { leaves: 2, fold: 510, first: 'right' }).fold).toBe(498);
    // The #7454 census case: a "confident" pixel cut at 398 with the fold at ~504.
    const d = decideCut({ pos: 398, conf: 'high' }, { leaves: 2, fold: 504, first: 'right' });
    expect(d.fold).toBe(504);
    expect(d.flags.join()).toMatch(/disagree/);
    expect(decideCut({ pos: 520, conf: 'high' }, { leaves: 1, fold: null }).fold).toBeNull();
  });
  it('leaves a frame unresolved when neither method answers, or the fold is outside 20–80%', () => {
    expect(decideCut({ pos: null, conf: 'low' }, { problem: 'x' }).fold).toBeUndefined();
    expect(decideCut({ pos: null, conf: 'low' }, { leaves: 2, fold: 150, first: 'right' }).fold).toBeUndefined();
    expect(decideCut({ pos: 480, conf: 'high' }, null).fold).toBe(480);
  });
  it('flags agy reading the left leaf first in a right-to-left book', () => {
    expect(decideCut({ pos: null, conf: 'low' }, { leaves: 2, fold: 500, first: 'left' }).flags.join()).toMatch(/left leaf first/);
  });
  it('crops as split-book.mjs does: 3% overlap, right leaf first for rtl', () => {
    expect(leafBoxes(500, 1000, 'rtl')).toEqual([{ side: 'right', left: 470, width: 530 }, { side: 'left', left: 0, width: 530 }]);
    expect(leafBoxes(500, 1000, 'ltr')[0].side).toBe('left');
  });
});

describe('split-spreads-agy apply gate', () => {
  const url = 'https://images.sourcelibrary.org/archived/B/1.jpg';
  const proposal = { unresolved: 0, frames: [{ page_id: 'p1', page_number: 1, url, fold: 500 }] };
  const pages = [{ id: 'p1', page_number: 1, archived_photo: url }];
  const ok = new Map([['B:1', { verdict: 'ok', checked_by: 'opus' }]]);
  it('applies only with an ok verdict for every frame, on an unchanged book', () => {
    expect(applyRefusal(proposal, ok, pages, 'B')).toBeNull();
    expect(applyRefusal(proposal, new Map(), pages, 'B')).toMatch(/no verdict/);
    expect(applyRefusal(proposal, new Map([['B:1', { verdict: 'bad', checked_by: 'opus' }]]), pages, 'B')).toMatch(/bad/);
    expect(applyRefusal(proposal, new Map([['B:1', { verdict: 'ok' }]]), pages, 'B')).toMatch(/checked_by/);
    expect(applyRefusal(proposal, ok, [...pages, { id: 'p2', page_number: 2 }], 'B')).toMatch(/live pages/);
    expect(applyRefusal(proposal, ok, [{ ...pages[0], archived_photo: 'https://images.sourcelibrary.org/archived/B/9.jpg' }], 'B')).toMatch(/changed/);
    expect(applyRefusal({ ...proposal, unresolved: 1 }, ok, pages, 'B')).toMatch(/unresolved/);
  });
  it('takes the frame image only from a URL that carries the book id (#3362)', () => {
    expect(frameUrl({ archived_photo: 'https://images.sourcelibrary.org/archived/undefined/1.jpg', photo: 'https://x/B/1.jpg' }, 'B')).toBe('https://x/B/1.jpg');
    expect(frameUrl({ archived_photo: 'https://x/other/1.jpg' }, 'B')).toBeNull();
  });
});

describe('split-book.mjs with reviewed positions (#7454)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/split-book.mjs'), 'utf8');
  it('does not park a book whose every frame was placed by a person', () => {
    // Two books with one spread among single leaves parked as "too little signal" and lost their hold status.
    expect(src).toMatch(/let parkReason = REVIEWED_POSITIONS \? null :/);
  });
  it('a park never writes needs_attention over a held book', () => {
    const park = src.slice(src.indexOf('PARK: ${parkReason}'));
    expect(park.slice(0, 400)).toMatch(/updateOne\(\{ id: book\.id, \.\.\.NOT_HELD \}/);
  });
});
