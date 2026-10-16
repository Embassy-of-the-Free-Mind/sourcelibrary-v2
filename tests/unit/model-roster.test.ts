import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import roster from '@/data/model-roster.json';

/**
 * Which engines on /quality/pareto we can run today (#6776). Guards:
 *  1. src/data/model-roster.json is what scripts/eval/build-model-roster.mjs gives from the recorded `agy models` run
 *     and the rules' sources (the build fails if a rule's quoted passage is gone or an engine has no rule);
 *  2. every engine the page draws has a roster row, so no dot is filled or hollow by default;
 *  3. the standing rules hold in the data: Claude only on the subscription, Tesseract never, a Gemini CLI engine only
 *     when the recorded CLI list offers it, the paid Gemini API only for Flash-Lite;
 *  4. the scatter's frontier (frontierOf, price axis, every engine) is the build's own `on_frontier` set.
 * Negative controls (run 2026-10-16): flipping Tesseract to available turns (3) red; deleting one roster row turns
 * (2) red; marking a dominated point on_frontier in ocr-pareto.json turns (4) red.
 */
type Row = { engine: string; route: string; group: string; available: boolean; why_not: string | null; source: string };
const R = roster as unknown as { agy_models: { models: string[] }; engines: Row[] };

describe('model-roster.json', () => {
  it('is current with its inputs', () => {
    expect(execFileSync('node', ['scripts/eval/build-model-roster.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  });

  it('keeps the standing rules', () => {
    for (const r of R.engines) {
      const at = r.engine;
      if (/^tesseract/.test(r.engine)) expect(r.available, at).toBe(false);
      if (/^claude-/.test(r.engine) && r.available) expect(r.route, at).toBe('subscription');
      if (r.route === 'api' && r.available && r.group !== 'production') expect(r.engine, at).toBe('gemini-3.1-flash-lite');
      const cli = r.engine.match(/^(gemini-[a-z0-9.-]+)\+antigravity-cli$/);
      if (cli) expect(r.available, at).toBe(R.agy_models.models.some(m => m === cli[1] || m.replace(/-(low|medium|high)$/, '') === cli[1]));
      if (r.available) expect(r.why_not, at).toBeNull();
      else expect(r.why_not, at).toBeTruthy();
    }
  });
});

describe('the scatter (#6776)', async () => {
  const { OCR, TRANSLATION, frontierOf } = await import('@/app/quality/ParetoCharts');
  it('has a roster row for every engine it draws', () => {
    for (const m of [OCR, TRANSLATION]) for (const c of m.charts) for (const p of c.panels) for (const x of p.points) {
      expect(x.roster, `${m.key}/${c.id}/${p.kind}/${x.engine}`).not.toBeNull();
    }
  });
  it('draws the same price frontier the build marks', () => {
    for (const m of [OCR, TRANSLATION]) for (const c of m.charts) for (const p of c.panels) {
      if (!p.frontier) continue;
      const priced = p.points.filter(x => x.cost);
      const drawn = new Set(frontierOf(priced, x => x.cost!.usd_per_1k, x => x.y).map(x => x.engine));
      for (const x of priced) expect(drawn.has(x.engine), `${m.key}/${c.id}/${p.kind}/${x.engine}`).toBe(x.on_frontier);
    }
  });
});
