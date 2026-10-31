import { describe, it, expect } from 'vitest';
import { assertLiveDoc, type LiveDoc } from '@/app/platform/(protected)/admin/ocr-evidence/read-surface/live/shape';
import { buildLead, cerColour, readConfirmation, screenLangs, sentence } from '@/app/platform/(protected)/admin/ocr-evidence/read-surface/live/lead';

/**
 * #6740 lead of the live read-surface page: the 3 × 3 screen cells, each against live inside the books that read both.
 * A hand-computable fixture (three books, live + 8 a call low; an excluded row; a bbd-stage row at the same setting
 * that must not leak into the screen), so every expected value below is worked out by hand in the comments.
 */
const set = (id: string, stage: string, ppc: number, thinking: 'low' | 'medium' | 'high', live = false) =>
  ({ id, lang: 'de', stage, pages_a_call: ppc, long_edge: null, thinking, prompt_line: 'live', live, status: 'done' as const });
const row = (setting: string, book: string, cer: number | null, cost: number, accepted: boolean, excluded = false) => ({
  run_id: setting, setting_id: setting, lang: 'de', book_id: book, century: 17, face: 'fraktur', pool: 'default',
  cer, quota_cost: cost, calls: 0.3, wall_s: 30, accepted, wrong_text: !accepted, loop: false, cut: false, excluded, long_edge_px: 2000,
});
const FIX = {
  updated_at: '2026-10-31T12:00:00.000Z',
  design: {
    factors: [{ key: 'pages_a_call', levels: [1, 4, 8] }],
    settings: [set('LI', 'screen', 4, 'low', true), set('G06', 'screen', 8, 'low'), set('G01', 'screen', 1, 'low'), set('B10', 'bbd-A', 8, 'low')],
  },
  rows: [
    row('LI', 'b1', 0.010, 0.010, true), row('G06', 'b1', 0.012, 0.004, true),
    row('LI', 'b2', 0.020, 0.012, true), row('G06', 'b2', 0.024, 0.006, false),
    row('LI', 'b3', 0.030, 0.014, true),
    row('G01', 'b1', 0.5, 0.5, true, true),   // excluded: 1 a call low has no rows
    row('B10', 'b1', 0.9, 1.0, true),         // another stage at 8 low: must not count
  ],
  weights: {},
  budget: { calls_used: 10, calls_max: 4000, pool_weekly: null },
};

describe('read-surface lead (#6740)', () => {
  const shape = assertLiveDoc(FIX);
  it('the fixture passes the page contract', () => expect(shape.ok).toBe(true));
  const doc = FIX as unknown as LiveDoc;
  const L = buildLead(doc, 'de', { B: 400 });
  const cell = (ppc: number, think: string) => L.cells.find((c) => c.ppc === ppc && c.think === think)!;

  it('finds the languages with a screen', () => expect(screenLangs(doc)).toEqual(['de']));

  it('live is the reference: mean over all live books', () => {
    const c = cell(4, 'low');
    expect(c.live).toBe(true);
    expect(c.books).toBe(3);
    expect(c.usd_1k_pages).toBeCloseTo(12, 6);          // (10 + 12 + 14) / 3 per 1,000
    expect(c.yield).toBeCloseTo(1, 9);
    expect(c.usd_1k_accepted).toBeCloseTo(12, 6);
    expect(c.d_cer_pp).toBe(0);
  });

  it('a cell is compared inside the books that read both', () => {
    const c = cell(8, 'low');
    expect(c.books).toBe(2);                            // b1, b2; b3 has no 8 a call row; the bbd row is not the screen
    expect(c.d_cer_pp).toBeCloseTo(0.3, 9);             // ((1.2 − 1.0) + (2.4 − 2.0)) / 2 pp
    expect(c.usd_1k_pages).toBeCloseTo((12 * 10) / 22, 6);   // 12 × (4 + 6) / (10 + 12)
    expect(c.yield).toBeCloseTo(0.5, 9);                // 1 + ((1 − 1) + (0 − 1)) / 2
    expect(c.usd_1k_accepted).toBeCloseTo((12 * 10) / 22 / 0.5, 6);
    expect(c.saving).toBeCloseTo(1 - (120 / 22 / 0.5) / 12, 6);   // 1 − 10.909 / 12 ≈ 0.091
    expect(c.d_cer_iv![0]).toBeLessThanOrEqual(c.d_cer_iv![1]);
    expect(c.d_cer_iv![1]).toBeLessThan(1);
    expect(c.non_inferior).toBe(true);
    expect(c.optimum).toBe(true);                       // cheaper per accepted page than live, and non-inferior
  });

  it('an excluded row and an absent setting leave the cell empty, not zero', () => {
    expect(cell(1, 'low').books).toBe(0);
    expect(cell(1, 'low').usd_1k_accepted).toBeNull();
    expect(cell(1, 'low').status).toBe('done');
    expect(cell(4, 'high').status).toBe('absent');
    expect(cell(4, 'high').non_inferior).toBeNull();
  });

  it('is reproducible: the bootstrap is seeded', () => {
    expect(buildLead(doc, 'de', { B: 400 }).cells.map((c) => c.d_cer_iv)).toEqual(L.cells.map((c) => c.d_cer_iv));
  });

  it('says the finding in one sentence, from the cells', () => {
    const s = sentence(L);
    expect(s).toContain('German, 3 books');
    expect(s).toContain('no setting changes accuracy');
    expect(s).toContain('8 pages a call at low thinking costs 9 % less per accepted page than live');
  });

  it('applies the queue weights when the doc has them', () => {
    const w = buildLead({ ...doc, weights: { de: { b1: 3, b2: 1, b3: 0 } } }, 'de', { B: 50 });
    expect(w.cells.find((c) => c.ppc === 8 && c.think === 'low')!.d_cer_pp).toBeCloseTo((3 * 0.2 + 1 * 0.4) / 4, 9);
  });

  it('reads the optional confirmation field, and names what is wrong with it', () => {
    expect(readConfirmation(FIX, 'de').state).toBe('absent');
    const good = { route: 'agy-flash-low@8', queue_pages: 25, n: 25, accepted: 22, wrong_text: 2, usd_1k_accepted: 8.78, passes: false, why: 'wrong text 2/25' };
    expect(readConfirmation({ confirmation: { de: good } }, 'de')).toEqual({ state: 'ok', c: good });
    const bad = readConfirmation({ confirmation: { de: { ...good, n: '25' } } }, 'de');
    expect(bad.state).toBe('bad');
    if (bad.state === 'bad') expect(bad.problems).toEqual(['confirmation.de.n: not a number']);
  });

  it('the colour scale is centred at 0 and fixed to the margin', () => {
    expect(cerColour(0)).toEqual(cerColour(null));      // grey: no change
    expect(cerColour(1)).toEqual(cerColour(5));         // clamps at +1 pp
    expect(cerColour(-1)[2]).toBeGreaterThan(cerColour(1)[2]);
  });
});
