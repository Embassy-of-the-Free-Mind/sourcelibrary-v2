import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs
import { checkpoints, expectedAt, findRuns, frameMarker, judgeRun, labelFor, moreCheckpoints, parsePrintedToken, rowsForRun, toHebrewNumeral } from '../scripts/lib/printed-number-runs.mjs';

const mark = (value: number) => ({ value, numbering: 'arabic' });
/** Frames 0..n-1 carrying what `f` says (null = no marker read). */
const frames = (n: number, f: (i: number) => number | null) =>
  Array.from({ length: n }, (_, i) => { const v = f(i); return { i, marker: v === null ? null : mark(v) }; });
const reads = (run: { first: number; last: number }, f: (i: number) => string | null) => {
  const mid = Math.floor((run.first + run.last) / 2);
  return [run.first, mid, run.last].map((i, x) => ({ i, role: x === 1 ? 'middle' : 'end', printed: f(i) }));
};
const pages = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` }));
const meta = { book_id: 'b', run_id: 'r', method: 'm', confirmed_at: new Date(0) };

describe('printed-number runs (#8041)', () => {
  it('a confirmed run gives every frame in it a number, keyed by page id', () => {
    const fr = frames(40, i => (i >= 5 && i < 30 ? i + 60 : null));
    const [run] = findRuns(fr);
    expect([run.first, run.last, run.dir]).toEqual([5, 29, 1]);
    const v = judgeRun(run, reads(run, i => String(i + 60)));
    expect(v.confirmed).toBe(true);
    const rows = rowsForRun(run, v, pages, meta);
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ page_id: 'p5', label: '65', value: 65, source: 'read', run_id: 'r', method: 'm' });
  });

  it('a book stored back to front is a straight line too (Kitab Manafi: frame 5 = 67)', () => {
    const fr = frames(72, i => (i >= 3 && i <= 67 ? 71 - i : null));
    const [run] = findRuns(fr);
    expect(run.dir).toBe(-1);
    expect(expectedAt(run, 4)).toEqual({ value: 67 });
  });

  it('a jump ends the run: no frame past it inherits the old line', () => {
    // Printed numbers step 1 per frame, then a plate shifts the line by three.
    const fr = frames(50, i => (i < 20 ? i + 1 : i + 4));
    const runs = findRuns(fr);
    expect(runs.map((r: { first: number; last: number }) => [r.first, r.last])).toEqual([[0, 19], [20, 49]]);
    expect(expectedAt(runs[1], 20)).toEqual({ value: 24 });
  });

  it('a long stretch with no agreeing marker is a gap and ends the run', () => {
    const fr = frames(60, i => (i < 15 || i >= 35 ? i + 1 : null));
    const runs = findRuns(fr);
    expect(runs.map((r: { first: number; last: number }) => [r.first, r.last])).toEqual([[0, 14], [35, 59]]);
  });

  it('isolated misreads do not break a run, and are not trusted', () => {
    const fr = frames(30, i => (i === 10 ? 910 : i === 17 ? 3 : i + 100));
    const runs = findRuns(fr);
    expect(runs).toHaveLength(1);
    expect(runs[0].anchors).not.toContain(10);
    expect(expectedAt(runs[0], 10)).toEqual({ value: 110 });
  });

  it('a book with too few agreeing markers proposes nothing, so nothing changes', () => {
    expect(findRuns(frames(40, () => null))).toEqual([]);
    expect(findRuns(frames(40, i => (i % 9 === 0 ? 300 - i * 7 : null)))).toEqual([]);
  });

  it('a number the line does not hold rejects the whole run, wherever it is', () => {
    const fr = frames(30, i => i + 1);
    const [run] = findRuns(fr);
    expect(judgeRun(run, reads(run, i => (i === 14 ? '99' : String(i + 1)))).confirmed).toBe(false);
    expect(judgeRun(run, [...reads(run, i => String(i + 1)), { i: 7, role: 'between', printed: '6' }]).confirmed).toBe(false);
  });

  it('an end that shows no number moves inward; it is never counted as a match', () => {
    const fr = frames(30, i => i + 1);
    const [run] = findRuns(fr);
    const v = judgeRun(run, [
      { i: 0, role: 'end', printed: null }, { i: 1, role: 'end', printed: '2' }, { i: 15, role: 'middle', printed: '16' }, { i: 29, role: 'end', printed: '30' },
    ]);
    expect(v).toMatchObject({ confirmed: true, first: 1, last: 29 });
    expect(rowsForRun(run, v, pages, meta)[0].page_id).toBe('p1');
    expect(judgeRun(run, reads(run, () => null)).confirmed).toBe(false);
  });

  it('anchors on one side of the opening fill nothing until a frame between them is seen (Maqrizi)', () => {
    const fr = frames(30, i => (i % 2 === 0 ? i + 1 : null));
    const [run] = findRuns(fr);
    const ends = reads({ first: run.first, last: run.last }, i => String(i + 1)).filter(r => run.anchors.includes(r.i));
    const three = [...ends, { i: 14, role: 'middle', printed: '15' }];
    const blind = judgeRun(run, three);
    expect(blind).toMatchObject({ confirmed: true, interpolate: false });
    expect(rowsForRun(run, blind, pages, meta).every((r: { source: string }) => r.source === 'read')).toBe(true);
    const seen = judgeRun(run, [...three, { i: 7, role: 'between', printed: '8' }]);
    expect(seen.interpolate).toBe(true);
    expect(rowsForRun(run, seen, pages, meta).filter((r: { source: string }) => r.source === 'interpolated')).toHaveLength(14);
    // The pair-swapped frame shows 352 where the line says 354: rejected, not averaged.
    expect(judgeRun(run, [...three, { i: 7, role: 'between', printed: '6' }]).confirmed).toBe(false);
  });

  it('opens both ends, the middle and one frame between anchors, then the other side of the opening', () => {
    const fr = frames(40, i => (i % 2 === 0 ? i + 1 : null));
    const [run] = findRuns(fr);
    const pts = checkpoints(run, fr);
    expect(pts.map((p: { role: string }) => p.role)).toEqual(['end', 'middle', 'end', 'between']);
    const more = moreCheckpoints(run, fr, pts.map((p: { i: number; role: string }) => ({ ...p, printed: String(p.i + 1) })));
    expect(more.every((p: { i: number; role: string }) => p.role === 'between' && p.i % 2 === 1)).toBe(true);
  });

  it('never reads <page-num>: the tag was invented on the books this concerns', () => {
    expect(frameMarker('<page-type>text</page-type>\n<page-num>67</page-num>\n\nBody of the page.', 'and it ends here.')).toBeNull();
    expect(frameMarker('<page-num>12</page-num>\n<header>BABEL. 51</header>\n\nBody', '')).toMatchObject({ value: 51, numbering: 'arabic' });
  });

  it('reads every numeral system as printed, and writes it back the same way', () => {
    const cases: Array<[string, number, string]> = [
      ['٦٧', 67, 'arabic-indic'], ['۱۲۳', 123, 'persian'], ['67', 67, 'arabic'], ['xii', 12, 'roman'], ['XII', 12, 'roman'],
      ['צט', 99, 'hebrew'], ['קטו', 115, 'hebrew'], ['二七三', 273, 'chinese'], ['二百七十三', 273, 'chinese'],
    ];
    for (const [tok, value, numbering] of cases) {
      const p = parsePrintedToken(tok);
      expect(p).toMatchObject({ value, numbering });
      expect(labelFor(value, numbering, p)).toBe(tok);
    }
    expect(toHebrewNumeral(16)).toBe('טז');
    expect(parsePrintedToken('C 2')).toBeNull();
    expect(parsePrintedToken('12 + 13')).toBeNull();
  });

  it('a folio keeps its printed side and steps through both', () => {
    expect(parsePrintedToken('fol. 12v')).toMatchObject({ value: 12, numbering: 'folio', side: 'v' });
    const fr = Array.from({ length: 12 }, (_, i) => ({ i, marker: { value: 10 + (i >> 1), numbering: 'folio', side: i % 2 ? 'v' : 'r' } }));
    const [run] = findRuns(fr);
    const v = judgeRun(run, [{ i: 0, role: 'end', printed: '10r' }, { i: 5, role: 'middle', printed: '12v' }, { i: 11, role: 'end', printed: '15v' }]);
    expect(v.confirmed).toBe(true);
    expect(rowsForRun(run, v, pages, meta).slice(0, 3).map((r: { label: string }) => r.label)).toEqual(['10r', '10v', '11r']);
    expect(judgeRun(run, [{ i: 0, role: 'end', printed: '10v' }, { i: 5, role: 'middle', printed: '12v' }, { i: 11, role: 'end', printed: '15v' }]).confirmed).toBe(false);
  });
});
