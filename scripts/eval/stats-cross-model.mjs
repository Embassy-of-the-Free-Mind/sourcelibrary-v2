#!/usr/bin/env node
/**
 * Paired statistics for cross-model OCR comparisons on the pinned reference
 * set (#3235). For each challenger vs a reference model, computes per-page
 * paired deltas (page = mean char accuracy over that model's aligned runs),
 * then:
 *   - exact two-sided sign test on decisive pages (ties excluded)
 *   - Wilcoxon signed-rank (normal approximation, ties dropped)
 *   - 10k-resample bootstrap 95% CI on the mean delta
 * Pages where either model has zero aligned runs are excluded — so a result
 * reads "on pages both models can read." Alignment coverage is reported
 * alongside because it is a finding, not a nuisance.
 *
 *   node scripts/eval/stats-cross-model.mjs [--ref=gemini-3.5-flash-lite]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const REF = args.ref || 'gemini-3.5-flash-lite';

// Deterministic PRNG so the bootstrap CI is reproducible.
let seed = 0x5eed;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;

const obsDir = path.join(__dirname, 'observations');
const seen = new Set(); const rows = [];
for (const f of fs.readdirSync(obsDir).filter(f => f.endsWith('.jsonl')).sort().reverse()) {
  for (const line of fs.readFileSync(path.join(obsDir, f), 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    if (r.source === 'pipeline') continue;
    const k = `${r.run_id}|${r.slug}|${r.model}|${r.run_index}`;
    if (seen.has(k)) continue; seen.add(k); rows.push(r);
  }
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

function pageMeans(model) {
  const by = {};
  for (const r of rows.filter(r => r.model === model && r.aligned)) (by[r.slug] ??= []).push(r.char_accuracy);
  return Object.fromEntries(Object.entries(by).map(([s, a]) => [s, mean(a)]));
}

function binomTwoSided(k, n) {
  // exact two-sided sign test: 2 * P(X <= min(k, n-k)), capped at 1
  const logC = (n, k) => { let s = 0; for (let i = 0; i < k; i++) s += Math.log(n - i) - Math.log(i + 1); return s; };
  const lo = Math.min(k, n - k);
  let p = 0;
  for (let i = 0; i <= lo; i++) p += Math.exp(logC(n, i) - n * Math.LN2);
  return Math.min(1, 2 * p);
}

function wilcoxon(deltas) {
  const d = deltas.filter(x => x !== 0);
  const n = d.length;
  if (n < 6) return null;
  const ranked = d.map(x => ({ x, a: Math.abs(x) })).sort((p, q) => p.a - q.a);
  // average ranks for ties on |delta|
  const ranks = new Array(n);
  for (let i = 0; i < n;) {
    let j = i; while (j + 1 < n && ranked[j + 1].a === ranked[i].a) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let wPlus = 0;
  ranked.forEach((e, i) => { if (e.x > 0) wPlus += ranks[i]; });
  const mu = n * (n + 1) / 4, sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (wPlus - mu - Math.sign(wPlus - mu) * 0.5) / sigma;
  const phi = x => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI / 8) * x)); // logistic approx of normal CDF
  return { z, p: 2 * (1 - phi(Math.abs(z))) };
}

function bootstrapCI(deltas, iters = 10000) {
  const means = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < deltas.length; j++) s += deltas[Math.floor(rand() * deltas.length)];
    means.push(s / deltas.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

const refPages = pageMeans(REF);
const allPages = new Set(rows.map(r => r.slug));
const models = [...new Set(rows.map(r => r.model))]
  .filter(m => m !== REF && !m.includes('@w') && !m.includes('@annotated'))
  .filter(m => Object.keys(pageMeans(m)).length >= 10);

console.log(`Reference: ${REF} — aligns ${Object.keys(refPages).length}/${allPages.size} pages\n`);
const results = [];
for (const m of models) {
  const pm = pageMeans(m);
  const deltas = [];
  for (const slug of Object.keys(pm)) if (refPages[slug] != null) deltas.push(pm[slug] - refPages[slug]);
  if (deltas.length < 10) continue;
  const wins = deltas.filter(x => x > 0.002).length, losses = deltas.filter(x => x < -0.002).length;
  const decisive = deltas.filter(x => Math.abs(x) > 0.002);
  const signP = decisive.length ? binomTwoSided(decisive.filter(x => x > 0).length, decisive.length) : 1;
  const w = wilcoxon(deltas);
  const ci = bootstrapCI(deltas);
  results.push({
    model: m, pairs: deltas.length, coverage: `${Object.keys(pm).length}/${allPages.size}`,
    meanDelta: mean(deltas), ci, wins, ties: deltas.length - wins - losses, losses,
    signP, wilcoxonP: w?.p ?? null,
  });
}
results.sort((a, b) => b.meanDelta - a.meanDelta);
for (const r of results) {
  console.log(r.model.padEnd(26),
    `pages=${r.coverage}`.padEnd(12),
    `pairs=${String(r.pairs).padStart(2)}`,
    `Δ=${(100 * r.meanDelta).toFixed(2)}pp`.padStart(10),
    `95%CI[${(100 * r.ci[0]).toFixed(2)},${(100 * r.ci[1]).toFixed(2)}]`.padEnd(22),
    `W${r.wins}/T${r.ties}/L${r.losses}`.padEnd(11),
    `sign p=${r.signP.toExponential(1)}`,
    r.wilcoxonP != null ? `wilcoxon p=${r.wilcoxonP.toExponential(1)}` : '');
}
console.log('\nNotes: pairs restricted to pages BOTH models align (quality-given-coverage);');
console.log('coverage column is the finding the pairing hides. 9 comparisons — apply Holm');
console.log('correction before claiming borderline significance (p<~0.006 is safe).');
