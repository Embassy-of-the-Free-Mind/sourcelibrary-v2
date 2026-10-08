#!/usr/bin/env node
// PRIOR ART: scripts/eval/build-ocr-pareto.mjs (median CER, accuracy = 1 − median, seeded bootstrap of the median —
// over PAGES); this resamples EDITIONS, as the #6295 preregistration fixes (four editions are held twice), and
// applies the two preregistered OCR rules. lib/paired-stats.mjs makeRng is the seeded stream.
/**
 * analyze-ocr.mjs — $0. Reads results/syriac-pareto-6295/ocr-score.json, writes results/syriac-pareto-6295/ocr-summary.json.
 *   node scripts/eval/syriac-pareto-6295/analyze-ocr.mjs
 */
import fs from 'node:fs';
import { makeRng } from '../lib/paired-stats.mjs';

const DIR = 'scripts/eval/results/syriac-pareto-6295';
const S = JSON.parse(fs.readFileSync(`${DIR}/ocr-score.json`, 'utf8'));
const B = 2000;
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const scored = S.pages.filter((p) => p.reference);
const unscored = S.pages.filter((p) => !p.reference).map((p) => ({ slug: p.slug, label: p.label, why: p.why }));

// Arms in the panel: every arm with a score on every scored page, plus the stored Gemini reads (which exist on a
// subset of pages by construction: they are what each page happened to be read with before the Kraken lane).
const ARMS = [...new Set(scored.flatMap((p) => Object.keys(p.scores)))].sort();
const editionsOf = (pages) => [...new Set(pages.map((p) => p.edition))];
function clusterMedianCI(pages, arm, seed) {
  const eds = editionsOf(pages); const by = new Map(eds.map((e) => [e, pages.filter((p) => p.edition === e)]));
  const rand = makeRng(seed); const meds = [];
  for (let b = 0; b < B; b++) { const xs = []; for (let i = 0; i < eds.length; i++) for (const p of by.get(eds[Math.floor(rand() * eds.length)])) xs.push(p.scores[arm].cer_capped); meds.push(median(xs)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(0.025 * B)]), r3(meds[Math.floor(0.975 * B)])];
}
function clusterDiffCI(pages, a, b, stat, seed) {
  const eds = editionsOf(pages); const by = new Map(eds.map((e) => [e, pages.filter((p) => p.edition === e)]));
  const rand = makeRng(seed); const ds = [];
  for (let k = 0; k < B; k++) { const xs = []; for (let i = 0; i < eds.length; i++) for (const p of by.get(eds[Math.floor(rand() * eds.length)])) xs.push(p.scores[a].cer_capped - p.scores[b].cer_capped); ds.push(stat(xs)); }
  ds.sort((x, y) => x - y);
  return [r3(ds[Math.floor(0.025 * B)]), r3(ds[Math.floor(0.975 * B)])];
}
const arm = (name, pages, seed) => {
  const cers = pages.map((p) => p.scores[name].cer_capped);
  const med = median(cers); const ci = clusterMedianCI(pages, name, seed);
  return { arm: name, n_pages: pages.length, n_books: new Set(pages.map((p) => p.book_id)).size, n_editions: editionsOf(pages).length,
    median_cer: r3(med), cer_ci95: ci, accuracy: r3(1 - med), accuracy_ci95: [r3(1 - ci[1]), r3(1 - ci[0])],
    pages_cer_le_010: cers.filter((c) => c <= 0.1).length, pages_cer_ge_050: cers.filter((c) => c >= 0.5).length };
};
const has = (p, a) => p.scores[a] != null;
const full = ARMS.filter((a) => scored.every((p) => has(p, a)));
const shared = scored;
const panel = full.map((a, i) => arm(a, shared, 6295 + i));
// Stored Gemini reads, each on the pages that have one; paired against the served lane on the same pages.
const storedArms = ARMS.filter((a) => a.startsWith('stored-')).map((a, i) => {
  const ps = scored.filter((p) => has(p, a));
  return ps.length >= 5 ? { ...arm(a, ps, 7295 + i), vs_served_lane_on_same_pages: arm('served-lane', ps, 7395 + i) } : { arm: a, n_pages: ps.length, note: 'fewer than 5 pages: no interval' };
});

// Rule 1 (column splitter): split beats whole iff the by-edition CI of the paired median difference excludes 0.
const split = { a: 'omnisyr', b: 'omnisyr-nosplit', median_diff: r3(median(shared.map((p) => p.scores.omnisyr.cer_capped - p.scores['omnisyr-nosplit'].cer_capped))),
  ci95: clusterDiffCI(shared, 'omnisyr', 'omnisyr-nosplit', median, 8295),
  pages_split: shared.filter((p) => p.scores.omnisyr && Math.abs(p.scores.omnisyr.cer_capped - p.scores['omnisyr-nosplit'].cer_capped) > 0.001).length };
split.verdict = split.ci95[1] < 0 ? 'split beats whole' : split.ci95[0] > 0 ? 'whole beats split' : 'no difference shown (CI includes 0)';
// A-vs-A floor for lite: L-ocr vs L-ocr-b.
const aa = full.includes('L-ocr') && full.includes('L-ocr-b') ? { median_abs_diff: r3(median(shared.map((p) => Math.abs(p.scores['L-ocr'].cer_capped - p.scores['L-ocr-b'].cer_capped)))),
  identical_pages: shared.filter((p) => p.scores['L-ocr'].cer_capped === p.scores['L-ocr-b'].cer_capped).length, n: shared.length } : null;
// Rule 2 (OCR lever): the best arm by accuracy; the cheapest whose accuracy CI overlaps it; fine-tune only if no arm reaches CER ≤ 0.10.
const best = [...panel].sort((x, y) => y.accuracy - x.accuracy)[0];
const overlapping = panel.filter((p) => p.accuracy_ci95[1] >= best.accuracy_ci95[0]).map((p) => p.arm);
const finetune = !panel.some((p) => p.median_cer <= 0.10);
const out = {
  issue: 6295, generated_by: 'scripts/eval/syriac-pareto-6295/analyze-ocr.mjs', scorer: S.scorer, date: S.date, grade: 'directional (under 30 books)',
  n_sealed: S.pages.length, n_scored: scored.length, n_books: new Set(scored.map((p) => p.book_id)).size, n_editions: editionsOf(scored).length,
  unscored, bootstrap: `${B} resamples of editions, seed 6295`, panel, stored: storedArms, column_splitter: split, lite_a_vs_a: aa,
  lever: { best: best.arm, overlapping_best: overlapping, finetune_recommended: finetune },
  per_page: scored.map((p) => ({ slug: p.slug, edition: p.edition, tier: p.tier, cer: Object.fromEntries(Object.entries(p.scores).filter(([, s]) => s).map(([a, s]) => [a, s.cer_capped])) })),
};
fs.writeFileSync(`${DIR}/ocr-summary.json`, JSON.stringify(out, null, 1) + '\n');
for (const p of panel) console.log(p.arm.padEnd(20), `CER ${p.median_cer} [${p.cer_ci95}]`, `≤0.10: ${p.pages_cer_le_010}/${p.n_pages}`);
for (const s of storedArms) console.log(s.arm, s.n_pages, s.median_cer, s.cer_ci95, 'served on same', s.vs_served_lane_on_same_pages?.median_cer);
console.log('split', split, 'aa', aa, 'lever', out.lever);
