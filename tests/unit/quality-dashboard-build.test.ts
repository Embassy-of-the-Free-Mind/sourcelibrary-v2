import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, no type declarations
import { buildReport, wilson } from '../../scripts/eval/quality-dashboard/build.mjs';
// @ts-expect-error — plain .mjs script, no type declarations
import { buildTrends, efficiencyPoint, billPoints } from '../../scripts/eval/quality-dashboard/trends.mjs';

/**
 * scripts/eval/quality-dashboard/build.mjs (#5474) on a fixture tree. Pins the rules the page relies
 * on: a run whose controls failed is never the headline; an instrument that has not run arrives as
 * null (rendered "no measurement"), never as zero; a drawn-but-unjudged month is listed as pending.
 * The trend lines (#6429): a series with no point is "no measurement"; the week comparison counts
 * re-read panel pages; a carried bill copy is never a new point; an old newest point is flagged stale.
 *
 * Negative control (run 2026-10-01): dropping `&& r.controls_pass` from the `served` filter in
 * buildTranslation turns "skips a run whose controls failed" red. (2026-10-10, #6429): dropping
 * `|| d.bill.carried` from billPoints turns "takes bill weeks only from the run that computed them" red.
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

let root: string;
const put = (rel: string, body: unknown) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-root-'));
  const R = 'scripts/eval/results';
  put(`${R}/translation-corpus-audit-2099-01-01/report.json`, report('2099-01-01T00:00:00Z', 300, 89, 11));
  put(`${R}/translation-corpus-audit-monthly-2099-02/report.json`, report('2099-02-01T00:00:00Z', 100, 85, 14));
  put(`${R}/translation-corpus-audit-monthly-2099-03/report.json`, report('2099-03-01T00:00:00Z', 100, 40, 60, false));
  put(`${R}/translation-corpus-audit-chained-2099-02-02/report.json`, report('2099-02-02T00:00:00Z', 75, 85, 7));
  put('.claude/docs/page-error-taxonomy.md', '### T9 · Quiet omission — NEW · #9001\n### T10 · Invented notes — NEW · #9002\n### O5 · Silent omission — NEW · #9003\n');
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('quality-dashboard build', () => {
  it('headline = latest served run with passing controls; previous = the one before', () => {
    const d = buildReport({ root, pendingBranches: [] });
    expect(d.translation.latest.run).toBe('monthly-2099-02');
    expect(d.translation.latest.any_major.est).toBe(14);
    expect(d.translation.previous.run).toBe('2099-01-01');
    expect(d.translation.latest.n).toBe(100);
  });

  it('skips a run whose controls failed, but still lists it', () => {
    const d = buildReport({ root });
    expect(d.translation.latest.run).not.toBe('monthly-2099-03');
    expect(d.translation.runs.find((r: { id: string }) => r.id === 'monthly-2099-03').controls_pass).toBe(false);
  });

  it('keeps the chained-lane sample out of the served headline', () => {
    const d = buildReport({ root });
    expect(d.translation.runs.find((r: { id: string }) => r.id === 'chained-2099-02-02').population).toBe('chained');
    expect(d.translation.latest.run).not.toBe('chained-2099-02-02');
  });

  it('reports missing instruments as absent, never as zero', () => {
    const d = buildReport({ root });
    expect(d.ocr).toBeNull();
    expect(d.reader).toBeNull();
    expect(d.trends).toBeNull();
  });

  it('lists a drawn-but-unjudged month as pending, not one already on main', () => {
    const d = buildReport({ root, pendingBranches: ['eval/tca-2099-02', 'eval/tca-2099-04', 'eval/speedtest-a-gate'] });
    expect(d.translation.pending).toEqual([{ month: '2099-04', branch: 'eval/tca-2099-04' }]);
  });

  it('maps judge flags to taxonomy classes with their issues', () => {
    const d = buildReport({ root, issueStates: { 9001: 'OPEN' } });
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

const NOW = new Date('2099-03-20T06:30:00Z');
const stored = (date: string, cer: [number, number, number], hashes: Record<string, string>) => ({
  day: date,
  served_text_stored: {
    date, hashes,
    strata: { 'latin-print': { mean_cer: cer[0], n: 30, n_scored: 30 }, 'zh-manuscript': { mean_cer: cer[1], n: 30, n_scored: 30 }, 'english-print': { mean_cer: cer[2], n: 30, n_scored: 30 } },
  },
});
const pvg = (dayStr: string, ocr: [number, number, number], bill?: unknown) => ({
  _id: `paid-vs-got-${dayStr}`, day: dayStr, bill,
  headline: [
    { lane: 'ocr', paid_usd: ocr[0], pages_written: ocr[1], per_1k_usd: ocr[1] ? +(1000 * ocr[0] / ocr[1]).toFixed(2) : null, waste_usd: ocr[2], waste_pct: 0 },
    { lane: 'translation', paid_usd: 1, pages_written: 1000, per_1k_usd: 1, waste_usd: 0, waste_pct: 0 },
  ],
});
const week = (from: string, to: string, pctv: number) => ({ from, to, billed_usd: 100, metered_usd: pctv, attributed_usd: pctv, metered_pct: pctv });

describe('quality trends (#6429)', () => {
  it('a series with no point is no measurement, never zero', () => {
    const t = buildTrends([], NOW);
    expect(t.map((c: { id: string }) => c.id)).toEqual(['quality', 'reach', 'efficiency', 'bill']);
    for (const c of t) { expect(c.newest).toBeNull(); expect(c.statement).toBeNull(); expect(c.series.every((s: { points: unknown[] }) => s.points.length === 0)).toBe(true); }
    expect(buildTrends(null, NOW)).toBeNull();
  });

  it('compares served text with the point a week earlier and counts re-read pages', () => {
    const docs = [stored('2099-03-10', [0.04, 0.1, 0.13], { a: 'x', b: 'y', c: 'z' }), stored('2099-03-19', [0.03, 0.1, 0.13], { a: 'x2', b: 'y', c: 'z' })];
    const q = buildTrends(docs, NOW)[0];
    expect(q.newest).toBe('2099-03-19');
    expect(q.statement).toContain('Latin 3.0%');
    expect(q.statement).toContain('1 of 3 panel pages re-read since Mar 10: Latin better by 1.0 pts');
    expect(q.key_type).toBe('AI-consensus key');
    expect(q.stale).toBeNull();
  });

  it('flags a daily series whose newest point is old', () => {
    const q = buildTrends([stored('2099-03-10', [0.04, 0.1, 0.13], {})], NOW)[0];
    expect(q.stale).toMatch(/No new point since Mar 10/);
  });

  it('pools seven ledger days for the cost statement; a zero-page day has no point', () => {
    const docs = ['2099-03-12', '2099-03-13', '2099-03-19'].map((d, i) => ({ day: d, efficiency: { ...efficiencyPoint(pvg(d, [i === 2 ? 0 : 10, i === 2 ? 0 : 5000, 1])), date: d } }));
    const e = buildTrends(docs, NOW)[2];
    expect(e.series[0].points.map((p: { date: string }) => p.date)).toEqual(['2099-03-12', '2099-03-13']);
    expect(e.statement).toContain('7 days to Mar 19: OCR $2.00 per 1,000 pages (5,000 pages)');
    expect(e.statement).toContain('The 7 days before: $2.00');
  });

  it('takes bill weeks only from the run that computed them, latest computation winning', () => {
    const docs = [
      pvg('2099-03-02', [1, 1, 0], { weeks: [week('2099-02-22', '2099-02-28', 80)] }),
      pvg('2099-03-03', [1, 1, 0], { weeks: [week('2099-02-22', '2099-02-28', 50)], carried: true }),
      pvg('2099-03-09', [1, 1, 0], { weeks: [week('2099-02-22', '2099-02-28', 90), week('2099-03-01', '2099-03-07', 95)] }),
      pvg('2099-03-10', [1, 1, 0], { weeks: [week('2099-02-22', '2099-02-28', 50), week('2099-03-01', '2099-03-07', 50)], carried: true }),
    ];
    const pts = billPoints(docs);
    expect(pts.map((p: { metered_pct: number }) => p.metered_pct)).toEqual([90, 95]);
  });
});
