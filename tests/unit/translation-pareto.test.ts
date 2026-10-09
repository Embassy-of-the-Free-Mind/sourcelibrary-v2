import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import xlate from '@/data/translation-pareto.json';

/**
 * The translation cost/fidelity charts (#5983, rebuilt in #6386). Guards:
 *  1. the committed src/data/translation-pareto.json is what the generator gives from the write-ups' rows;
 *  2. the frontier is exactly the non-dominated priced set, never on a panel graded not_fit;
 *  3. every placed engine has a billed or quota price whose write-up exists; Claude is never placed;
 *  4. the generator reproduces the write-ups' own paired Flash − Lite differences (#5695 synthesis) on the #5695
 *     track panels, on the full sample (--keep-dropped: the committed charts leave out the pages #6304 found unfit);
 *  5. the Tibetan #6121 packets are their own panels and reproduce each packet's refjudge/scores.json;
 *  6. each language's first panel is its primary, chosen by the written rule (most engines, not not_fit first).
 * Negative controls (run 2026-10-09): editing one fidelity in the JSON turns (1) red; giving a Claude point a
 * cost turns (3) red; swapping the order of two Latin panels turns (6) red.
 */
type Point = {
  engine: string; label: string; production: boolean; fidelity: number; fidelity_ci95: number[] | null; reversals: { per_100: number };
  cost: { usd_per_1k: number; source: string; basis: string } | null; on_frontier?: boolean;
};
type Panel = { kind: string; role: string; n_pages: number; n_works: number; frontier: boolean; grade: { level: string }; placed: Point[]; no_cost: Point[]; references: { pages: number }[] };
const charts = (xlate as unknown as { charts: { id: string; panels: Panel[] }[] }).charts;
const panels = charts.flatMap(c => c.panels.map(p => [c.id, p] as const));

describe('translation-pareto.json', () => {
  it('is current with its inputs', () => {
    expect(execFileSync('node', ['scripts/eval/build-translation-pareto.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  });

  it('has a chart for each language with at least 10 shared pages, fidelity inside the 1 to 5 scale', () => {
    expect(charts.length).toBeGreaterThanOrEqual(10);
    for (const [id, p] of panels) {
      expect(p.n_pages, id).toBeGreaterThanOrEqual(10);
      for (const x of [...p.placed, ...p.no_cost]) for (const v of [x.fidelity, ...(x.fidelity_ci95 || [])]) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(5); }
    }
  });

  it('marks exactly the non-dominated priced engines as the frontier, never on a not_fit panel', () => {
    for (const [id, p] of panels) {
      expect(p.frontier, `${id}/${p.kind}`).toBe(p.grade.level !== 'not_fit' && p.placed.length >= 3);
      for (const a of p.placed) {
        const dominated = p.placed.some(b => b !== a && b.cost!.usd_per_1k <= a.cost!.usd_per_1k && b.fidelity >= a.fidelity
          && (b.cost!.usd_per_1k < a.cost!.usd_per_1k || b.fidelity > a.fidelity));
        expect(!!a.on_frontier, `${id}/${a.engine}`).toBe(p.frontier && !dominated);
      }
    }
  });

  it('places only engines with a billed or quota price from an existing write-up, and never Claude', () => {
    for (const [id, p] of panels) {
      for (const a of p.placed) {
        expect(['billed', 'quota'], `${id}/${a.engine}`).toContain(a.cost!.basis);
        expect(fs.existsSync(path.join(process.cwd(), a.cost!.source)), a.cost!.source).toBe(true);
      }
      for (const a of p.no_cost) expect(a.cost, `${id}/${a.engine}`).toBeNull();
      expect(p.placed.some(a => /claude/i.test(a.engine)), id).toBe(false);
    }
  });

  it('puts the primary first: most engines among the panels not graded not_fit', () => {
    for (const c of charts) {
      const n = (p: Panel) => p.placed.length + p.no_cost.length;
      const fit = c.panels.filter(p => p.grade.level !== 'not_fit');
      const pool = fit.length ? fit : c.panels;
      expect(c.panels[0].role, c.id).toBe('primary');
      expect(n(c.panels[0]), c.id).toBe(Math.max(...pool.map(n)));
      if (fit.length) expect(c.panels[0].grade.level, c.id).not.toBe('not_fit');
    }
  });

  it('gives each #6121 Tengyur packet its own Tibetan panel, matching its scores.json', () => {
    const tib = charts.find(c => c.id === 'tibetan')!;
    for (const [kind, dir, arms] of [
      ['tengyur-6121-r1', 'tengyur-levers-6121', { A: 'gemini-3-flash-preview', P: 'gemini-3.1-pro-preview+thinking128' }],
      ['tengyur-6121-r2', 'tengyur-models-6121', { A: 'gemini-3-flash-preview', G35: 'gemini-3.5-flash', G38: 'gemini-3.8-flash', O: 'claude-opus' }],
    ] as const) {
      const p = tib.panels.find(x => x.kind === kind)!;
      expect(p, kind).toBeDefined();
      expect(p.n_pages).toBe(58);
      expect(p.references.reduce((s, r) => s + r.pages, 0)).toBe(58);
      const own = JSON.parse(fs.readFileSync(`scripts/eval/results/${dir}/refjudge/scores.json`, 'utf8')).all;
      for (const [arm, engine] of Object.entries(arms)) {
        const pt = [...p.placed, ...p.no_cost].find(x => x.engine === engine)!;
        expect(pt, `${kind}/${arm}`).toBeDefined();
        expect(Math.abs(pt.fidelity - own[arm].fidelity_mean), `${kind}/${arm}`).toBeLessThanOrEqual(0.005);
      }
      expect(p.no_cost.map(x => x.engine)).toEqual(kind === 'tengyur-6121-r2' ? ['claude-opus'] : []);
    }
  });

  it("reproduces the #5695 synthesis' Flash − Lite differences", () => {
    const summary = JSON.parse(fs.readFileSync('scripts/eval/results/xlref-synthesis-2026-10/summary.json', 'utf8')) as
      { languages: { lang: string; flash_minus_lite: { delta?: number } }[] };
    const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'xlate-')), 'all.json');
    fs.writeFileSync(path.join(path.dirname(tmp), 'none.json'), '[]');
    execFileSync('node', ['scripts/eval/build-translation-pareto.mjs', '--keep-dropped', `--exclude=${path.join(path.dirname(tmp), 'none.json')}`, `--out=${tmp}`]);
    const full = Object.fromEntries((JSON.parse(fs.readFileSync(tmp, 'utf8')).charts as { id: string; panels: Panel[] }[])
      .map(c => [c.id, c.panels.find(p => p.kind.startsWith('track-'))]));
    let checked = 0;
    for (const l of summary.languages) {
      const p = full[l.lang.toLowerCase()];
      if (!p || l.flash_minus_lite.delta == null) continue;
      const f = (e: string) => p.placed.find(x => x.engine === e)?.fidelity;
      if (f('gemini-3-flash-preview') == null || f('gemini-3.1-flash-lite') == null) continue;
      const d = f('gemini-3-flash-preview')! - f('gemini-3.1-flash-lite')!;
      expect(Math.abs(d - l.flash_minus_lite.delta), l.lang).toBeLessThanOrEqual(0.011);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});

describe('the translation figures (#5983)', async () => {
  const { TRANSLATION } = await import('@/app/quality/ParetoCharts');
  it('say "model-judged" on their axis', () => {
    expect(TRANSLATION.yAxis).toMatch(/model-judged/i);
  });
});
