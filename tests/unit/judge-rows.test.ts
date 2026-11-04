/**
 * #7263: rows from tests in lane_judge_verdicts. Readers exclude origin:test unless they ask (missing origin = live),
 * so a test read never reaches book_checks, the sampler's router export, its draw history, or the defect rates. The
 * source scan fails on any new query of the store that neither goes through verdictQuery nor says why it reads all.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { verdictQuery, isLive, originOf, testRow, ownOutcome, ROUTE_JUDGE } from '../../scripts/eval/lib/judge-rows.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { exportScore } from '../../scripts/eval/lane-judge-sampler.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { bookCheckVerdictQuery } from '../../scripts/maintenance/judge-verdicts-to-book-checks.mjs';

/** Mongo's semantics for the two filters verdictQuery emits on `origin` ($ne matches a missing field). */
const matches = (q: Record<string, unknown>, r: Record<string, unknown>) => {
  const o = q.origin as unknown;
  if (o === undefined) return true;
  if (typeof o === 'string') return r.origin === o;
  return r.origin !== (o as { $ne: string }).$ne;
};

const base = { kind: 'item', page_id: 'p1', book_id: 'b1', cell: 'german-lite', route: 'lite>agy-flash-low', lane: 'agy-correct-lite-7558',
  judge: { model_reported: 'claude-opus-5-5', instrument: ROUTE_JUDGE }, run_id: 'r', judged_at: '2026-11-01T00:00:00Z', script_type: 'print', cell_hand: 'print',
  verdict: { accept: true, fidelity: 5, defects: [] } };

describe('origin', () => {
  it('a row with no origin is live; test rows are excluded by default', () => {
    expect(originOf({})).toBe('live');
    expect(isLive({ origin: 'test' })).toBe(false);
    const q = verdictQuery({ kind: 'item' });
    expect(matches(q, {})).toBe(true);
    expect(matches(q, { origin: 'live' })).toBe(true);
    expect(matches(q, { origin: 'test' })).toBe(false);
    expect(q.kind).toBe('item');
  });
  it('tests: true reads all, tests: only reads tests; origin in the filter is refused', () => {
    expect(verdictQuery({ a: 1 }, { tests: true })).toEqual({ a: 1 });
    expect(matches(verdictQuery({}, { tests: 'only' }), {})).toBe(false);
    expect(() => verdictQuery({ origin: 'test' })).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => verdictQuery({}, { tests: 'yes' as any })).toThrow();
  });
});

describe('readers', () => {
  it('the sampler export never counts a test row, even when handed the whole store', () => {
    const live = Array.from({ length: 3 }, (_, i) => ({ ...base, _id: `l${i}`, page_id: `p${i}`, book_id: `b${i}` }));
    const wp = { ...base, _id: 'w', kind: 'wrong_page', verdict: { accept: false, fidelity: 1, defects: [] } };
    const tests = Array.from({ length: 5 }, (_, i) => ({ ...base, _id: `t${i}`, origin: 'test', page_id: `q${i}`, book_id: `c${i}`, verdict: { accept: false, fidelity: 2, defects: [{ severity: 'wrong_text', class: 'O6' }] } }));
    const a = exportScore([...live, wp]), b = exportScore([...live, wp, ...tests]);
    expect(b.cells).toEqual(a.cells);
    expect(b.calls.records).toBe(4);
    expect(b.cells['german-lite'].routes['lite>agy-flash-low'].n).toBe(3);
  });
  it('book_checks reads live rows only, with or without --lane / --run', () => {
    for (const o of [{}, { lane: 'test:x' }, { run: 'test:x' }]) {
      const q = bookCheckVerdictQuery(o);
      expect(matches(q, { origin: 'test' })).toBe(false);
      expect(matches(q, {})).toBe(true);
    }
  });
});

describe('testRow', () => {
  const ok = { book_id: 'b', page_id: 'p', page_number: 3, selection: 'random', kind: 'item', cell: 'chinese-flash3/print', route: 'paddle', test: { id: 'zh-x', arm: 'paddle' },
    judge: { instrument: ROUTE_JUDGE, model: 'claude-opus-5-5' }, verdict: { accept: false, fidelity: 2, defects: [{ severity: 'wrong_text' }] } };
  it('requires book identity, a draw kind, a test id and an instrument', () => {
    expect(() => testRow({ ...ok, book_id: '' })).toThrow(/book_id/);
    expect(() => testRow({ ...ok, selection: 'random-ish' })).toThrow(/selection/);
    expect(() => testRow({ ...ok, test: {} })).toThrow(/test.id/);
    expect(() => testRow({ ...ok, judge: {} })).toThrow(/instrument/);
    expect(() => testRow({ ...ok, settings: { pagez: 1 } })).toThrow(/unknown settings/);
  });
  it('is a test row with every setting present (null = not recorded) and a stable id', () => {
    const r = testRow({ ...ok, settings: { pages_per_call: 1 } });
    expect(r.origin).toBe('test');
    expect(r.settings.pages_per_call).toBe(1);
    expect(r.settings.thinking).toBeNull();
    expect(r._id).toBe(testRow(ok)._id);
    expect(r._id).not.toBe(testRow({ ...ok, rep: 1 })._id);
    expect(r.outcome).toEqual({ accept: false, wrong_text: true, mapped_by: expect.any(String) });
  });
  it('another instrument keeps its own words and an unmapped (null) outcome', () => {
    const r = testRow({ ...ok, judge: { instrument: 'step-t-7568' }, verdict: { rating: 'misleading' } });
    expect(r.verdict).toEqual({ rating: 'misleading' });
    expect(r.outcome).toBeNull();
    expect(r.outcome_null_reason).toMatch(/no measured mapping/);
    expect(ownOutcome('step-t-7568', { accept: true }).outcome).toBeNull();
  });
});

describe('every query of lane_judge_verdicts says which origins it reads', () => {
  const root = path.resolve(__dirname, '../..');
  const files = execFileSync('git', ['grep', '-l', '-E', "lane_judge_verdicts|collection\\(VERDICTS\\)", '--', '*.mjs', '*.js', '*.ts', '*.tsx', '*.py'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f && !f.startsWith('tests/') && !f.includes('/results/'));
  const site = /collection\(\s*(?:VERDICTS|COLLECTION|['"]lane_judge_verdicts['"])\s*\)/g;
  it('finds the readers (the scan is not vacuous)', () => {
    expect(files).toContain('scripts/eval/lane-judge-sampler.mjs');
    expect(files).toContain('scripts/maintenance/judge-verdicts-to-book-checks.mjs');
  });
  for (const f of files) {
    it(f, () => {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      const bad: string[] = [];
      for (const m of src.matchAll(site)) {
        const after = src.slice(m.index, m.index! + 400);
        const call = after.match(/^collection\([^)]*\)\s*\.\s*(find|findOne|distinct|aggregate|countDocuments|estimatedDocumentCount)\(/);
        const before = src.slice(Math.max(0, m.index! - 400), m.index).split('\n').slice(-3).join('\n');
        if (/all origins:/.test(before)) continue;
        if (call && /[vV]erdictQuery\(/.test(after.slice(call[0].length - 1, call[0].length + 40))) continue;
        if (!call && /\.(insertOne|insertMany|updateOne|updateMany|bulkWrite)\(/.test(after.slice(0, 200))) continue;
        bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
      }
      expect(bad, 'query through verdictQuery(), or say "all origins: <why>" on one of the 3 lines above').toEqual([]);
    });
  }
});
