/**
 * #7263 route C (PERO draft -> agy Flash-low with the image, unread Latin print): the check-flag measure must be the
 * TEST's T3 (scripts/eval/gpu-flash-vs-opus-7263/triggers.py), the lane must send the TEST's template byte for byte,
 * and the lane-judge sampler must judge flagged pages always without counting them as evidence.
 * Expected change shares below were computed with triggers.py's own `words` / `unmatched` (Python difflib).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { changeShare, words, CHECK_FLAG_SHARE } from '../../scripts/lib/draft-change-share.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { GPU_TEMPLATE, GPU_LANE, GPU_ROUTE, GPU_LANE_HOLDS, byReaders } from '../../scripts/batch/cli-ocr-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { drawBookDepth, flaggedStratum, exportScore, LANES } from '../../scripts/eval/lane-judge-sampler.mjs';

describe('changeShare (T3, #7263)', () => {
  const cases: [string, string, number][] = [
    ['In principio erat verbum, et verbum erat apud Deum.', '<scan-quality>good</scan-quality>\n<language>Latin</language>\n<page-type>text</page-type>\nIn principio erat Verbum, et Verbum erat apud Deum.', 0],
    ['Quod ſi quis dixerit hoc eſſe falſum', 'Quod si quis dixerit <margin>Arist.</margin> hoc esse verum', 0.1428571428571429],
    ['a b c d e f g h', 'e f g h a b c d', 0.5],
    ['a b a b a b x y', 'b a b a y x a', 0.375],
    ['', 'anything', 1],
    ['De re rustica liber primus', '<header>LIBER I.</header>\nDe re ruſtica liber primus\n<page-num>12</page-num>', 0],
    ['ŏmnia vincit amor', 'omnia vincit amor', 0.33333333333333337],
  ];
  it.each(cases)('matches triggers.py on %j', (a, b, want) => { expect(changeShare(a, b)).toBeCloseTo(want, 12); });
  it('folds as triggers.py does: tag lines out, ſ -> s, punctuation off', () => {
    expect(words('<page-type>text</page-type>\nEſt, "Deus".')).toEqual(['est', 'deus']);
  });
  it('flags at the adopted 27%', () => { expect(CHECK_FLAG_SHARE).toBe(0.27); });
});

describe('the GPU-draft lane', () => {
  it('sends the #7263 TEST template, whose hash is its name', () => {
    const t = fs.readFileSync(path.join(__dirname, '../..', GPU_TEMPLATE.file), 'utf8');
    expect(crypto.createHash('sha256').update(t).digest('hex').slice(0, 16)).toBe(GPU_TEMPLATE.hash);
    expect(t).toContain('{draft}');
  });
  it('takes only demand holds (published as scans), never a containment hold', () => {
    expect(GPU_LANE_HOLDS).toContain('scans-only-publish-7176');
    expect(GPU_LANE_HOLDS.some((h: string) => /wrong-leaf|invented|poison|recitation/.test(h))).toBe(false);
  });
  it('queues the most-read books first', () => {
    const b = [{ id: 'a', human_read_count: 0, processing_priority: 9 }, { id: 'b', human_read_count: 3 }, { id: 'c', human_read_count: 3, processing_priority: 1 }];
    expect(b.sort(byReaders).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('is a sampler lane, in the latin-gpu-7263 cell, with no draft to judge', () => {
    const L = LANES.find((l: { lane: string }) => l.lane === GPU_LANE);
    expect(L.enabled).toBe(true);
    expect(L.route).toBe(GPU_ROUTE);
    expect(L.cell('Latin')).toBe('latin-gpu-7263');
    expect(L.cell('German')).toBeNull();
    expect(L.draft_route).toBeNull();
    expect(L.reason.test('#7263 GPU-draft lane: PERO-OCR draft ...')).toBe(true);
  });
});

describe('sampler: book depth and the check-flag stratum', () => {
  const cands = Array.from({ length: 3 }, (_, b) => Array.from({ length: 10 }, (_, p) => ({ page_id: `b${b}-p${p}`, book_id: `b${b}`, cell: 'latin-gpu-7263', route: GPU_ROUTE, weight: 1, check_flag: p === 7 }))).flat();
  const hist = () => ({ pagesJudged: new Set<string>(['b0-p0']), bookPages: new Map([['b1', 5]]), routeBooks: new Map() });
  it('draws N pages a book, ignoring the per-book cap, never a judged page, reproducibly', () => {
    const a = drawBookDepth(cands, hist(), { seed: 7263, perBook: 4 });
    expect(a.drawn).toHaveLength(12);
    for (const b of ['b0', 'b1', 'b2']) expect(a.drawn.filter((d: { book_id: string }) => d.book_id === b)).toHaveLength(4);
    expect(a.drawn.map((d: { page_id: string }) => d.page_id)).not.toContain('b0-p0');
    expect(new Set(a.drawn.map((d: { page_id: string }) => d.page_id)).size).toBe(12);
    expect(drawBookDepth(cands, hist(), { seed: 7263, perBook: 4 }).drawn).toEqual(a.drawn);
  });
  it('adds every flagged page the draw missed, once', () => {
    const { drawn } = drawBookDepth(cands, hist(), { seed: 1, perBook: 2 });
    const f = flaggedStratum(cands, drawn, hist());
    const inDraw = new Set(drawn.map((d: { page_id: string }) => d.page_id));
    expect(f.map((x: { page_id: string }) => x.page_id).sort()).toEqual(['b0-p7', 'b1-p7', 'b2-p7'].filter((id) => !inDraw.has(id)).sort());
    expect(f.every((x: { stratum: string }) => x.stratum === 'flagged')).toBe(true);
  });
  it('reports the flagged stratum apart and never counts it as evidence', () => {
    let n = 0;
    const rec = (book: number, accept: boolean, stratum: string) => ({ _id: `r${n++}`, kind: 'item', page_id: `p${n}`, book_id: `b${book}`, cell: 'latin-gpu-7263', route: GPU_ROUTE, lane: GPU_LANE, lang: 'Latin',
      script_type: 'print', write: { revision_id: `rev${n}` }, judge: { model_reported: 'claude-opus-5-5', prompt_template_sha: 'x' }, run_id: 'r', judged_at: '2026-10-29T00:00:00Z', week: '2026-W44',
      verdict: { accept, fidelity: accept ? 5 : 2, defects: [] }, draw: { stratum } });
    const ctl = (book: number) => ({ ...rec(book, false, 'random'), kind: 'wrong_page' });
    const r = [rec(0, true, 'random'), rec(1, true, 'random'), rec(2, false, 'random'), rec(3, false, 'flagged'), rec(4, false, 'flagged'), ctl(0), ctl(1)];
    const x = exportScore(r).cells['latin-gpu-7263'].routes[GPU_ROUTE];
    expect(x.accept).toBe('2/3');
    expect(x.flagged_stratum.accept).toBe('0/2');
  });
});
