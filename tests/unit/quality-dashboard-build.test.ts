import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, no type declarations
import { buildReport, wilson } from '../../scripts/eval/quality-dashboard/build.mjs';

/**
 * scripts/eval/quality-dashboard/build.mjs (#5474) on a fixture tree. Pins the rules the page relies
 * on: a run whose controls failed is never the headline; an instrument that has not run arrives as
 * null / 'not_run' (rendered "no measurement"), never as zero; the trend flag needs TWO windows in
 * a row above baseline + floor; a drawn-but-unjudged month is listed as pending.
 *
 * Negative control (run 2026-10-01): dropping `&& r.controls_pass` from the `served` filter in
 * buildTranslation turns "skips a run whose controls failed" red; replacing `above && prevAbove`
 * with `above` turns the trend test red.
 */

const cell = (n: number, ge4: number, major: number) => ({
  n, pct_ge4: ge4, any_major: major,
  flags: { omission: 10, invention: 5, inversion: 0, untranslated: 0, wrong_language: 0, wrong_page: 0, garble_passthrough: 0, truncated: 0, repetition: 0 },
});
const report = (drawn: string, n: number, est: number, major: number, pass = true) => ({
  primary_judge: 'opus', second_judge: null, drawn_at: drawn, n_main_judged: n, n_books: n,
  controls_gate: { pass },
  overall_unweighted: cell(n, est, major),
  by_script_class: { 'latin-script': cell(Math.round(n / 2), est, major), 'non-latin-script': cell(Math.round(n / 2), est, major) },
  corpus_estimate: {
    pct_fidelity_ge4: { est, ci: [est - 5, est + 5] },
    any_major_defect: { est: major, ci: [major - 3, major + 3] },
    flags: { omission: { est: 10, ci: [5, 15] }, invention: { est: 5, ci: [2, 8] } },
  },
  defect_types: { 'omission/major': 3 },
});

let root: string, ops: string;
const put = (rel: string, body: unknown) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-root-'));
  ops = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-ops-'));
  const R = 'scripts/eval/results';
  put(`${R}/translation-corpus-audit-2099-01-01/report.json`, report('2099-01-01T00:00:00Z', 300, 89, 11));
  put(`${R}/translation-corpus-audit-monthly-2099-02/report.json`, report('2099-02-01T00:00:00Z', 100, 85, 14));
  put(`${R}/translation-corpus-audit-monthly-2099-03/report.json`, report('2099-03-01T00:00:00Z', 100, 40, 60, false));
  put(`${R}/translation-corpus-audit-chained-2099-02-02/report.json`, report('2099-02-02T00:00:00Z', 75, 85, 7));
  put('.claude/docs/page-error-taxonomy.md', '### T9 · Quiet omission — NEW · #9001\n### T10 · Invented notes — NEW · #9002\n### O5 · Silent omission — NEW · #9003\n');
  const w = (end: string, defective: number) => JSON.stringify({ at: end, window: `x/${end}`, verdict: 'OK', n: 50, defective, rate: defective / 50 });
  fs.mkdirSync(path.join(ops, 'costs'), { recursive: true });
  // 6.0% (below bound), 20% (above, first), 22% (above, second → trend), 4% (below)
  fs.writeFileSync(path.join(ops, 'costs/speed-test-a-quality.jsonl'), [w('2099-02-03T04', 3), w('2099-02-03T10', 10), w('2099-02-03T16', 11), w('2099-02-03T22', 2)].join('\n') + '\n');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(ops, { recursive: true, force: true });
});

describe('quality-dashboard build', () => {
  it('headline = latest served run with passing controls; previous = the one before', () => {
    const d = buildReport({ root, opsRoot: ops, pendingBranches: [] });
    expect(d.translation.latest.run).toBe('monthly-2099-02');
    expect(d.translation.latest.any_major.est).toBe(14);
    expect(d.translation.previous.run).toBe('2099-01-01');
    expect(d.translation.latest.n).toBe(100);
  });

  it('skips a run whose controls failed, but still lists it', () => {
    const d = buildReport({ root, opsRoot: ops });
    expect(d.translation.latest.run).not.toBe('monthly-2099-03');
    expect(d.translation.runs.find((r: { id: string }) => r.id === 'monthly-2099-03').controls_pass).toBe(false);
  });

  it('keeps the chained-lane sample out of the served headline and uses it as the lane baseline', () => {
    const d = buildReport({ root, opsRoot: ops });
    expect(d.translation.runs.find((r: { id: string }) => r.id === 'chained-2099-02-02').population).toBe('chained');
    expect(d.lanes.baseline.any_major.est).toBe(7);
    expect(d.lanes.trend_rule.bound_pct).toBe(9.8);
  });

  it('flags a trend only on the second consecutive window above the bound', () => {
    const d = buildReport({ root, opsRoot: ops });
    expect(d.lanes.windows.map((w: { trend_warn: boolean }) => w.trend_warn)).toEqual([false, false, true, false]);
    expect(d.lanes.windows[1].major_pct).toBe(20);
  });

  it('reports missing instruments as absent, never as zero', () => {
    const d = buildReport({ root, opsRoot: path.join(ops, 'nope') });
    expect(d.ocr).toBeNull();
    expect(d.round1.status).toBe('not_run');
    expect(d.reader).toBeNull();
    expect(d.lanes.missing).toBe(true);
    expect(d.lanes.windows).toEqual([]);
  });

  it('lists a drawn-but-unjudged month as pending, not one already on main', () => {
    const d = buildReport({ root, opsRoot: ops, pendingBranches: ['eval/tca-2099-02', 'eval/tca-2099-04', 'eval/speedtest-a-gate'] });
    expect(d.translation.pending).toEqual([{ month: '2099-04', branch: 'eval/tca-2099-04' }]);
  });

  it('maps judge flags to taxonomy classes with their issues', () => {
    const d = buildReport({ root, opsRoot: ops, issueStates: { 9001: 'OPEN' } });
    const om = d.defects.rows.find((r: { flag: string }) => r.flag === 'omission');
    expect(om.classes.map((c: { code: string }) => c.code)).toEqual(['T9', 'O5']);
    expect(om.classes[0]).toMatchObject({ issue: 9001, issue_state: 'OPEN' });
    expect(om.count).toBe(10);
  });

  it('wilson interval brackets the point estimate', () => {
    const [lo, hi] = wilson(10, 50);
    expect(lo).toBeLessThan(20);
    expect(hi).toBeGreaterThan(20);
    expect(wilson(0, 0)).toBeNull();
  });
});
