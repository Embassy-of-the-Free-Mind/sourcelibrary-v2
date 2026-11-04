/**
 * #7263 step 4: the router table's automatic pickup (scripts/eval/estimator/router-table/test-evidence.mjs). One scale
 * (the route judge's own accept), no double count with a hand entry or a file derived from the same test, and only a
 * random draw may decide a cell.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { fromRows, fromFiles, rowsScore, isRouteJudgeFile } from '../../scripts/eval/estimator/router-table/test-evidence.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { testRow, ROUTE_JUDGE } from '../../scripts/eval/lib/judge-rows.mjs';

const rules = {
  inputs: { pilot: 'rj/pilot/score.json' },
  cells: [
    { id: 'chinese-flash3', pilot: 'chinese', routes: [{ id: '3flash', pilot: 'paddle' }, { id: '3flash>opus', evidence: [{ score: 'rj/a/score.json', cell: 'zh', route: 'o' }] }] },
    { id: 'latin-lite', routes: [{ id: 'agy', evidence: [{ score: 'ev/derived.score.json', cell: 'la', route: 'agy' }] }] },
  ],
};
const row = (o: Record<string, unknown>) => testRow({ book_id: 'b1', page_id: 'p1', selection: 'random', kind: 'item', cell: 't-cell', route: 't-route',
  test: { id: 'T', evidence: 'ev/T.score.json', record: 'rj/T/' }, judge: { instrument: ROUTE_JUDGE }, verdict: { accept: true, defects: [] }, ...o });

describe('fromRows', () => {
  const hint = { cell: 'chinese-flash3', route: '3flash', script: 'print', basis: 'stored model' };
  it('a hinted random row is evidence; a hand-cited one is not added again', () => {
    const { groups, report } = fromRows(rules, [row({ router: hint }), row({ page_id: 'p2', book_id: 'b2', router: hint }),
      row({ page_id: 'p3', test: { id: 'A', evidence: 'rj/a/score.json' }, cell: 'zh', route: 'o' })], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ router_cell: 'chinese-flash3', router_route: '3flash', n: 2, k: 2, script: 'print', selection: 'random' });
    expect(Object.values(report.hand_cited)).toEqual([1]);
  });
  it('never pools another instrument, a retest or a control', () => {
    const { groups, report } = fromRows(rules, [row({ router: hint, judge: { instrument: 'step-t-7568' }, verdict: { rating: 'sound' } }),
      row({ router: hint, rep: 1 }), row({ router: hint, kind: 'wrong_page' })], new Map());
    expect(groups).toHaveLength(0);
    expect(Object.keys(report.other_scale)[0]).toMatch(/step-t-7568/);
    expect(report.retest).toBe(1);
    expect(report.not_item).toBe(1);
  });
  it('a row whose test a hand-cited file derives from is covered, not added', () => {
    const meta = new Map([['ev/derived.score.json', 'derived from rj/T/score.json']]);
    const { groups, report } = fromRows(rules, [row({ router: { cell: 'latin-lite', route: 'agy', basis: 'x' } }), row({ page_id: 'p9' })], meta);
    expect(groups).toHaveLength(0);
    expect(Object.values(report.covered).reduce((a: number, b) => a + (b as number), 0)).toBe(2);
  });
  it('a test whose ids are rules.json\'s own maps by identity; anything else is unmapped', () => {
    const { groups, report } = fromRows(rules, [row({ cell: 'chinese-flash3', route: '3flash>opus' }), row({ page_id: 'p5' })], new Map());
    expect(groups[0]).toMatchObject({ router_cell: 'chinese-flash3', router_route: '3flash>opus', script: 'unknown' });
    expect(Object.keys(report.unmapped)).toEqual(['T t-cell / t-route']);
  });
  it('one k/n per test and draw kind, book-counted, cut by script', () => {
    const { groups } = fromRows(rules, [row({ router: hint }), row({ page_id: 'p2', router: hint, verdict: { accept: false, defects: [{ class: 'O6', severity: 'wrong_text' }] } }),
      row({ page_id: 'p3', book_id: 'b3', router: hint, selection: 'hand-picked' })], new Map());
    const { whole, cut } = rowsScore(groups);
    expect(whole['T::chinese-flash3'].routes['3flash#random']).toMatchObject({ n: 2, books: 1, accept: '1/2', wrong_text_pages: '1/2', classes_k_of_n: { O6: '1/2' } });
    expect(whole['T::chinese-flash3'].routes['3flash#hand-picked']).toMatchObject({ n: 1, accept: '1/1' });
    expect(cut['T::chinese-flash3|print'].routes['3flash#random'].n).toBe(2);
  });
});

describe('fromFiles', () => {
  const rj = { judge: 'claude-opus-5-5, route-judge-6740 judgePrompt, against the page image' };
  it('reads an unnamed route-judge file where cell and route ids are rules.json\'s; no declared draw = prior only', () => {
    const files = new Map([['ev/new.score.json', { ...rj, cells: { 'latin-lite': { routes: { agy: { accept: '3/4', books: 4 }, other: { accept: '1/1', books: 1 } } }, 'x-7': { routes: {} } } }],
      ['ev/rand.score.json', { ...rj, selection: 'random', cells: { 'latin-lite': { routes: { agy: { accept: '2/2', books: 2 } } } } }]]);
    const { entries, report } = fromFiles(rules, files, new Set());
    expect(entries.map((e: { selection: string }) => e.selection)).toEqual(['unknown', 'random']);
    expect(report.map((r: { status: string }) => r.status)).toEqual(expect.arrayContaining(['unmapped: no rules.json cell of this id', 'unmapped: not a route of the rules.json cell']));
  });
  it('refuses another scale, a named file, and a file its test rows already carry', () => {
    expect(isRouteJudgeFile({ judge: 'claude-opus-5-5, Step T reader (T-TASK.md); not the route-judge prompt' })).toBe(false);
    const files = new Map([['ev/derived.score.json', { ...rj, cells: { 'latin-lite': { routes: { agy: { accept: '1/1', books: 1 } } } } }],
      ['ev/T.score.json', { ...rj, cells: { 'latin-lite': { routes: { agy: { accept: '1/1', books: 1 } } } } }]]);
    const { entries, report } = fromFiles(rules, files, new Set(['ev/T.score.json']));
    expect(entries).toHaveLength(0);
    expect(report).toEqual([{ file: 'ev/T.score.json', status: 'read through its test rows' }]);
  });
});
