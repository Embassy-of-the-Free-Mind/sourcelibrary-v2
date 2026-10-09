#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/paired-stats.mjs (bootstrap + sign test helpers) and the paired block benchmark-score.mjs
// writes; neither states the preregistered Batch-vs-realtime rule of #6293, which this applies and nothing else.
/**
 * transport-check.mjs — #6293 prereg "Transport check": lite through Batch vs the stored realtime lite read, same 40 pages.
 * Pass: |median CER(batch) − median CER(stored)| ≤ 0.01 on pages both answered with a reference, AND the bootstrap 95 % CI
 * of the paired median Δ (seed 6293, 2,000 resamples) includes 0.
 *   node scripts/eval/ocr-pareto-6293/transport-check.mjs <scored dir> [--out=<json>]
 */
import fs from 'node:fs';
import { readBenchmarkRows } from '../lib/benchmark-rows.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const dir = process.argv[2];
const out = (process.argv.find((a) => a.startsWith('--out=')) || '').slice(6);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const { rows } = readBenchmarkRows(dir);
const by = new Map();
for (const r of rows) if (r.referenced && r.aligned && r.cer != null && !r.refused) (by.get(`${r.stratum}|${r.slug}`) || by.set(`${r.stratum}|${r.slug}`, {}).get(`${r.stratum}|${r.slug}`))[r.engine] = r.cer;
const pairs = [...by].filter(([, e]) => e['gemini-3.1-flash-lite'] != null && e['gemini-3.1-flash-lite-batch'] != null)
  .map(([k, e]) => ({ page: k, stored: e['gemini-3.1-flash-lite'], batch: e['gemini-3.1-flash-lite-batch'] }));
const d = pairs.map((p) => p.stored - p.batch);
const rand = makeRng(6293); const meds = [];
for (let b = 0; b < 2000; b++) { const s = []; for (let i = 0; i < d.length; i++) s.push(d[Math.floor(rand() * d.length)]); meds.push(median(s)); }
meds.sort((a, b) => a - b);
const ci = [meds[50], meds[1949]];
const res = {
  n: pairs.length, median_cer_stored: median(pairs.map((p) => p.stored)), median_cer_batch: median(pairs.map((p) => p.batch)),
  median_delta_stored_minus_batch: median(d), delta_ci95: ci,
  wins_batch: d.filter((x) => x > 0.001).length, losses_batch: d.filter((x) => x < -0.001).length, ties: d.filter((x) => Math.abs(x) <= 0.001).length,
};
res.pass = Math.abs(res.median_cer_batch - res.median_cer_stored) <= 0.01 && ci[0] <= 0 && ci[1] >= 0;
console.log(JSON.stringify(res, null, 1));
if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
