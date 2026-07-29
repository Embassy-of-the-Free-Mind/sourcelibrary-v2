#!/usr/bin/env node
/**
 * Analysis for the prompt ablation (#3444). Implements exactly the comparisons
 * pre-registered in scripts/eval/PREREGISTRATION-prompt-ablation.md — the point of
 * writing the analysis before the run is that the decision rules cannot be chosen
 * after seeing the numbers.
 *
 * Usage: node scripts/eval/report-ablation.mjs [summary.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || (() => {
  const dir = path.join(__dirname, 'results');
  const f = fs.readdirSync(dir).filter(x => x.startsWith('ablation-summary-')).sort().pop();
  return f && path.join(dir, f);
})();
if (!file || !fs.existsSync(file)) { console.error('No ablation summary found.'); process.exit(1); }
const { rows, models, arms } = JSON.parse(fs.readFileSync(file, 'utf8'));

const pct = (v, d = 1) => v === null || Number.isNaN(v) ? '   n/a' : (v * 100).toFixed(d) + '%';

/**
 * Char-weighted accuracy over ALIGNED runs. Weighting by reference length stops a
 * short passage counting as much as a long one, and matches how the scorecard
 * aggregates so numbers are comparable across studies.
 */
function accuracy(rs) {
  const a = rs.filter(r => r.aligned && r.charAccuracy !== null);
  if (!a.length) return null;
  const refTotal = a.reduce((s, r) => s + r.refChars, 0);
  return a.reduce((s, r) => s + r.refChars * r.charAccuracy, 0) / refTotal;
}
/** Unconditional: a run that failed to align scores 0, not "excluded". */
function accuracyRaw(rs) {
  if (!rs.length) return null;
  const refTotal = rs.reduce((s, r) => s + r.refChars, 0);
  if (!refTotal) return null;
  return rs.reduce((s, r) => s + r.refChars * (r.aligned ? r.charAccuracy : 0), 0) / refTotal;
}
const rate = (rs, f) => rs.length ? rs.filter(f).length / rs.length : null;
const sel = (model, arm) => rows.filter(r => r.model === model && r.arm === arm);

console.log(`\n  ${path.basename(file)} — ${rows.length} scored runs\n`);

// ── 1. Accuracy by arm ───────────────────────────────────────────────
console.log('  ACCURACY (char-weighted; raw = unaligned counted as 0)\n');
console.log(`  ${'Model'.padEnd(24)} ${'Arm'.padEnd(22)} ${'aligned'.padStart(8)} ${'acc'.padStart(7)} ${'raw'.padStart(7)} ${'$/page'.padStart(8)}`);
console.log('  ' + '─'.repeat(80));
for (const model of models) {
  for (const arm of arms) {
    const rs = sel(model, arm);
    if (!rs.length) continue;
    const cost = rs.reduce((s, r) => s + r.costUsd, 0) / rs.length;
    console.log(`  ${model.slice(0, 23).padEnd(24)} ${(arm + ' ' + (rs[0].armLabel || '')).padEnd(22)} `
      + `${`${rs.filter(r => r.aligned).length}/${rs.length}`.padStart(8)} ${pct(accuracy(rs)).padStart(7)} ${pct(accuracyRaw(rs)).padStart(7)} ${('$' + cost.toFixed(5)).padStart(8)}`);
  }
}

// ── 2. Pre-registered contrasts ──────────────────────────────────────
console.log('\n  PRE-REGISTERED CONTRASTS (accuracy delta, percentage points)\n');
const CONTRASTS = [
  ['A', 'C', 'cost of the intervention vs bare ceiling'],
  ['B', 'C', 'proposed vs today (the shipping decision)'],
  ['D', 'C', 'two-call vs one-call (task interference)'],
  ['A', 'B', 'cost of today\'s tags vs bare ceiling'],
];
for (const model of models) {
  for (const [x, y, why] of CONTRASTS) {
    if (!arms.includes(x) || !arms.includes(y)) continue;
    const ax = accuracy(sel(model, x)), ay = accuracy(sel(model, y));
    if (ax === null || ay === null) continue;
    const d = (ay - ax) * 100;
    const flag = d < -1.0 ? ' \x1b[31m← exceeds −1.0pp tolerance\x1b[0m' : '';
    console.log(`  ${model.slice(0, 23).padEnd(24)} ${y} − ${x} = ${(d >= 0 ? '+' : '') + d.toFixed(2)}pp   ${why}${flag}`);
  }
}

