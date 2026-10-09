import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs module
import { syriacCer, foldSyriac } from '../../scripts/eval/syriac-pareto-6295/syriac-cer.mjs';

/**
 * The Syriac scorer behind the /quality/pareto Syriac panel (#6295) is under test before any score counts
 * (eval-design.md §6, #5123): each fixture is (reference, hypothesis, expected CER ± tolerance).
 * Negative control (run 2026-10-08): dropping the \p{M} strip in foldSyriac turns seyame-and-marks red.
 */
const DIR = path.join(__dirname, '../../scripts/eval/fixtures/syriac');
const fixtures = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

describe('syriac-cer fixtures', () => {
  it('has the fixture set', () => expect(fixtures.length).toBeGreaterThanOrEqual(12));
  for (const fx of fixtures) {
    it(`${fx.name}: ${fx.why}`, () => {
      const r = syriacCer(fx.hypothesis, fx.reference);
      expect(Math.abs(r.cer - fx.expected_cer), `${fx.name} cer ${r.cer}`).toBeLessThanOrEqual(fx.tolerance + 1e-12);
    });
  }
  it('folds to consonants and word breaks only', () => {
    expect(foldSyriac('ܡܰܠܟ݁ܳܐ, rex 3 ܀')).toBe('ܡܠܟܐ');
  });
});
