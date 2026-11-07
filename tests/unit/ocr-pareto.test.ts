import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import pareto from '@/data/ocr-pareto.json';

/**
 * The OCR cost/accuracy charts (#5983, rebuilt in #6386). Guards:
 *  1. the committed src/data/ocr-pareto.json is what the generator gives from today's inputs, and the CLI re-score
 *     it reads reproduces the scorer on every unchanged read (rescore-plan-note.mjs --check);
 *  2. ONE failure rule (#6523): every engine in a panel was run on every page of the panel; a failed read is counted
 *     in `did_not_read`, not scored, and an engine that did not read more than 20% is flagged `partly_measured`;
 *     accuracy and its interval stay inside [0, 1];
 *  3. the frontier is exactly the non-dominated priced engines, and only on panels not graded not_fit;
 *  4. a verdict word needs the paired interval to exclude 0 AND the difference to clear the noise band;
 *  5. the renderer holds no figures: every number on the page comes from the JSON.
 * Negative controls (run 2026-10-09): editing one accuracy in the JSON turns (1) red; giving a not_fit panel
 * `frontier: true` turns (3) red; flipping a `same` verdict to `better` turns (4) red.
 */
type Vs = { diff: number; ci95: number[] | null; n_pages: number };
type Point = { engine: string; accuracy: number; accuracy_ci95: number[] | null; cost: { usd_per_1k: number; source: string; basis: string } | null;
  on_frontier?: boolean; production: boolean; vs_in_use?: Vs | null; verdict?: string; label: string;
  did_not_read: { k: number; n: number; kinds: Record<string, number> }; partly_measured?: string };
type Panel = { kind: string; n_pages: number; n_works: number; frontier: boolean; grade: { level: string }; noise: { kind: string; band: number | null } | null; verdict: string; placed: Point[]; no_cost: Point[] };
const charts = (pareto as unknown as { charts: { id: string; panels: Panel[] }[] }).charts;
const panels = charts.flatMap(c => c.panels.map(p => [c.id, p] as const));

