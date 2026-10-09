import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pareto from '@/data/ocr-pareto.json';

/**
 * The OCR cost/accuracy charts (#5983, rebuilt in #6386). Guards:
 *  1. the committed src/data/ocr-pareto.json is what the generator gives from today's inputs, and the CLI re-score
 *     it reads reproduces the scorer on every unchanged read (rescore-plan-note.mjs --check);
 *  2. ONE failure rule: every engine in a panel is scored on every page of the panel (no engine's failure removes a
 *     page), accuracy and its interval stay inside [0, 1];
 *  3. the frontier is exactly the non-dominated priced engines, and only on panels not graded not_fit;
 *  4. a verdict word needs the paired interval to exclude 0 AND the difference to clear the noise band;
 *  5. the renderer holds no figures: every number on the page comes from the JSON.
 * Negative controls (run 2026-10-09): editing one accuracy in the JSON turns (1) red; giving a not_fit panel
 * `frontier: true` turns (3) red; flipping a `same` verdict to `better` turns (4) red.
 */
type Vs = { diff: number; ci95: number[] | null; n_pages: number };
type Point = { engine: string; accuracy: number; accuracy_ci95: number[] | null; cost: { usd_per_1k: number; source: string; basis: string } | null;
  on_frontier?: boolean; production: boolean; vs_in_use?: Vs; verdict?: string; label: string };
type Panel = { kind: string; n_pages: number; n_works: number; frontier: boolean; grade: { level: string }; noise: { band: number } | null; verdict: string; placed: Point[]; no_cost: Point[] };
const charts = (pareto as unknown as { charts: { id: string; panels: Panel[] }[] }).charts;
const panels = charts.flatMap(c => c.panels.map(p => [c.id, p] as const));

describe('ocr-pareto.json', () => {
  it('is current with its inputs', () => {
    expect(execFileSync('node', ['scripts/eval/build-ocr-pareto.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
    expect(execFileSync('node', ['scripts/eval/ocr-pareto-6293/rescore-plan-note.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  });

  it('has charts, each panel on at least 5 shared pages, the first one primary', () => {
    expect(charts.length).toBeGreaterThanOrEqual(3);
    for (const c of charts) {
      expect(c.panels[0].kind, c.id).toBe('primary');
      for (const p of c.panels) expect(p.n_pages, c.id).toBeGreaterThanOrEqual(5);
    }
  });

  it('scores every engine on every page of its panel, inside [0, 1]', () => {
    for (const [id, p] of panels) for (const x of [...p.placed, ...p.no_cost]) {
      if (x.vs_in_use) expect(x.vs_in_use.n_pages, `${id}/${p.kind}/${x.engine}`).toBe(p.n_pages);
      expect(x.accuracy).toBeGreaterThanOrEqual(0);
      expect(x.accuracy).toBeLessThanOrEqual(1);
      for (const v of x.accuracy_ci95 || []) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });

  it('marks exactly the non-dominated priced engines as the frontier, never on a not_fit panel', () => {
    for (const [id, p] of panels) {
      expect(p.frontier, id).toBe(p.grade.level !== 'not_fit' && p.placed.length >= 3);
      for (const a of p.placed) {
        const dominated = p.placed.some(b => b !== a && b.cost!.usd_per_1k <= a.cost!.usd_per_1k && b.accuracy >= a.accuracy
          && (b.cost!.usd_per_1k < a.cost!.usd_per_1k || b.accuracy > a.accuracy));
        expect(!!a.on_frontier, `${id}/${a.engine}`).toBe(p.frontier && !dominated);
      }
    }
  });

  it('places only engines with a billed or quota price from an existing source', () => {
    for (const [id, p] of panels) {
      for (const a of p.placed) {
        expect(['billed', 'quota'], `${id}/${a.engine}`).toContain(a.cost!.basis);
        expect(fs.existsSync(path.join(process.cwd(), a.cost!.source)), a.cost!.source).toBe(true);
      }
      for (const a of p.no_cost) expect(a.cost).toBeNull();
    }
  });

  it('says better or worse only when the paired interval excludes 0 and clears the noise band', () => {
    for (const [id, p] of panels) for (const x of [...p.placed, ...p.no_cost]) {
      if (!x.vs_in_use) continue;
      const band = p.noise?.band ?? 0, ci = x.vs_in_use.ci95;
      const expected = p.grade.level === 'not_fit' ? undefined
        : ci && ci[0] > 0 && x.vs_in_use.diff > band ? 'better' : ci && ci[1] < 0 && -x.vs_in_use.diff > band ? 'worse' : 'same';
      expect(x.verdict, `${id}/${p.kind}/${x.engine}`).toBe(expected);
      if (expected === 'better' && p.grade.level !== 'not_fit') expect(p.verdict, id).toMatch(/better/);
    }
    for (const [id, p] of panels) if (p.grade.level === 'not_fit') expect(p.verdict, id).toMatch(/^No verdict/);
  });
});

describe('ParetoCharts.tsx holds no figures', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'src/app/quality/ParetoCharts.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const RULES: [string, RegExp][] = [
    ['no percentages', /\b(?!95%)\d+(\.\d+)?\s?%/],
    ['no money', /\$\d/],
    ['no dates', /\b20\d\d-\d\d-\d\d\b/],
    ['no engine names', /\b(gemini|flash|paddle|surya|kraken|tesseract|olmocr|ndl)\b/i],
  ];
  for (const [name, re] of RULES) it(name, () => {
    expect(code.split('\n').filter(l => re.test(l)).map(l => l.trim().slice(0, 120))).toEqual([]);
  });
});
