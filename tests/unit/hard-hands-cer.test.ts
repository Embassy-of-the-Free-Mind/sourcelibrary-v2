import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs module
import { hardCer, normSefaria } from '../../scripts/eval/hard-hands-6731/hard-cer.mjs';

/**
 * The #6731 scorer (Rashi pages against Sefaria, Greek manuscripts against an edition span) is under test before any
 * score counts (eval-design.md §6, #5123): each fixture is (reference, hypothesis, expected CER ± tolerance).
 * Negative control (run 2026-10-14): dropping cleanSegment from normSefaria turns sefaria-markup red (the footnote's
 * text is charged as a reference the page never prints).
 */
const DIR = path.join(__dirname, '../../scripts/eval/fixtures/hebrew');
const fixtures = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

describe('hard-cer hebrew fixtures', () => {
  it('has the fixture set', () => expect(fixtures.length).toBeGreaterThanOrEqual(12));
  for (const fx of fixtures) {
    it(`${fx.name}: ${fx.why}`, () => {
      const r = hardCer(fx.hypothesis, fx.reference, fx.script, { refIsSefaria: fx.ref_is_sefaria });
      expect(Math.abs(r.cer - fx.expected_cer), `${fx.name} cer ${r.cer}`).toBeLessThanOrEqual(fx.tolerance + 1e-12);
    });
  }
  it('drops a Sefaria footnote with its text', () => {
    expect(normSefaria('אמר<i class="footnote">הערה</i> רבי')).toBe('אמר רבי');
  });
});

describe('hard-cer greek', () => {
  it('folds accents, breathings and final sigma; leading text is free', () => {
    const ref = 'καὶ τὸ εἶναι αὐτοῦ πᾶν ἐκεῖθεν, ἀφ’ οὗ καὶ τὸ εἶναι ὀρεκτικόν ἐστιν';
    expect(hardCer('<page-num>12</page-num>\nΠΡΟΚΛΟΥ\nκαι το ειναι αυτου παν εκειθεν αφ ου και το ειναι ορεκτικον εστιν', ref, 'greek').cer).toBe(0);
  });
});
