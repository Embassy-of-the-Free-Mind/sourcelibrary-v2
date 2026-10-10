#!/usr/bin/env node
/**
 * PRIOR ART: none for this study; the #6338 sample-size comment (2026-10-08) sized the sample analytically for
 * recall and agreement, not for the decision rule. This simulates the DECISION RULE itself, before any data, to
 * check it can detect the gain it is looking for (amendment 1 of the preregistration).
 *
 *   node scripts/eval/second-reader/power.mjs [--reps 2000]
 *
 * Model per page: true serious issues ~ Poisson(λ), λ = 1.2 on flagged pages and 0.35 on the rest (flagged books
 * ≈ 5% of the frame, a third of the sample); the primary finds each issue with pA = 0.6; the control re-finds a
 * primary miss with qB = 0.2 (two Opus runs flip 4–7 pages of 96, #6174); the candidate finds a primary miss with
 * qG. Every number here is an assumption, chosen to be plausible, not measured: the point is the RELATIVE power of
 * the rules, which is robust to them. Rules compared:
 *   A. the first preregistered rule: block 2 only, weighted page-level gain ≥ 5/100 with the 95% interval above 0;
 *   B. the amended rule, one script: all natural pages, one-sided sign test on the primary's misses (b vs c) at
 *      0.025, and the weighted gain point estimate ≥ 3/100;
 *   C. rule B pooled over three scripts.
 */
import { makeRng } from '../lib/paired-stats.mjs';
import { signTestOneSided } from './lib.mjs';

const REPS = Number(process.argv[process.argv.indexOf('--reps') + 1]) || 2000;
const rng = makeRng(6338);
const pois = (l) => { let k = 0, p = Math.exp(-l), s = p; const u = rng(); while (u > s) { k++; p *= l / k; s += p; } return k; };
const bern = (p) => (rng() < p ? 1 : 0);
const BASE = { lamF: 1.2, lamU: 0.35, pA: 0.6, qB: 0.2, flaggedShare: 1 / 3, popFlagged: 0.05 };
const popLam = (1 - BASE.popFlagged) * BASE.lamU + BASE.popFlagged * BASE.lamF;
const trueGain = (qG) => 100 * popLam * (1 - BASE.pA) * (qG - BASE.qB);

function pages(n, qG) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const flagged = rng() < BASE.flaggedShare;
    const w = flagged ? BASE.popFlagged / BASE.flaggedShare : (1 - BASE.popFlagged) / (1 - BASE.flaggedShare);
    let g = 0, b = 0, c = 0;
    for (let k = pois(flagged ? BASE.lamF : BASE.lamU); k > 0; k--) if (!bern(BASE.pA)) { const G = bern(qG), B = bern(BASE.qB); g += G - B; b += G && !B; c += B && !G; }
    out.push({ w, g, b, c });
  }
  return out;
}
const wmean = (ps) => ps.reduce((s, p) => s + p.w * p.g, 0) / ps.reduce((s, p) => s + p.w, 0);
function ruleA(ps) {  // weighted gain ≥ 5/100 and the 95% bootstrap interval above 0
  const est = wmean(ps), boots = [];
  for (let t = 0; t < 400; t++) boots.push(wmean(Array.from({ length: ps.length }, () => ps[Math.floor(rng() * ps.length)])));
  boots.sort((x, y) => x - y);
  return est * 100 >= 5 && boots[10] > 0;
}
const ruleB = (ps) => signTestOneSided(ps.reduce((s, p) => s + p.b, 0), ps.reduce((s, p) => s + p.c, 0)) < 0.025 && wmean(ps) * 100 >= 3;

const rows = [];
for (const qG of [0.2, 0.4, 0.5, 0.6, 0.8]) {
  const p = (fn, n) => { let y = 0; for (let r = 0; r < REPS; r++) y += fn(pages(n, qG)); return y / REPS; };
  rows.push({ qG, true_gain_per100: +trueGain(qG).toFixed(1), A_block2_36: p(ruleA, 36), B_one_script_72: p(ruleB, 72), C_pooled_216: p(ruleB, 216) });
}
console.log(`P(adopt) by true gain (${REPS} simulated studies each; natural pages ≈ 72% of 100 per script)`);
console.table(rows);
