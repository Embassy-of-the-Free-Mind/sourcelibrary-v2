/**
 * #7263 step 3: the backfill's router hint survives testRow, and rules.json is read back by the FULL score path (every
 * route-judge folder's file is score.json, so a basename key maps one test's pages to another test's cells).
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { testRow, ROUTE_JUDGE } from '../../scripts/eval/lib/judge-rows.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { routerIndex, dedupeAcross } from '../../scripts/eval/backfill-test-verdicts.mjs';

const rules = {
  inputs: { pilot: 'rj/pilot/score.json' },
  cells: [{ id: 'chinese-flash3', pilot: 'chinese', routes: [{ id: '3flash', pilot: 'paddle' }, { id: '3flash>opus', evidence: [{ score: 'rj/a/score.json', cell: 'zh', route: 'o' }] }] }],
};
const row = (o: Record<string, unknown>) => testRow({ book_id: 'b1', page_id: 'p1', selection: 'random', kind: 'item', cell: 't-cell', route: 't-route',
  test: { id: 'T', evidence: 'ev/T.score.json' }, judge: { instrument: ROUTE_JUDGE }, verdict: { accept: true, defects: [], reader_note: 'n' }, ...o });

describe('router hint', () => {
  it('testRow keeps the writer\'s router hint', () => {
    expect(row({ router: { cell: 'chinese-flash3', route: '3flash', basis: 'stored model' } }).router).toEqual({ cell: 'chinese-flash3', route: '3flash', script: null, basis: 'stored model' });
    expect(row({}).router).toBeNull();
  });
  it('routerIndex keys the full path (every route-judge file is score.json) and reads the pilot', () => {
    const ix = routerIndex(rules);
    expect(ix.get('rj/a/score.json|zh|o')).toMatchObject({ cell: 'chinese-flash3', route: '3flash>opus' });
    expect(ix.get('rj/pilot/score.json|chinese|paddle')).toMatchObject({ cell: 'chinese-flash3', route: '3flash' });
    expect(ix.get('score.json|zh|o')).toBeUndefined();
  });
});

describe('dedupeAcross', () => {
  it('the same judgment copied into a later test is one row, the later test in also_in', () => {
    const a = row({}), b = row({ test: { id: 'U', evidence: 'ev/U.score.json' } }), c = row({ test: { id: 'U' }, verdict: { accept: false, defects: [], reader_note: 'other' } });
    const out = dedupeAcross([['T', { rows: [a] }], ['U', { rows: [b, c] }]]);
    expect(out).toHaveLength(2);
    expect(out[0].test.also_in).toEqual(['U']);
  });
});
