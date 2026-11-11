/**
 * The seam pass (#8399, scripts/lib/seam-pass.mjs): which turns it passes and the guards that refuse a repair.
 *  - callBoundaries: only consecutive turns between two different calls (the page before a run has no call).
 *  - outsideUnchanged: an edit may change only its span, at the page's edge.
 *  - placeSeamRepair: growth bound, locked page before the run, no text put in both pages.
 *  - runSeamPass: a repaired turn carries into the next; the locked alternative is recorded on the turn into the run.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { callBoundaries, outsideUnchanged, placeSeamRepair, runSeamPass, withinGrowth } from '../../scripts/lib/seam-pass.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { edgeRefusal, mapOntoRaw } from '../../scripts/maintenance/seam-repair-6742/seam-repair.mjs';

const P = (n: number, call: string | null, text = `Page ${n} begins here. It ends with words.`, extra = {}) =>
  ({ id: `p${n}`, page_number: n, call_id: call, text, ocr: `Pagina ${n} incipit hic. Finit verbis.`, doc: { id: `p${n}`, book_id: 'b', page_number: n }, ...extra });
const deps = { edgeRefusal, mapOntoRaw };

describe('callBoundaries', () => {
  it('passes the turn into the run and each turn between calls, not turns inside a call', () => {
    const pages = [P(9, null, undefined, { inRun: false }), P(10, 'c1'), P(11, 'c1'), P(12, 'c1'), P(13, 'c1'), P(14, 'c2'), P(15, 'c2')];
    expect(callBoundaries(pages)).toEqual([0, 4]);
  });
  it('skips a gap in page numbers and a page with no text', () => {
    expect(callBoundaries([P(1, 'a'), P(3, 'b')])).toEqual([]);
    expect(callBoundaries([P(1, 'a'), P(2, 'b', '')])).toEqual([]);
  });
});

describe('outsideUnchanged', () => {
  const before = 'First sentence stays. The last sentence is wrong.';
  it('accepts a change inside the tail span', () => {
    expect(outsideUnchanged(before, 'First sentence stays. The last sentence is right.', 'tail', 'The last sentence is wrong.')).toBeNull();
  });
  it('refuses a change outside the span', () => {
    expect(outsideUnchanged(before, 'First sentence moved. The last sentence is right.', 'tail', 'The last sentence is wrong.')).toMatch(/outside-span|wider/);
  });
  it('refuses a span that is not at the edge', () => {
    const b = 'The span is here. And more prose after it.';
    expect(outsideUnchanged(b, 'The span is there. And more prose after it.', 'tail', 'The span is here.')).toMatch(/not-at-edge/);
  });
  it('accepts a head edit at the start', () => {
    expect(outsideUnchanged('continued words. Then the rest.', 'Continued words. Then the rest.', 'head', 'continued words.')).toBeNull();
  });
});

describe('placeSeamRepair', () => {
  const L = 'Alpha beta gamma. He said that the king', R = 'the king came to the city. Then more.';
  const it_ = { id: 'j', srcTailA: 'x', srcHeadB: 'y', enTailA: L, enHeadB: R };
  it('applies a minimal head repair (a duplicated phrase removed)', async () => {
    const rep = { tail_old: '', tail_new: '', head_old: 'the king came to the city.', head_new: 'came to the city.' };
    const out = await placeSeamRepair(it_, rep, L, R, deps);
    expect(out.refused).toBeNull();
    expect(out.R).toBe('came to the city. Then more.');
    expect(out.L).toBe(L);
  });
  it('refuses a span that grows past the bound', async () => {
    const rep = { tail_old: '', tail_new: '', head_old: 'the king came to the city.', head_new: 'the king, with all his court and many soldiers and horses, came at last to the great city.' };
    expect(withinGrowth(rep.head_old, rep.head_new)).toBe(false);
    expect((await placeSeamRepair(it_, rep, L, R, deps)).refused).toBe('head-span-grows-too-much');
  });
  it('refuses a tail edit when the page before is locked, and keeps a head-only one', async () => {
    const tailRep = { tail_old: 'He said that the king', tail_new: 'He said that', head_old: '', head_new: '' };
    expect((await placeSeamRepair(it_, tailRep, L, R, { ...deps, editLeft: false })).refused).toBe('before-page-locked');
    const headRep = { tail_old: '', tail_new: '', head_old: 'the king came to the city.', head_new: 'came to the city.' };
    expect((await placeSeamRepair(it_, headRep, L, R, { ...deps, editLeft: false })).refused).toBeNull();
  });
  it('refuses a repair that puts the same text in both pages', async () => {
    const long = 'and so the whole long passage of the chronicle went on and on without end';
    const L2 = `Some words. ${long}`, R2 = 'New words here. Then more.';
    const rep = { tail_old: '', tail_new: '', head_old: 'New words here.', head_new: `${long}. New words here.` };
    const it2 = { id: 'j2', srcTailA: 'x', srcHeadB: 'y', enTailA: L2, enHeadB: R2 };
    const out = await placeSeamRepair(it2, rep, L2, R2, deps);
    expect(out.refused).toMatch(/both-pages|grows/);
  });
});

describe('runSeamPass', () => {
  it('records the locked alternative on the turn into the run and carries edits forward', async () => {
    const before = P(9, null, 'Earlier text stays. He said that the king', { inRun: false });
    const first = P(10, 'c1', 'the king came to the city. Then more.');
    const call = async () => ({ got: { label: 'duplication', labels: ['duplication'], severity: 'major', repair: { tail_old: 'He said that the king', tail_new: 'He said that', head_old: '', head_new: '' } } });
    const res = await runSeamPass([before, first], { call, editBefore: true, ...deps });
    expect(res.joins).toHaveLength(1);
    expect(res.joins[0].changed).toBe(true);
    expect(res.joins[0].locked.refused).toBe('before-page-locked');
    expect(res.texts.get('p9')).toBe('Earlier text stays. He said that');
    const locked = await runSeamPass([before, first], { call, editBefore: false, ...deps });
    expect(locked.joins[0].changed).toBe(false);
    expect(locked.texts.get('p9')).toBe(before.text);
  });
  it('stops on an agy quota reply', async () => {
    const res = await runSeamPass([P(9, null, undefined, { inRun: false }), P(10, 'c1')], { call: async () => ({ cls: 'quota' }), ...deps });
    expect(res.stopped).toBe('quota');
  });
});

describe('the lane flag (router row seam_pass)', () => {
  it('a seam_pass row adds --seam-pass=1 (and --seam-edit-before=1 for edit-before); a row without it adds nothing', async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain-JS module
    const { readerArgs } = await import('../../scripts/batch/cli-translate-lane.mjs');
    const lane = (row: Record<string, unknown>) => ({ engine: 'gemini-3.8-flash+agy-cli', model: 'gemini-3.8-flash-low', reader: 'scripts/batch/cli-translate.mjs', row: { id: 'x', per_call: 4, ...row } });
    expect(readerArgs(lane({}), { ids: 'i', dir: 'd', job: 'j' })).not.toContain('--seam-pass=1');
    expect(readerArgs(lane({ seam_pass: true }), { ids: 'i', dir: 'd', job: 'j' })).toContain('--seam-pass=1');
    const e = readerArgs(lane({ seam_pass: 'edit-before' }), { ids: 'i', dir: 'd', job: 'j' });
    expect(e).toEqual(expect.arrayContaining(['--seam-pass=1', '--seam-edit-before=1']));
  });
});
