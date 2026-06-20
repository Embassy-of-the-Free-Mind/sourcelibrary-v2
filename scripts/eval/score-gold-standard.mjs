#!/usr/bin/env node
/**
 * score-gold-standard.mjs — aggregate human gold-standard labels into the paper/eval numbers.
 *
 * Takes one or more exported label files from ft-gold-annotator.html and computes:
 *  1. STRATIFIED base-rate estimate of genuine-first prevalence (flag precision),
 *     re-weighted by stratum population, with a Wilson CI.
 *  2. Corpus projection (× population of flagged-first).
 *  3. Inter-annotator agreement (Cohen's kappa, coarse class) when ≥2 files given.
 *  4. Model RECALIBRATION: each LLM's sensitivity/specificity vs the human gold
 *     (using the `ai` verdicts stored with each item), and the bias-corrected base rate.
 *
 * USAGE:
 *   node scripts/eval/score-gold-standard.mjs ft-gold-labels-alice.json [ft-gold-labels-bob.json ...]
 *   (paths relative to scripts/output/ or absolute)
 *
 * POPULATION: pass --pop N (default reads ft-gold-candidates.json meta, else 5732).
 */
import fs from 'fs';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const popArg = (() => { const i = process.argv.indexOf('--pop'); return i > -1 ? parseInt(process.argv[i + 1], 10) : null; })();
if (!args.length) { console.error('usage: score-gold-standard.mjs <labels.json> [labels2.json ...]'); process.exit(1); }

const FIRST = new Set(['first_no_prior', 'first_from_source', 'first_complete', 'first_modern']);
const coarse = v => !v ? null : FIRST.has(v) ? 'FIRST' : v === 'not_first' ? 'NOT_FIRST' : v === 'not_applicable' ? 'NA' : v === 'unverifiable' ? 'UNVERIF' : null;
const load = p => JSON.parse(fs.readFileSync(p.includes('/') ? p : `scripts/output/${p}`, 'utf8'));

let POP = popArg;
try { if (!POP) POP = load('ft-gold-candidates.json').meta.population; } catch {}
POP = POP || 5732;

const files = args.map(load);
const primary = files[0];
const labs = primary.labels.filter(x => x.verdict);
console.log(`Primary annotator: ${primary.annotator || '?'} — ${labs.length}/${primary.labels.length} labeled. Corpus pop=${POP}.\n`);

// --- 1+2. stratified base rate (treat UNVERIF two ways: floor=not-first, ceil=first) ---
const byStratum = {};
for (const x of labs) { const s = x.stratum || 'NA'; (byStratum[s] = byStratum[s] || []).push(x); }
function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n; const cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, cc - h), Math.min(1, cc + h)]; }
let popSum = 0, weightedFloor = 0, weightedCeil = 0, varSum = 0;
console.log('Per-stratum (genuine-first rate; UNVERIF excluded from numerator for floor):');
for (const [s, arr] of Object.entries(byStratum)) {
  const W = arr[0].stratum_pop || arr.length;
  const first = arr.filter(x => coarse(x.verdict) === 'FIRST').length;
  const unv = arr.filter(x => coarse(x.verdict) === 'UNVERIF').length;
  const n = arr.length;
  const pf = first / n, pc = (first + unv) / n;
  popSum += W; weightedFloor += W * pf; weightedCeil += W * pc;
  varSum += (W / POP) ** 2 * (pf * (1 - pf) / Math.max(1, n - 1));
  console.log(`  ${s.padEnd(22)} n=${String(n).padStart(3)} pop=${String(W).padStart(5)}  first=${first} unv=${unv}  rate ${Math.round(pf*100)}%–${Math.round(pc*100)}%`);
}
const baseFloor = weightedFloor / popSum, baseCeil = weightedCeil / popSum;
const se = Math.sqrt(varSum); const ci = 1.96 * se;
console.log(`\nSTRATIFIED base rate (flag precision): ${(baseFloor*100).toFixed(0)}%–${(baseCeil*100).toFixed(0)}%  (±${(ci*100).toFixed(0)}% at floor)`);
console.log(`Corpus genuine-firsts of ${POP}: ${Math.round(baseFloor*POP)}–${Math.round(baseCeil*POP)}`);

// --- 3. inter-annotator kappa (coarse) ---
if (files.length >= 2) {
  const m = {}; for (const x of primary.labels) m[x.i] = coarse(x.verdict);
  const o = {}; for (const x of files[1].labels) o[x.i] = coarse(x.verdict);
  const ids = Object.keys(m).filter(i => m[i] && o[i]);
  const cats = ['FIRST', 'NOT_FIRST', 'NA', 'UNVERIF'];
  let agree = 0; const pa = {}, pb = {};
  for (const i of ids) { if (m[i] === o[i]) agree++; pa[m[i]] = (pa[m[i]] || 0) + 1; pb[o[i]] = (pb[o[i]] || 0) + 1; }
  const po = agree / ids.length;
  let pe = 0; for (const c of cats) pe += (pa[c] || 0) / ids.length * ((pb[c] || 0) / ids.length);
  const kappa = (po - pe) / (1 - pe);
  console.log(`\nInter-annotator agreement (n=${ids.length}): raw ${Math.round(po*100)}% · Cohen's κ = ${kappa.toFixed(2)}`);
}

// --- 4. model recalibration vs human gold ---
console.log('\nModel recalibration vs human gold (where AI verdict stored):');
for (const model of ['sonnet', 'lite']) {
  const pairs = labs.filter(x => x.ai && x.ai[model]).map(x => ({ human: coarse(x.verdict), ai: coarse(x.ai[model]) }));
  if (!pairs.length) { console.log(`  ${model}: no stored verdicts`); continue; }
  const firstHuman = pairs.filter(p => p.human === 'FIRST');
  const nonFirstHuman = pairs.filter(p => p.human === 'NOT_FIRST' || p.human === 'NA');
  const sens = firstHuman.length ? firstHuman.filter(p => p.ai === 'FIRST').length / firstHuman.length : null;
  const spec = nonFirstHuman.length ? nonFirstHuman.filter(p => p.ai !== 'FIRST').length / nonFirstHuman.length : null;
  const acc = pairs.filter(p => p.human === p.ai).length / pairs.length;
  console.log(`  ${model.padEnd(7)} n=${pairs.length}  acc=${Math.round(acc*100)}%  sens=${sens!=null?sens.toFixed(2):'-'}  spec=${spec!=null?spec.toFixed(2):'-'}`);
  if (sens != null && spec != null && sens + spec - 1 > 0.05) {
    const obs = baseFloor; const corr = (obs + spec - 1) / (sens + spec - 1);
    console.log(`           bias-corrected base rate via ${model}: ${(Math.max(0,Math.min(1,corr))*100).toFixed(0)}%`);
  }
}
