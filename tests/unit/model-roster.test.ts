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
 *  4. the scatter's frontier (frontierOf, price axis, every engine) is the build's own `on_frontier` set;
 *  5. every dot the pages DRAW (rendered to markup) is in the state its roster row says (filled: we can run it, or it is
 *     the engine in use; hollow: not runnable), and no hollow dot is painted over a filled one (#6776: Gemini 3.8 Flash
 *     high was drawn hollow because a hollow dot at the same place was painted after it).
 * Negative controls (run 2026-10-16): flipping Tesseract to available turns (3) red; deleting one roster row turns
 * (2) red; marking a dominated point on_frontier in ocr-pareto.json turns (4) red.
 */
type Row = { engine: string; route: string; group: string; available: boolean; why_not: string | null; source: string };
const R = roster as unknown as { agy_models: { models: string[] }; engines: Row[] };

describe('model-roster.json', () => {
  it('is current with its inputs', () => {
    expect(execFileSync('node', ['scripts/eval/build-model-roster.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
  });

  it('judges availability by the route we can run, not the one measured (Derek 2026-10-16)', () => {
    const by = new Map(R.engines.map(r => [r.engine, r]));
    for (const id of ['claude-sonnet-5-5', 'claude-opus-5-5', 'gemini-3.8-flash', 'gemini-3.8-flash-high+antigravity-cli']) {
      expect(by.get(id)?.available, id).toBe(true);
      expect(by.get(id)?.route, id).toBe('subscription');
    }
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

describe('the drawn dots match the roster (#6776)', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { OCR, TRANSLATION, ParetoPresentation, NotEnoughEvidence, SmallMultiples } = await import('@/app/quality/ParetoCharts');
  const by = new Map(R.engines.map(r => [r.engine, r]));
  const inUse = new Set<string>();
  for (const m of [OCR, TRANSLATION]) for (const c of m.charts) for (const p of c.panels) for (const x of p.points) if (x.production) inUse.add(x.engine);
  const html = renderToStaticMarkup(React.createElement('div', null, ...[OCR, TRANSLATION].flatMap(m => [
    React.createElement(ParetoPresentation, { m }), React.createElement(NotEnoughEvidence, { m }), React.createElement(SmallMultiples, { m }),
  ])));
  const svgs = html.split('<svg').slice(1);
  it('draws every dot in its roster state, never hollow over filled', () => {
    let dots = 0;
    for (const svg of svgs) {
      const seen: { state: string; at: string }[] = [];
      for (const g of svg.matchAll(/<g data-engine="([^"]+)" data-state="([^"]+)">(?:<title>[^<]*<\/title>)?(?:<circle[^>]*fill="none"[^>]*\/>)?<(?:circle cx="([\d.-]+)" cy="([\d.-]+)"[^>]*fill="([^"]+)"|path d="M([\d.-]+) ([\d.-]+)[^"]*"[^>]*fill="([^"]+)")/g)) {
        const [, engine, state] = g;
        const fill = g[5] ?? g[8];
        const row = by.get(engine.split('|')[0]);
        const expected = inUse.has(engine) && state === 'in_use' ? 'in_use' : row?.available ? 'available' : 'not_available';
        expect(state, engine).toBe(expected);
        expect(fill === '#ffffff', `${engine} drawn ${fill === '#ffffff' ? 'hollow' : 'filled'} in state ${state}`).toBe(state === 'not_available');
        // paint order: once a filled dot is drawn, no hollow one follows it in the same plot
        if (state === 'not_available') expect(seen.some(x => x.state !== 'not_available'), `${engine} painted after a filled dot`).toBe(false);
        seen.push({ state, at: `${g[3] ?? g[6]},${g[4] ?? g[7]}` });
        dots++;
      }
    }
    expect(dots).toBeGreaterThan(500);
  });
  it('fills Gemini 3.8 Flash (CLI, high) wherever it is drawn', () => {
    const m = html.match(/data-engine="gemini-3\.8-flash-high\+antigravity-cli" data-state="([^"]+)"/g) ?? [];
    expect(m.length).toBeGreaterThan(0);
    for (const x of m) expect(x).toContain('data-state="available"');
  });
});
