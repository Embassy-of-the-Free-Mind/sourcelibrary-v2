import { describe, it, expect } from 'vitest';
import { assertLiveDoc } from '@/app/platform/(protected)/admin/ocr-evidence/read-surface/live/shape';
import { code, fitWithin, termsFor, optimum, predictAll, fitAll, candidates, type Obs, type Point } from '@/app/platform/(protected)/admin/ocr-evidence/read-surface/live/rsm';

/**
 * #6740 live read-surface page. The shape fixture is a slice of the real ops_reports `read-surface-6740:live` doc as
 * publish-live.mjs wrote it on 2026-10-31 (3 German rows, their 2 settings), not a hand-written one.
 */
const REAL = {
 "updated_at": "2026-10-31T10:57:37.248Z",
 "design": {
  "factors": [
   {
    "key": "pages_a_call",
    "levels": [
     1,
     4,
     8
    ]
   },
   {
    "key": "long_edge",
    "levels": [
     1024,
     1600,
     2400,
     "served"
    ]
   },
   {
    "key": "thinking",
    "levels": [
     "low",
     "medium",
     "high"
    ]
   },
   {
    "key": "prompt_line",
    "levels": [
     "line",
     "live"
    ]
   }
  ],
  "settings": [
   {
    "id": "B10",
    "lang": "de",
    "stage": "bbd-A",
    "pages_a_call": 4,
    "long_edge": 2400,
    "thinking": "low",
    "prompt_line": "live",
    "live": false,
    "status": "done"
   },
   {
    "id": "L1",
    "lang": "de",
    "stage": "bbd-A",
    "pages_a_call": 4,
    "long_edge": null,
    "thinking": "low",
    "prompt_line": "live",
    "live": true,
    "status": "done"
   }
  ]
 },
 "rows": [
  {
   "run_id": "B10",
   "setting_id": "B10",
   "lang": "de",
   "book_id": "69ade7095426286aa40cf2ed",
   "century": 19,
   "face": "fraktur",
   "pool": "agy-james",
   "cer": 0,
   "quota_cost": 0.004428825,
   "calls": 0.25,
   "wall_s": 4.25,
   "accepted": true,
   "wrong_text": false,
   "loop": false,
   "cut": false,
   "excluded": false,
   "long_edge_px": 1432,
   "completed_at": "2026-10-30T20:32:05.952Z"
  },
  {
   "run_id": "B10",
   "setting_id": "B10",
   "lang": "de",
   "book_id": "69aff78f57090f8072b7a1dd",
   "century": 19,
   "face": "fraktur",
   "pool": "agy-james",
   "cer": null,
   "quota_cost": 0.036250633125,
   "calls": 1.625,
   "wall_s": 37.15,
   "accepted": false,
   "wrong_text": false,
   "loop": false,
   "cut": false,
   "excluded": false,
   "long_edge_px": 1891,
   "completed_at": "2026-10-30T20:32:05.952Z"
  },
  {
   "run_id": "L1",
   "setting_id": "L1",
   "lang": "de",
   "book_id": "69e961962beefe2f6f72c109",
   "century": 16,
   "face": "fraktur",
   "pool": "agy-james",
   "cer": null,
   "quota_cost": 0.039567020625000004,
   "calls": 1.625,
   "wall_s": 40.15,
   "accepted": false,
   "wrong_text": false,
   "loop": false,
   "cut": false,
   "excluded": true,
   "long_edge_px": 1787,
   "completed_at": "2026-10-30T20:41:45.918Z"
  }
 ],
 "weights": {},
 "budget": {
  "calls_used": 1153,
  "calls_max": 4000,
  "pool_weekly": {
   "default": 0.8903529644012451,
   "agy-james": 0.30786383152008057
  }
 }
};
const clone = () => JSON.parse(JSON.stringify(REAL));

describe('read-surface live: the data-shape assertion', () => {
  it('accepts the doc as the publisher writes it', () => {
    const r = assertLiveDoc(clone());
    expect(r.ok).toBe(true);
  });
  it('names the field when the shape changes, instead of passing an empty doc through', () => {
    expect(assertLiveDoc(null)).toEqual({ ok: false, problems: ['the doc is missing or not an object'] });
    const renamed = clone(); for (const r of renamed.rows) { r.quota_usd = r.quota_cost; delete r.quota_cost; }
    const a = assertLiveDoc(renamed);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.problems).toContain('rows[0].quota_cost: not a number (and 2 more rows)');
    const think = clone(); think.design.settings[0].thinking = 'minimal';
    const b = assertLiveDoc(think);
    expect(!b.ok && b.problems.some((p) => p.includes('thinking'))).toBe(true);
    const empty = clone(); empty.design.settings = [];
    expect(assertLiveDoc(empty).ok).toBe(false);
  });
});