describe('ocr-pareto.json', () => {
  // Each takes 4–10 s locally and several times that on a busy CI runner, so they get their own generous timeouts.
  it('is current with its inputs', () => {
    expect(execFileSync('node', ['scripts/eval/build-ocr-pareto.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  }, 120_000);
  it('reads a CLI re-score that is current and passes its positive control', () => {
    expect(execFileSync('node', ['scripts/eval/ocr-pareto-6293/rescore-plan-note.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  }, 120_000);
  // #6523: the extractor re-score the builder reads (CI has no bench: the CLI rows are re-derived, the rest kept).
  it('reads an extractor re-score that is current and passes its positive control', () => {
    expect(execFileSync('node', ['scripts/eval/ocr-pareto-6293/rescore-extract.mjs', '--check', '--bench', '/nonexistent'], { encoding: 'utf8' })).toContain('current');
  }, 120_000);

  it('has charts, each panel on at least 5 shared pages, the first one primary', () => {
    expect(charts.length).toBeGreaterThanOrEqual(3);
    for (const c of charts) {
      expect(c.panels[0].kind, c.id).toBe('primary');
      for (const p of c.panels) expect(p.n_pages, c.id).toBeGreaterThanOrEqual(5);
    }
  });

  it('counts every page of its panel for every engine, read or not, inside [0, 1]', () => {
    for (const [id, p] of panels) {
      const prod = [...p.placed, ...p.no_cost].find(x => x.production);
      for (const x of [...p.placed, ...p.no_cost]) {
        const at = `${id}/${p.kind}/${x.engine}`, d = x.did_not_read;
        expect(d.n, at).toBe(p.n_pages);
        expect(Object.values(d.kinds).reduce((a, b) => a + b, 0), at).toBe(d.k);
        expect(!!x.partly_measured, at).toBe(d.k / d.n > 0.2);
        // paired only on pages both engines read
        if (x.vs_in_use && prod) {
          expect(x.vs_in_use.n_pages, at).toBeLessThanOrEqual(p.n_pages - Math.max(d.k, prod.did_not_read.k));
          expect(x.vs_in_use.n_pages, at).toBeGreaterThanOrEqual(p.n_pages - d.k - prod.did_not_read.k);
        }
        expect(x.accuracy).toBeGreaterThanOrEqual(0);
        expect(x.accuracy).toBeLessThanOrEqual(1);
        for (const v of x.accuracy_ci95 || []) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      }
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
        expect(a.engine.includes('>') ? ['chain'] : ['billed', 'quota'], `${id}/${a.engine}`).toContain(a.cost!.basis);
        expect(fs.existsSync(path.join(process.cwd(), a.cost!.source)), a.cost!.source).toBe(true);
      }
      for (const a of p.no_cost) expect(a.cost).toBeNull();
    }
  });

  it('says better or worse only when the paired interval excludes 0 and clears the noise band', () => {
    for (const [id, p] of panels) for (const x of [...p.placed, ...p.no_cost]) {
      if (!x.vs_in_use) continue;
      const band = p.noise?.band ?? 0, ci = x.vs_in_use.ci95;
      const withheld = p.grade.level === 'not_fit' || p.noise?.kind === 'not_reproduced';
      const expected = withheld ? undefined
        : ci && ci[0] > 0 && x.vs_in_use.diff > band ? 'better' : ci && ci[1] < 0 && -x.vs_in_use.diff > band ? 'worse' : 'same';
      expect(x.verdict, `${id}/${p.kind}/${x.engine}`).toBe(expected);
      if (expected === 'better') expect(p.verdict, id).toMatch(p.grade.level === 'decide' ? /better/ : /points toward|not runnable today/);
    }
    for (const [id, p] of panels) {
      if (p.grade.level === 'not_fit') expect(p.verdict, id).toMatch(/^No verdict/);
      // only a Decide panel may use the words better / worse
      if (p.grade.level !== 'decide') expect(p.verdict, id).not.toMatch(/\b(better|worse) than\b/);
      // a repeat that is not like-for-like, or identical on every page, never sets a band
      if (p.noise && p.noise.kind !== 'spread') expect(p.noise.band, id).toBeNull();
    }
  });
});

// #6740: a chained route (draft → corrector) is a point on the same pages as its draft, priced at its draft plus more.
describe('chained routes', () => {
  type ChainPoint = Point & { chain?: { draft: string; corrector: string; n: number; worse: number; better: number }; cost: Point['cost'] & { billed_usd_per_1k?: number } };
  const chains = panels.flatMap(([id, p]) => ([...p.placed, ...p.no_cost] as ChainPoint[]).filter(x => x.engine.includes('>')).map(x => [id, p, x] as const));
  it('draws each chain from a draft on the same panel, with the pages it made worse counted', () => {
    for (const [id, p, x] of chains) {
      const at = `${id}/${p.kind}/${x.engine}`;
      expect(x.chain, at).toBeTruthy();
      const draft = [...p.placed, ...p.no_cost].find(d => d.engine === x.chain!.draft);
      expect(draft, at).toBeTruthy();
      expect(x.engine, at).toBe(`${x.chain!.draft}>${x.chain!.corrector}`);
      expect(x.label.startsWith(`${draft!.label} → `), at).toBe(true);
      expect(x.chain!.worse + x.chain!.better, at).toBeLessThanOrEqual(x.chain!.n);
      expect(x.chain!.n, at).toBeLessThanOrEqual(p.n_pages);
      // never Flash-Lite as a corrector (#7275), never a heavy agy model
      expect(x.chain!.corrector, at).not.toMatch(/flash-lite|argon|-pro|-high/);
      if (x.cost && draft!.cost) expect(x.cost.usd_per_1k, at).toBeGreaterThan(draft!.cost.usd_per_1k);
    }
  });
});

describe('ParetoCharts.tsx holds no figures', () => {
  const code = fs.readFileSync(path.join(process.cwd(), 'src/app/quality/ParetoCharts.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const RULES: [string, RegExp][] = [
    ['no percentages', /\b(?!95%)\d+(\.\d+)?\s?%/],
    ['no money', /\$(?!0 (via subscription|billed))\d/], // the fixed labels: a subscription run bills nothing
    ['no dates', /\b20\d\d-\d\d-\d\d\b/],
    ['no engine names', /\b(gemini|flash|paddle|surya|kraken|tesseract|olmocr|ndl)\b/i],
  ];
  for (const [name, re] of RULES) it(name, () => {
    expect(code.split('\n').filter(l => re.test(l)).map(l => l.trim().slice(0, 120))).toEqual([]);
  });
});

// The summary table on /quality/pareto (#6524) is a second reading of the panels the verdict sentences were written
// from. If summaryRow() ever picks a different engine or formats a figure differently, the table and the sentence
// under it disagree in public, so every figure in a row must be found in its section's verdict sentence.
describe('the summary table agrees with each verdict sentence (#6524)', async () => {
  const { OCR, TRANSLATION, summaryRow } = await import('@/app/quality/ParetoCharts');
  for (const m of [OCR, TRANSLATION]) for (const chart of m.charts) it(`${m.key}/${chart.id}`, () => {
    const r = summaryRow(chart, m), verdict = chart.panels[0].verdict;
    if (r.state === 'not_fit') return void expect(verdict).toMatch(/^No verdict/);
    expect(verdict).toContain(r.inUse);
    if (r.state === 'withheld') expect(verdict).toMatch(/^Verdicts withheld/);
    else if (r.state === 'none') expect(verdict).toMatch(/^No engine (we can run today )?(is clearly better than|stands out from) /);
    else {
      expect(verdict.startsWith(r.state === 'switch' ? `${r.best} ` : `The evidence points toward ${r.best} over `), verdict).toBe(true);
      expect(verdict).toContain(`${r.gain} `);
      expect(verdict).toContain(`95% interval ${r.interval})`);
      for (const also of r.also.slice(0, 2)) expect(verdict.split('Also better: ')[1]).toContain(also.label);
      // no engine we cannot run is ever the one offered (#6776)
      for (const x of r.cannotRun) expect(verdict.split('not runnable today: ')[1] ?? '', `${chart.id}: ${x}`).toContain(x);
      if (r.also.length > 2) expect(verdict).toContain(`and ${r.also.length - 2} more`);
    }
  });
});
