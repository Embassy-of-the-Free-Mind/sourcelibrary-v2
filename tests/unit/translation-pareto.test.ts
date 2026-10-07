import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import xlate from '@/data/translation-pareto.json';

/**
 * The translation cost/fidelity charts (#5983, Derek's addition of 2026-10-06). Guards:
 *  1. the committed src/data/translation-pareto.json is what the generator gives from the write-ups' rows;
 *  2. the frontier is exactly the non-dominated set, drawn only with ≥ 3 placed engines;
 *  3. every placed engine has a metered cost whose write-up exists; an engine without one is never placed;
 *  4. the generator reproduces the write-ups' own paired Flash − Lite differences (#5695 synthesis);
 *  5. every figure says "Model-judged, not human-scored" on its face, and the sentence names an
 *     off-plot engine that beats production on its own pages.
 * Negative controls (run 2026-10-06): editing one fidelity in the JSON turns (1) red; giving the Opus
 * point a cost turns (3) red; dropping the badge from TRANSLATION turns (5) red.
 */
type Point = {
  engine: string; label: string; production: boolean; fidelity: number; reversals: { per_100: number };
  cost: { usd_per_1k: number; source: string } | null; on_frontier?: boolean;
  subset?: { n_pages: number; production_fidelity: number };
};
type Panel = { n_pages: number; frontier: boolean; placed: Point[]; no_cost: Point[] };
const charts = (xlate as unknown as { charts: { id: string; panels: Panel[] }[] }).charts;
const byId = Object.fromEntries(charts.map(c => [c.id, c.panels[0]]));

describe('translation-pareto.json', () => {
  it('is current with its inputs', () => {
    const out = execFileSync('node', ['scripts/eval/build-translation-pareto.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toContain('current');
  });

  it('has a chart for each language with at least 10 shared pages', () => {
    expect(charts.length).toBeGreaterThanOrEqual(10);
    for (const c of charts) for (const p of c.panels) expect(p.n_pages, c.id).toBeGreaterThanOrEqual(10);
  });

  it('marks exactly the non-dominated engines as the frontier', () => {
    for (const c of charts) for (const p of c.panels) {
      for (const a of p.placed) {
        const dominated = p.placed.some(b => b !== a && b.cost!.usd_per_1k <= a.cost!.usd_per_1k && b.fidelity >= a.fidelity
          && (b.cost!.usd_per_1k < a.cost!.usd_per_1k || b.fidelity > a.fidelity));
        expect(a.on_frontier, `${c.id}/${a.engine}`).toBe(p.frontier && !dominated);
      }
      expect(p.frontier).toBe(p.placed.length >= 3);
    }
  });

  it('places only engines with a metered cost from an existing write-up', () => {
    for (const c of charts) for (const p of c.panels) {
      for (const a of p.placed) {
        expect(a.cost, `${c.id}/${a.engine}`).not.toBeNull();
        expect(fs.existsSync(path.join(process.cwd(), a.cost!.source)), a.cost!.source).toBe(true);
      }
      for (const a of p.no_cost) expect(a.cost, `${c.id}/${a.engine}`).toBeNull();
      expect(p.placed.some(a => /claude/i.test(a.engine)), c.id).toBe(false);
    }
  });

  it("reproduces the #5695 synthesis' Flash − Lite differences", () => {
    const summary = JSON.parse(fs.readFileSync('scripts/eval/results/xlref-synthesis-2026-10/summary.json', 'utf8')) as
      { languages: { lang: string; flash_minus_lite: { delta?: number } }[] };
    let checked = 0;
    for (const l of summary.languages) {
      const p = byId[l.lang.toLowerCase()];
      if (!p || l.flash_minus_lite.delta == null) continue;
      const f = (e: string) => p.placed.find(x => x.engine === e)?.fidelity;
      const d = f('gemini-3-flash-preview')! - f('gemini-3.1-flash-lite')!;
      expect(Math.abs(d - l.flash_minus_lite.delta), l.lang).toBeLessThanOrEqual(0.011);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});

describe('the translation figures (#5983)', async () => {
  const { meaning, translationPanel, TRANSLATION } = await import('@/app/quality/ParetoCharts');
  type P = Parameters<typeof translationPanel>[0];
  it('say "model-judged, not human-scored" on their face', () => {
    expect(TRANSLATION.badge).toMatch(/model-judged, not human-scored/i);
  });
  it('say "too few" exactly where there is no frontier', () => {
    for (const c of charts) for (const p of c.panels) {
      expect(meaning(translationPanel(p as unknown as P), TRANSLATION).includes('too few to draw a frontier'), c.id).toBe(!p.frontier);
    }
  });
  it('name an off-plot engine that beats the engine in use on its own pages', () => {
    for (const c of charts) for (const p of c.panels) {
      const better = p.no_cost.filter(x => x.subset && x.fidelity > x.subset.production_fidelity).sort((a, b) => b.fidelity - a.fidelity);
      if (better.length) expect(meaning(translationPanel(p as unknown as P), TRANSLATION), c.id).toContain(better[0].label);
    }
  });
});
