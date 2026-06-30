#!/usr/bin/env node
/**
 * score-work-gold-set.mjs — score the labeled work-identity gold set.
 *
 * Given one or two labeled JSONL files (from build-work-gold-set.mjs, with `label`
 * filled in ∈ {same,different,ambiguous}), compute:
 *   - PROBE precision per stratum (does the probe's prediction match the human?),
 *   - Cohen's κ between two labelers (inter-rater reliability) when two files given,
 *   - overall and per-tradition rollups.
 *
 * No DB, no tokens. Pure measurement.
 *
 * Usage:
 *   node scripts/eval/score-work-gold-set.mjs labeled.jsonl
 *   node scripts/eval/score-work-gold-set.mjs labelerA.jsonl labelerB.jsonl
 */
import fs from 'fs';

const files = process.argv.slice(2).filter((a) => a.endsWith('.jsonl'));
if (!files.length) { console.error('Usage: score-work-gold-set.mjs labeled.jsonl [labelerB.jsonl]'); process.exit(1); }
const load = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const norm = (l) => (l || '').trim().toLowerCase();

function cohenKappa(pairs) {
  // pairs: [{a,b}] of two labelers' labels over the same items (a,b ∈ categories)
  const cats = ['same', 'different', 'ambiguous'];
  const n = pairs.length; if (!n) return null;
  let agree = 0; const ma = {}, mb = {};
  for (const p of pairs) { if (p.a === p.b) agree++; ma[p.a] = (ma[p.a] || 0) + 1; mb[p.b] = (mb[p.b] || 0) + 1; }
  const po = agree / n;
  let pe = 0; for (const c of cats) pe += ((ma[c] || 0) / n) * ((mb[c] || 0) / n);
  return { kappa: (po - pe) / (1 - pe || 1), po, pe, n };
}

const A = load(files[0]);
const B = files[1] ? load(files[1]) : null;

// consensus label for probe scoring: if two labelers, use agreed label; drop disagreements + ambiguous
const byId = new Map(A.map((r) => [r.pair_id, r]));
const labeled = [];
for (const r of A) {
  let lab = norm(r.label);
  if (B) { const r2 = (B.find((x) => x.pair_id === r.pair_id) || {}); const l2 = norm(r2.label); if (lab !== l2) { lab = '__disagree__'; } }
  labeled.push({ ...r, _label: lab });
}

// ── Probe precision per stratum ───────────────────────────────────────────────
const strata = {};
for (const r of labeled) {
  if (!['same', 'different'].includes(r._label)) continue; // skip ambiguous/disagree/unlabeled
  const s = (strata[r.stratum] = strata[r.stratum] || { n: 0, correct: 0, same: 0, diff: 0 });
  s.n++;
  if (r._label === 'same') s.same++; else s.diff++;
  if (norm(r.probe_prediction) === r._label) s.correct++;
}
console.log('── PROBE prediction vs human label (per stratum) ──');
console.log('  stratum'.padEnd(20) + 'n'.padStart(5) + 'same'.padStart(6) + 'diff'.padStart(6) + 'probe-acc'.padStart(11));
for (const [s, v] of Object.entries(strata).sort()) {
  const acc = v.n ? (100 * v.correct / v.n).toFixed(0) + '%' : '—';
  console.log(`  ${s.padEnd(18)}${String(v.n).padStart(5)}${String(v.same).padStart(6)}${String(v.diff).padStart(6)}${acc.padStart(11)}`);
}

// derived: over-split precision (oversplit_* + anchor_miss: fraction truly same),
// over-merge precision (overmerge: fraction truly different)
const frac = (names, want) => {
  let n = 0, hit = 0;
  for (const r of labeled) { if (!names.includes(r.stratum) || !['same', 'different'].includes(r._label)) continue; n++; if (r._label === want) hit++; }
  return n ? `${hit}/${n} = ${(100 * hit / n).toFixed(0)}%` : 'n/a';
};
console.log('\n── Derived probe quality ──');
console.log(`  over-split precision (oversplit_high+med+anchor truly SAME): ${frac(['oversplit_high', 'oversplit_med', 'anchor_miss'], 'same')}`);
console.log(`  over-split HIGH only (truly SAME):                          ${frac(['oversplit_high'], 'same')}`);
console.log(`  over-merge precision (overmerge truly DIFFERENT):           ${frac(['overmerge'], 'different')}`);
console.log(`  resolver precision on ordinary clusters (random_within SAME):${frac(['random_within'], 'same')}`);
console.log(`  control sanity (control_same SAME / control_diff DIFF):     ${frac(['control_same'], 'same')} / ${frac(['control_diff'], 'different')}`);

// ── Inter-rater κ ─────────────────────────────────────────────────────────────
if (B) {
  const pairs = [];
  for (const r of A) { const r2 = B.find((x) => x.pair_id === r.pair_id); if (r2 && norm(r.label) && norm(r2.label)) pairs.push({ a: norm(r.label), b: norm(r2.label) }); }
  const k = cohenKappa(pairs);
  console.log('\n── Inter-rater reliability (Cohen κ) ──');
  if (k) console.log(`  κ = ${k.kappa.toFixed(3)}  (observed agreement ${(100 * k.po).toFixed(0)}%, chance ${(100 * k.pe).toFixed(0)}%, n=${k.n})`);
  // κ per stratum (where the grain boundary is)
  console.log('  κ by stratum:');
  const byStr = {};
  for (const r of A) { const r2 = B.find((x) => x.pair_id === r.pair_id); if (r2 && norm(r.label) && norm(r2.label)) (byStr[r.stratum] = byStr[r.stratum] || []).push({ a: norm(r.label), b: norm(r2.label) }); }
  for (const [s, ps] of Object.entries(byStr).sort()) { const kk = cohenKappa(ps); console.log(`    ${s.padEnd(18)} κ=${kk ? kk.kappa.toFixed(2) : '—'} (n=${ps.length})`); }
} else {
  const unl = A.filter((r) => !norm(r.label)).length;
  console.log(`\n(one file — no κ. ${unl}/${A.length} pairs still unlabeled. Provide a second labeler's file for κ.)`);
}