// ── 3. Flag firing ───────────────────────────────────────────────────
// The headline: the required field must fire on ~100% of pages, and must NOT
// fire "positive" on everything — an always-on flag is as useless as an
// always-off one, which is why cleanliness on baseline pages is scored too.
console.log('\n  FLAG FIRING\n');
console.log(`  ${'Model'.padEnd(24)} ${'Arm'.padEnd(22)} ${'field'.padStart(7)} ${'none'.padStart(7)} ${'margnla'.padStart(8)} ${'obscurd'.padStart(8)} ${'<script>'.padStart(9)} ${'prose'.padStart(7)}`);
console.log('  ' + '─'.repeat(96));
for (const model of models) {
  for (const arm of arms) {
    const rs = sel(model, arm);
    if (!rs.length) continue;
    const withField = rs.filter(r => r.conditionsPresent);
    console.log(`  ${model.slice(0, 23).padEnd(24)} ${(arm + ' ' + (rs[0].armLabel || '')).padEnd(22)} `
      + `${pct(rate(rs, r => r.conditionsPresent)).padStart(7)} `
      + `${pct(rate(withField, r => r.conditions && r.conditions.length === 0)).padStart(7)} `
      + `${pct(rate(rs, r => r.conditions?.includes('marginalia'))).padStart(8)} `
      + `${pct(rate(rs, r => r.conditions?.includes('obscured'))).padStart(8)} `
      + `${pct(rate(rs, r => r.script)).padStart(9)} `
      + `${pct(rate(rs, r => r.mentionsMask)).padStart(7)}`);
  }
}

// ── 4. Self-consistency ──────────────────────────────────────────────
// A mandatory assertion earns its keep by being checkable against the tags the
// same output emitted. These contradictions need no ground truth and no second
// model, so they can gate a re-run in the worker.
console.log('\n  SELF-CONTRADICTIONS (asserted vs transcribed — checkable at write time)\n');
for (const model of models) {
  for (const arm of arms) {
    const rs = sel(model, arm).filter(r => r.conditionsPresent);
    if (!rs.length) continue;
    const saysMargNoTags = rs.filter(r => r.conditions?.includes('marginalia') && r.marginTags + r.glossTags === 0);
    const tagsNoSaysMarg = rs.filter(r => !r.conditions?.includes('marginalia') && r.marginTags + r.glossTags > 0);
    console.log(`  ${model.slice(0, 23).padEnd(24)} ${arm}  claims marginalia w/o tags: ${String(saysMargNoTags.length).padStart(3)}/${String(rs.length).padEnd(4)}`
      + `  tags w/o claim: ${String(tagsNoSaysMarg.length).padStart(3)}/${rs.length}`);
  }
}

// ── 5. Occlusion arm ─────────────────────────────────────────────────
const occ = rows.filter(r => (r.armSuffix || '').includes('@occR'));
if (occ.length) {
  console.log('\n  OCCLUDED PAGES — does the required field catch the mask?');
  console.log('  (occlusion pilot baseline: 1 of 28 runs mentioned the mask in prose)\n');
  for (const model of models) {
    for (const arm of arms) {
      const rs = occ.filter(r => r.model === model && r.arm === arm);
      if (!rs.length) continue;
      console.log(`  ${model.slice(0, 23).padEnd(24)} ${arm}  obscured-flag ${pct(rate(rs, r => r.conditions?.includes('obscured')))}`
        + `   prose-mention ${pct(rate(rs, r => r.mentionsMask))}   n=${rs.length}`);
    }
  }
  // Canonical pages are where a reciting model reconstructs through the mask, so
  // the flag matters most there — and is least likely to fire, since the model
  // has no felt experience of a gap.
  const byCanon = c => occ.filter(r => r.canonical === c);
  if (byCanon(true).length && byCanon(false).length) {
    console.log(`\n    canonical      obscured-flag ${pct(rate(byCanon(true), r => r.conditions?.includes('obscured')))}  n=${byCanon(true).length}`);
    console.log(`    non-canonical  obscured-flag ${pct(rate(byCanon(false), r => r.conditions?.includes('obscured')))}  n=${byCanon(false).length}`);
  }
}

// ── 6. Vocabulary usage ──────────────────────────────────────────────
// Terms that never fire are prompt weight with no return; terms outside the
// closed list mean the vocabulary is missing a real condition.
const vocabCount = {};
const unknown = {};
for (const r of rows) {
  for (const c of r.conditions || []) vocabCount[c] = (vocabCount[c] || 0) + 1;
  for (const u of r.unknownTerms || []) unknown[u] = (unknown[u] || 0) + 1;
}
if (Object.keys(vocabCount).length) {
  console.log('\n  VOCABULARY USE (terms firing zero times are candidates for removal)\n');
  const used = Object.entries(vocabCount).sort((a, b) => b[1] - a[1]);
  console.log('    ' + used.map(([k, v]) => `${k}:${v}`).join('  '));
}
if (Object.keys(unknown).length) {
  console.log('\n  \x1b[33mOFF-VOCABULARY TERMS\x1b[0m (the closed list may be missing a real condition)\n');
  console.log('    ' + Object.entries(unknown).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
}
console.log();
