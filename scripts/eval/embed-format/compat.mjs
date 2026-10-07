#!/usr/bin/env node
/**
 * PRIOR ART: none — looked in scripts/eval/INDEX.md and scripts/eval/lib/ for a
 * model-to-model vector comparison; src/lib/embeddings.ts only records (in a
 * comment) that gemini-embedding-001 and -2-preview do NOT share a space (#3193).
 *
 * compat — arm 6 of #6170: are `gemini-embedding-2-preview` and the GA
 * `gemini-embedding-2` the same function?
 *
 *   --write-sample   500 pool rows (A: 250 spread evenly over the four languages;
 *                    B: 250 at random; seed 6170) → <dir>/<pool>/sample.json.
 *                    Then embed them with the preview model:
 *                    embed.mjs --docs --pool P --model preview --format F --sample
 *   (default)        compare, per format: preview sample vectors vs the GA vectors
 *                    of the same rows (cosine at 3072/1536/768, largest component
 *                    difference); the 71 queries × 3 forms, preview vs GA; the API's
 *                    own 768 vs the cut 3072 (already 1.00000 in the probe); and
 *                    production's STORED vector vs a fresh plain embed of today's
 *                    text (how far the store has drifted from the text).
 *
 *   node scripts/eval/embed-format/compat.mjs --dir D [--write-sample] [--json out.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../lib/paired-stats.mjs';
import { arg, has, readJsonl, loadMatrix, rowAt, cut, dot, FULL_DIMS, SEED } from './common.mjs';

const DIR = arg('--dir');
const pools = { A: readJsonl(path.join(DIR, 'A/pool.jsonl')), B: readJsonl(path.join(DIR, 'B/pool.jsonl')) };

if (has('--write-sample')) {
  const rng = makeRng(SEED);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const langs = ['Latin', 'German', 'French', 'Chinese'];
  const a = langs.flatMap((l, k) => shuffle(pools.A.map((r, i) => (r.lang === l ? i : -1)).filter((i) => i >= 0)).slice(0, k < 2 ? 63 : 62));
  const b = shuffle(pools.B.map((_, i) => i)).slice(0, 250);
  fs.writeFileSync(path.join(DIR, 'A/sample.json'), JSON.stringify(a.sort((x, y) => x - y)));
  fs.writeFileSync(path.join(DIR, 'B/sample.json'), JSON.stringify(b.sort((x, y) => x - y)));
  console.log(`sample: A ${a.length}, B ${b.length}`);
  process.exit(0);
}

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const dist = (xs) => { const s = [...xs].sort((x, y) => x - y); return { n: s.length, min: s[0], p01: q(s, 0.01), p05: q(s, 0.05), median: q(s, 0.5), mean: s.reduce((t, x) => t + x, 0) / s.length }; };
const out = { docs: {}, queries: {}, stored_vs_fresh: {} };

for (const pool of ['A', 'B']) {
  const sample = JSON.parse(fs.readFileSync(path.join(DIR, pool, 'sample.json'), 'utf8'));
  for (const format of ['plain', 'prefix']) {
    const pf = path.join(DIR, pool, `doc-preview-${format}.sample.f32`);
    const gf = path.join(DIR, pool, `doc-ga-${format}.f32`);
    if (!fs.existsSync(pf) || !fs.existsSync(gf)) continue;
    const P = loadMatrix(pf, FULL_DIMS), G = loadMatrix(gf, FULL_DIMS);
    const r = { n: sample.length, maxAbsDiff: 0 };
    for (const d of [3072, 1536, 768]) r[`cos${d}`] = dist(sample.map((i, k) => dot(rowAt(P, k, d), rowAt(G, i, d))));
    sample.forEach((i, k) => { for (let c = 0; c < FULL_DIMS; c++) r.maxAbsDiff = Math.max(r.maxAbsDiff, Math.abs(P.data[k * FULL_DIMS + c] - G.data[i * FULL_DIMS + c])); });
    out.docs[`${pool}-${format}`] = r;
  }
  // Production's stored vector vs a fresh plain embed of the text the pool holds today.
  const sf = path.join(DIR, pool, 'stored.f32'), gf = path.join(DIR, pool, 'doc-ga-plain.f32');
  if (fs.existsSync(sf) && fs.existsSync(gf)) {
    const S = loadMatrix(sf, 768), G = loadMatrix(gf, FULL_DIMS);
    const mask = JSON.parse(fs.readFileSync(path.join(DIR, pool, 'stored-mask.json'), 'utf8'));
    const cs = [];
    mask.forEach((m, i) => { if (m === 1) cs.push(dot(rowAt(S, i), rowAt(G, i, 768))); });
    out.stored_vs_fresh[pool] = { ...dist(cs), share_ge_0999: cs.filter((c) => c >= 0.999).length / cs.length, share_lt_095: cs.filter((c) => c < 0.95).length / cs.length };
  }
}
const Q = JSON.parse(fs.readFileSync(path.join(DIR, 'queries.json'), 'utf8'));
for (const set of ['A', 'B']) for (const form of ['plain', 'search', 'qa']) {
  const ids = Object.keys(Q[set][`ga-${form}`]);
  out.queries[`${set}-${form}`] = dist(ids.map((id) => dot(cut(Q[set][`preview-${form}`][id], 768), cut(Q[set][`ga-${form}`][id], 768))));
}
console.log(JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(6)) : v), 1));
if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out, null, 1));
