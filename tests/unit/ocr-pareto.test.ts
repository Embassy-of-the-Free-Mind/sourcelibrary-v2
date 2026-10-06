import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pareto from '@/data/ocr-pareto.json';

/**
 * The /quality cost/accuracy charts (#5983). Three guards:
 *  1. the committed src/data/ocr-pareto.json is what the generator gives from today's inputs;
 *  2. the frontier really is the set of engines nobody beats on both axes, and every placed point
 *     carries a cost whose source file exists;
 *  3. the renderer holds no figures — every number on the page comes from the JSON.
 * Negative controls (run 2026-10-06): editing one accuracy in the JSON turns (1) red; flipping one
 * point's on_frontier turns (2) red; adding `<span>$1.28</span>` to ParetoCharts.tsx turns (3) red.
 */
type Point = { engine: string; accuracy: number; cost: { usd_per_1k: number; source: string } | null; on_frontier?: boolean; production: boolean };
type Panel = { n_pages: number; frontier: boolean; placed: Point[]; no_cost: Point[] };
const charts = (pareto as unknown as { charts: { id: string; panels: Panel[] }[] }).charts;

describe('ocr-pareto.json', () => {
  it('is current with its inputs', () => {
    const out = execFileSync('node', ['scripts/eval/build-ocr-pareto.mjs', '--check'], { encoding: 'utf8' });
    expect(out).toContain('current');
  });

  it('has charts, each panel on at least 5 shared pages', () => {
    expect(charts.length).toBeGreaterThanOrEqual(3);
    for (const c of charts) for (const p of c.panels) expect(p.n_pages, c.id).toBeGreaterThanOrEqual(5);
  });

  it('marks exactly the non-dominated engines as the frontier', () => {
    for (const c of charts) for (const p of c.panels) {
      for (const a of p.placed) {
        const dominated = p.placed.some(b => b !== a && b.cost!.usd_per_1k <= a.cost!.usd_per_1k && b.accuracy >= a.accuracy
          && (b.cost!.usd_per_1k < a.cost!.usd_per_1k || b.accuracy > a.accuracy));
        expect(a.on_frontier, `${c.id}/${a.engine}`).toBe(p.frontier && !dominated);
      }
      expect(p.frontier).toBe(p.placed.length >= 3);
    }
  });

  it('places only engines with a measured cost from an existing source', () => {
    for (const c of charts) for (const p of c.panels) {
      for (const a of p.placed) {
        expect(a.cost, `${c.id}/${a.engine}`).not.toBeNull();
        expect(fs.existsSync(path.join(process.cwd(), a.cost!.source)), a.cost!.source).toBe(true);
      }
      for (const a of p.no_cost) expect(a.cost).toBeNull();
    }
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

describe('the sentence under each chart (#5983)', async () => {
  const { meaning } = await import('@/app/quality/ParetoCharts');
  type P = Parameters<typeof meaning>[0];
  const panels = charts.flatMap(c => c.panels.map(p => [c.id, p as unknown as P] as const));
  it('says "too few" exactly where there is no frontier', () => {
    for (const [id, p] of panels) expect(meaning(p).includes('too few to draw a frontier'), id).toBe(!p.frontier);
  });
  it('names an unplotted engine that reads better than every plotted one', () => {
    for (const [id, p] of panels) {
      const best = Math.max(...p.placed.map(x => x.accuracy!));
      const better = p.no_cost.filter(x => x.accuracy != null && x.accuracy > best).sort((a, b) => b.accuracy! - a.accuracy!);
      if (better.length) expect(meaning(p), id).toContain(better[0].label);
    }
  });
});
