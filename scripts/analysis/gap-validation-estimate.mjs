#!/usr/bin/env node
/**
 * Debiased population estimate for the translation gap (#2684).
 *
 * The raw pipeline figure (2.7% of USTC-print clusters translated) is an
 * APPARENT rate from a fallible matcher. This combines the two validated strata
 * — measured precision on the pipeline-"translated" set and the measured
 * missed-translation (false-negative) rate on the pipeline-"gap" set — into a
 * bias-corrected TRUE translated fraction, weighted by the real population sizes
 * of the two strata, and post-stratified by COMPOSITION ERA (the dominant
 * confound). This is the two-stratum analogue of a Rogan–Gladen correction:
 * instead of one test's sens/spec we directly measured each stratum's confusion.
 *
 * Uncertainty: nonparametric bootstrap resampling each stratum's well-posed
 * works (5000 reps), 95% percentile interval.
 *
 * Reads:  eval-data/gap-validation-n250-results.json (rows w/ label, era, consensus)
 *         eval-data/gap-validation-n250-frame.json    (pool_sizes)
 * Writes: eval-data/gap-validation-n250-estimate.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EVAL, f), 'utf8'));

const results = rd('gap-validation-n250-results.json');
const frame = rd('gap-validation-n250-frame.json');
const POOL_T = frame.pool_sizes.translated;   // pipeline-translated population in window
const POOL_G = frame.pool_sizes.gap;          // pipeline-gap population in window
const W = POOL_T + POOL_G;
const wT = POOL_T / W, wG = POOL_G / W;

const eraClass = (e) => (e === 'antiquity' || e === 'medieval') ? 'ancmed' : (e === 'renaissance_early_modern' ? 'ren' : 'unk');

// well-posed works only (consensus is a clean binary; drop container/uncertain/null)
const wellposed = results.rows.filter((r) => r.consensus === true || r.consensus === false);
const T = wellposed.filter((r) => r.label === 'translated').map((r) => ({ era: eraClass(r.era), trans: r.consensus === true }));
const G = wellposed.filter((r) => r.label === 'gap').map((r) => ({ era: eraClass(r.era), trans: r.consensus === true }));

// one estimate from given stratum arrays
function estimate(Ts, Gs) {
  // translated fraction over a denominator restricted by an era predicate
  const frac = (pred) => {
    const Tp = Ts.filter((x) => pred(x.era)), Gp = Gs.filter((x) => pred(x.era));
    // share of each stratum that is in-denominator (era), and translated-rate within
    const pT = Ts.length ? Tp.length / Ts.length : 0;
    const pG = Gs.length ? Gp.length / Gs.length : 0;
    const rT = Tp.length ? Tp.filter((x) => x.trans).length / Tp.length : 0; // precision in era
    const rG = Gp.length ? Gp.filter((x) => x.trans).length / Gp.length : 0; // missed-translation rate in era
    const numer = wT * pT * rT + wG * pG * rG;     // P(in-era & truly translated)
    const denom = wT * pT + wG * pG;               // P(in-era)
    return denom > 0 ? numer / denom : null;
  };
  const allPrint = frac(() => true);
  const ren = frac((e) => e === 'ren');
  return { translated_allprint: allPrint, gap_allprint: 1 - allPrint, translated_ren: ren, gap_ren: 1 - ren };
}

function resample(arr) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[(Math.random() * arr.length) | 0];
  return out;
}
function pct(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))]; }

const point = estimate(T, G);
const B = 5000;
const draws = { gap_allprint: [], gap_ren: [], translated_allprint: [], translated_ren: [] };
for (let b = 0; b < B; b++) {
  const e = estimate(resample(T), resample(G));
  for (const k of Object.keys(draws)) if (e[k] != null) draws[k].push(e[k]);
}
const ci = {};
for (const k of Object.keys(draws)) {
  const s = draws[k].sort((a, b) => a - b);
  ci[k] = { point: +point[k].toFixed(4), lo: +pct(s, 0.025).toFixed(4), hi: +pct(s, 0.975).toFixed(4) };
}

// descriptive sub-rates (well-posed)
const sub = (arr, pred) => { const a = arr.filter((x) => pred(x.era)); return { n: a.length, translated: a.filter((x) => x.trans).length }; };
const desc = {
  translated_stratum: { all: sub(T, () => true), ren: sub(T, (e) => e === 'ren'), ancmed: sub(T, (e) => e === 'ancmed') },
  gap_stratum: { all: sub(G, () => true), ren: sub(G, (e) => e === 'ren'), ancmed: sub(G, (e) => e === 'ancmed') },
};

const out = {
  generated: new Date().toISOString().slice(0, 10),
  window: frame.window,
  population: { pipeline_translated: POOL_T, pipeline_gap: POOL_G, total: W, raw_gap_pct: +(100 * wG).toFixed(2) },
  note: 'Debiased TRUE translated/gap fractions via two-stratum confusion correction, weighted by population, post-stratified by composition era. 95% nonparametric bootstrap (5000 reps), well-posed works only (containers/uncertain excluded).',
  raw_pipeline: { translated_pct_window: +(100 * wT).toFixed(3), gap_pct_window: +(100 * wG).toFixed(3) },
  debiased: ci,
  well_posed_subrates: desc,
  excluded_illposed: results.rows.filter((r) => r.consensus == null).length,
};
fs.writeFileSync(path.join(EVAL, 'gap-validation-n250-estimate.json'), JSON.stringify(out, null, 2));

const f = (c) => `${(100 * c.point).toFixed(1)}% [${(100 * c.lo).toFixed(1)}–${(100 * c.hi).toFixed(1)}]`;
console.log(`\n=== DEBIASED POPULATION ESTIMATE (window ${frame.window[0]}–${frame.window[1]}) ===`);
console.log(`Population: ${POOL_T.toLocaleString()} pipeline-translated + ${POOL_G.toLocaleString()} pipeline-gap = ${W.toLocaleString()}`);
console.log(`Raw pipeline gap (apparent):        ${(100 * wG).toFixed(1)}% untranslated`);
console.log(`\nDEBIASED gap — ALL-PRINT denominator:        ${f(ci.gap_allprint)}  (translated ${f(ci.translated_allprint)})`);
console.log(`DEBIASED gap — RENAISSANCE-composed only:    ${f(ci.gap_ren)}  (translated ${f(ci.translated_ren)})`);
console.log(`\nWell-posed sub-rates (translated-stratum precision / gap-stratum missed):`);
console.log(`  translated-stratum precision: all ${desc.translated_stratum.all.translated}/${desc.translated_stratum.all.n}, ren ${desc.translated_stratum.ren.translated}/${desc.translated_stratum.ren.n}, anc/med ${desc.translated_stratum.ancmed.translated}/${desc.translated_stratum.ancmed.n}`);
console.log(`  gap-stratum translated(missed): all ${desc.gap_stratum.all.translated}/${desc.gap_stratum.all.n}, ren ${desc.gap_stratum.ren.translated}/${desc.gap_stratum.ren.n}, anc/med ${desc.gap_stratum.ancmed.translated}/${desc.gap_stratum.ancmed.n}`);
console.log(`  ill-posed/uncertain excluded: ${out.excluded_illposed}/${results.rows.length}`);
console.log(`\nwrote gap-validation-n250-estimate.json`);