// Synthetic incomplete-block data with known coefficients and book effects that are CORRELATED with the settings a
// book got (the hard books drew the cheap cells): a pooled fit is biased, the within-book fit must not be.
function synth(noise = 0.0005, seed = 1) {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // truth in coded units: y = 0.03 + 0.004·p − 0.002·e − 0.006·t + 0.003·p·t + 0.002·p²
  const truth = (x: number[]) => 0.03 + 0.004 * x[0] - 0.002 * x[1] - 0.006 * x[2] + 0.003 * x[0] * x[2] + 0.002 * x[0] * x[0];
  const cells: Point[] = [];
  for (const ppc of [1, 4, 8]) for (const edge of [768, 1400, 2400]) for (const think of [-1, 0, 1]) cells.push({ ppc, edge, think, line: false });
  const obs: Obs[] = [];
  for (let b = 0; b < 90; b++) {
    const bookEffect = (b % 9) * 0.01;                         // books differ by up to 8 pp
    const pick = [0, 1, 2].map((k) => cells[(b * 3 + k * 7 + (b % 9) * 2) % cells.length]);
    pick.push({ ppc: 4, edge: 2350, think: -1, line: false });  // live on every book
    for (const p of pick) {
      const x = code(p);
      const y = truth(x) + bookEffect + noise * gauss();
      obs.push({ book: `b${b}`, run: `${p.ppc}-${p.edge}-${p.think}`, x, pool: 0, w: 1, y: { cer: y, quota_cost: 0.01 + 0.002 * x[2] - 0.004 * x[0], calls: 1, wall_s: 30, accepted: 1 } });
    }
  }
  return { obs };
}

describe('read-surface live: the within-book fit', () => {
  it('recovers known coefficients from synthetic incomplete blocks with large book effects', () => {
    const { obs } = synth();
    const terms = termsFor(obs, 'quad');
    const names = terms.map((t) => t.name);
    const f = fitWithin(obs, terms, 'cer');
    const at = (n: string) => f.beta[names.indexOf(n)];
    expect(names).not.toContain('prompt line');                // one level in the data: dropped, not a zero column
    expect(at('pages a call')).toBeCloseTo(0.004, 3);
    expect(at('long edge')).toBeCloseTo(-0.002, 3);
    expect(at('thinking')).toBeCloseTo(-0.006, 3);
    expect(at('pages a call × thinking')).toBeCloseTo(0.003, 3);
    expect(at('pages a call²')).toBeCloseTo(0.002, 3);
    expect(Math.abs(at('long edge²'))).toBeLessThan(0.0005);
  });

  it('a pooled fit on the same data is biased by book effects tied to the cells; the within-book fit is not', () => {
    const { obs } = synth(0.0005, 3);
    // Books that drew an 8-a-call cell are 20 pp harder on every page they have, live included.
    const hard = new Set(obs.filter((o) => o.x[0] > 0.5).map((o) => o.book));
    const shifted = obs.map((o) => ({ ...o, y: { ...o.y, cer: (o.y.cer as number) + (hard.has(o.book) ? 0.2 : 0) } }));
    const terms = termsFor(shifted, 'quad');
    const j = terms.findIndex((t) => t.name === 'pages a call');
    expect(fitWithin(shifted, terms, 'cer').beta[j]).toBeCloseTo(0.004, 3);
    // One block for all rows = ordinary least squares with an intercept: the hardness leaks into the slope.
    const pooled = fitWithin(shifted.map((o) => ({ ...o, book: 'all' })), terms, 'cer');
    expect(Math.abs(pooled.beta[j] - 0.004)).toBeGreaterThan(0.01);
  });

  it('reads the optimum off the surface: cheapest point within the CER margin of live', () => {
    const { obs } = synth();
    const terms = termsFor(obs, 'quad');
    const fits = fitAll(obs, terms);
    const live = { ppc: 4, edge: 2350, think: -1, line: false };
    const cands = candidates({ ppc: [1, 8], edge: [768, 2400], think: [-1, 0, 1], line: [false] });
    const o = optimum(fits, terms, cands, live, 'quota_cost', 0.01)!;
    // cost falls with pages a call and rises with thinking: the optimum takes 8 a call at low thinking, if CER allows.
    expect(o.point.think).toBe(-1);
    expect(o.point.ppc).toBe(8);
    expect(o.cer).toBeLessThanOrEqual(predictAll(fits, terms, live).cer + 0.01 + 1e-9);
  });
});
