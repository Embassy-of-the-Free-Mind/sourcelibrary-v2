#!/usr/bin/env node
/**
 * Draw the n≈250 stratified validation sample for the translation-gap figure
 * (issue #2684, scaling the n=30 pilot in
 * `.claude/docs/translation-gap-methodology.md` §Validation).
 *
 * Design (mirrors the FT paper's two-sided stratified sampling):
 *   - Stratum TRANSLATED (~120): clusters the pipeline marks translated
 *     (an external prior matched) — measures translation-match PRECISION.
 *   - Stratum GAP (~130): clusters the pipeline marks untranslated — measures
 *     RECALL; later post-stratified by composition era (the pilot's dominant
 *     confound: print-year ≠ composition-year).
 *
 * Frame: USTC Latin work-clusters with print year_min in [1480, 1620], deduped
 * by work_cluster_id (clusters are already 1-row-per-work).
 *
 * Reproducible: fixed-seed (mulberry32) shuffle. Re-running yields the same draw.
 *
 * Reads (regenerate with scripts/translation-layer/01..03 first):
 *   scripts/output/ustc-latin-clusters.jsonl     (denominator rows)
 *   scripts/output/cluster-external-priors.jsonl  (pipeline-"translated" set)
 * Enriches each drawn cluster with the modal full author_1 from ustc_editions.
 *
 * Writes:
 *   scripts/analysis/eval-data/gap-validation-n250-frame.json   (ANSWER KEY — labels + matched sources)
 *   scripts/analysis/eval-data/gap-validation-n250-blind.json   (BLIND input for adjudicators — labels stripped)
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/analysis/gap-validation-sample.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supa } from '../translation-layer/lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const EVAL = path.join(__dir, 'eval-data');
fs.mkdirSync(EVAL, { recursive: true });

const WINDOW = [1480, 1620];
const N_TRANSLATED = 120;
const N_GAP = 130;
const SEED = 2684; // issue number — reproducible draw

const readJsonl = (f) =>
  fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// deterministic PRNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function modalAuthors(sb, clusterIds) {
  // pull author_1 / title / year for the drawn clusters; pick the modal author_1
  const out = new Map();
  const CHUNK = 100;
  for (let i = 0; i < clusterIds.length; i += CHUNK) {
    const ids = clusterIds.slice(i, i + CHUNK);
    const { data, error } = await sb
      .from('ustc_editions')
      .select('work_cluster_id,author_1,title,year')
      .in('work_cluster_id', ids);
    if (error) throw new Error(error.message);
    for (const r of data) {
      let e = out.get(r.work_cluster_id);
      if (!e) { e = { authors: new Map(), years: [], titles: [] }; out.set(r.work_cluster_id, e); }
      if (r.author_1) e.authors.set(r.author_1, (e.authors.get(r.author_1) || 0) + 1);
      if (r.year) e.years.push(r.year);
      if (r.title) e.titles.push(r.title);
    }
  }
  const result = new Map();
  for (const [id, e] of out) {
    let bestA = '', bestN = 0;
    for (const [a, n] of e.authors) if (n > bestN) { bestN = n; bestA = a; }
    result.set(id, {
      author_full: bestA,
      year_min: e.years.length ? Math.min(...e.years) : null,
      year_max: e.years.length ? Math.max(...e.years) : null,
    });
  }
  return result;
}

async function main() {
  const clusters = readJsonl('ustc-latin-clusters.jsonl');
  const priorRows = readJsonl('cluster-external-priors.jsonl');
  const priorSrc = new Map(priorRows.map((r) => [r.work_cluster_id, r]));
  const priorSet = new Set(priorSrc.keys());

  const inWin = (c) => c.year_min >= WINDOW[0] && c.year_min <= WINDOW[1];
  const win = clusters.filter(inWin);
  const transPool = win.filter((c) => priorSet.has(c.work_cluster_id));
  const gapPool = win.filter((c) => !priorSet.has(c.work_cluster_id));

  console.log(`window ${WINDOW[0]}-${WINDOW[1]}: ${win.length} clusters`);
  console.log(`  translated pool: ${transPool.length} | gap pool: ${gapPool.length}`);

  const rng = mulberry32(SEED);
  const transSample = shuffle(transPool, rng).slice(0, N_TRANSLATED);
  const gapSample = shuffle(gapPool, rng).slice(0, N_GAP);

  // enrich with full author names from USTC
  const sb = supa();
  console.log('Enriching with modal author_1 from ustc_editions…');
  const allIds = [...transSample, ...gapSample].map((c) => c.work_cluster_id);
  const meta = await modalAuthors(sb, allIds);

  let idx = 0;
  const mk = (c, label) => {
    const m = meta.get(c.work_cluster_id) || {};
    const key = `${label === 'translated' ? 'T' : 'G'}${idx++}`;
    return {
      key,
      label, // pipeline label — ANSWER KEY ONLY
      work_cluster_id: c.work_cluster_id,
      author: m.author_full || c.surname,
      surname: c.surname,
      title: c.title_repr,
      print_year_min: m.year_min ?? c.year_min,
      print_year_max: m.year_max ?? c.year_min,
      n_editions: c.n_editions,
      matched_sources: label === 'translated' ? (priorSrc.get(c.work_cluster_id)?.external_translation_sources || []) : [],
      best_title_score: label === 'translated' ? (priorSrc.get(c.work_cluster_id)?.best_title_score ?? null) : null,
    };
  };

  idx = 0;
  const transRows = transSample.map((c) => mk(c, 'translated'));
  idx = 0;
  const gapRows = gapSample.map((c) => mk(c, 'gap'));
  const frame = {
    generated_for: 'issue #2684 — n≈250 translation-gap validation',
    window: WINDOW,
    seed: SEED,
    strata: { translated: transRows.length, gap: gapRows.length },
    pool_sizes: { translated: transPool.length, gap: gapPool.length, window_total: win.length },
    denominator_note:
      'print year_min in window; era classification (Renaissance-composed vs ancient/medieval reprint) added per-work downstream',
    works: [...transRows, ...gapRows],
  };
  fs.writeFileSync(path.join(EVAL, 'gap-validation-n250-frame.json'), JSON.stringify(frame, null, 2));

  // blind input: strip label + matched sources, shuffle order so strata aren't positional
  const blindOrder = shuffle(frame.works, mulberry32(SEED ^ 0x5bd1e995));
  const blind = blindOrder.map((w) => ({
    key: w.key,
    author: w.author,
    title: w.title,
    print_year: w.print_year_min,
    n_editions: w.n_editions,
  }));
  fs.writeFileSync(path.join(EVAL, 'gap-validation-n250-blind.json'), JSON.stringify({ works: blind }, null, 2));

  console.log(`\nwrote frame (${frame.works.length} works) + blind input to scripts/analysis/eval-data/`);
  console.log(`  translated: ${transRows.length} | gap: ${gapRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
