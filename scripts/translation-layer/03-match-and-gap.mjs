#!/usr/bin/env node
/**
 * Phase 3 — match external-translated works to USTC work clusters at the WORK
 * level, attach external provenance, and emit the Renaissance-Latin gap.
 *
 * Reads:
 *   scripts/output/external-translation-works.jsonl  (phase 1)
 *   scripts/output/quarantine-sl-works.jsonl         (phase 1, SL-origin channel)
 *   scripts/output/ustc-latin-clusters.jsonl         (phase 2, denominator)
 *
 * Matching = author-anchor (surname stem) + title containment + specificity
 * (lib.titleFit). This is the fix for the legacy author-level over-flagging.
 *
 * Writes:
 *   scripts/output/cluster-external-priors.jsonl  — matched clusters w/ sources[]
 *   scripts/output/translation-gap-report.json    — the gap numbers + method
 *
 * Usage: node scripts/translation-layer/03-match-and-gap.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { surnameStems, titleFit, buildDf } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// classify a provenance source into a channel for the report
function channel(src) {
  if (src.endsWith('_curated')) return 'curated_series';
  return 'catalog';
}

function main() {
  const external = readJsonl('external-translation-works.jsonl');
  const quarantine = readJsonl('quarantine-sl-works.jsonl');
  const clusters = readJsonl('ustc-latin-clusters.jsonl');
  console.log(`external works: ${external.length} | quarantine: ${quarantine.length} | USTC clusters: ${clusters.length}`);

  // IDF over cluster titles — the rarity signal that separates work-identifying
  // tokens (catiline, mulieribus) from generic Latin (theologica, disputatio).
  const df = buildDf(clusters.map((c) => c.title_repr));
  const N = clusters.length;

  // index clusters by EVERY surname stem (multi-word names indexed under each
  // significant word — Pico della Mirandola under both 'pic' and 'mirandol').
  const byStem = new Map();
  for (const c of clusters) {
    for (const stem of surnameStems(c.surname)) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push(c);
    }
  }

  // Match `works` against clusters into the target Map `into`.
  // into: cluster_id -> { sources:Set, channels:Set, work_keys:Set, best_score }
  // returns count of works that matched ≥1 cluster.
  function matchWorks(works, into) {
    let matched = 0;
    for (const w of works) {
      const stems = surnameStems(w.author || w.surname);
      if (stems.length === 0) continue;
      // gather candidate clusters from all of the work's surname stems (dedupe)
      const seen = new Set();
      const cands = [];
      for (const stem of stems) {
        const arr = byStem.get(stem);
        if (!arr) continue;
        for (const c of arr) { if (!seen.has(c.work_cluster_id)) { seen.add(c.work_cluster_id); cands.push(c); } }
      }
      if (cands.length === 0) continue;
      let any = false;
      for (const c of cands) {
        const authorStems = [...stems, ...surnameStems(c.surname)];
        const fit = titleFit(w.title, c.title_repr, df, N, authorStems);
        if (!fit.match) continue;
        let p = into.get(c.work_cluster_id);
        if (!p) { p = { sources: new Set(), channels: new Set(), work_keys: new Set(), best_score: 0 }; into.set(c.work_cluster_id, p); }
        w.sources.forEach((s) => { p.sources.add(s); p.channels.add(channel(s)); });
        p.work_keys.add(w.work_key);
        if (fit.score > p.best_score) p.best_score = fit.score;
        any = true;
      }
      if (any) matched++;
    }
    return matched;
  }

  console.log('Matching external works → clusters…');
  const priors = new Map();
  const extMatched = matchWorks(external, priors);
  const externalPriorClusters = new Set(priors.keys());
  console.log(`  external works that matched ≥1 cluster: ${extMatched}/${external.length}`);
  console.log(`  clusters with an EXTERNAL prior:        ${externalPriorClusters.size}`);

  // SL quarantine channel — matched SEPARATELY into its own Map, never merged
  // into the external baseline.
  const slPriors = new Map();
  matchWorks(quarantine, slPriors);
  const slOnlyClusters = [...slPriors.keys()].filter((id) => !externalPriorClusters.has(id));
  console.log(`  clusters whose ONLY prior is SL-origin (quarantined, NOT counted): ${slOnlyClusters.length}`);

  // --- write matched-cluster layer ---
  const w1 = fs.createWriteStream(path.join(OUT, 'cluster-external-priors.jsonl'));
  for (const [id, p] of priors) {
    w1.write(JSON.stringify({
      work_cluster_id: id,
      external_translation_sources: [...p.sources].sort(),
      channels: [...p.channels].sort(),
      work_keys: [...p.work_keys],            // join key for the credit registry (phase 06)
      n_works: p.work_keys.size,
      best_title_score: Number(p.best_score.toFixed(3)),
    }) + '\n');
  }
  w1.end();

  // --- gap computation ---
  const D = clusters.length;                              // denominator (all early-modern Latin print clusters)
  const withExt = externalPriorClusters.size;            // clusters with an external prior
  const gap = D - withExt;                               // untranslated (external baseline)
  const legacyTrans = clusters.filter((c) => c.legacy_has_translation).length;
  const inSl = clusters.filter((c) => c.in_sl).length;

  // SL impact: clusters that have NO external prior but ARE translated by SL
  const slImpact = clusters.filter((c) => c.in_sl && !externalPriorClusters.has(c.work_cluster_id)).length;

  const report = {
    generated: '2026-06-20',
    method: 'work-level author-anchor + title containment + specificity (lib.titleFit); external priors only',
    denominator: {
      label: 'USTC Latin editions printed 1400-1700, collapsed to work_cluster_id',
      caveat: 'PRINT year, not composition — includes early-modern reprints of ancient/medieval works; UPPER bound on the Renaissance-composed Latin corpus',
      distinct_clusters: D,
      total_editions_note: 'see phase-2 output',
    },
    external_prior_layer: {
      external_works_total: external.length,
      external_works_matched: extMatched,
      clusters_with_external_prior: withExt,
      pct_translated_external: Number((100 * withExt / D).toFixed(3)),
    },
    gap: {
      clusters_without_external_prior: gap,
      pct_untranslated_external: Number((100 * gap / D).toFixed(3)),
    },
    legacy_flag_comparison: {
      legacy_has_english_translation_clusters: legacyTrans,
      legacy_pct: Number((100 * legacyTrans / D).toFixed(3)),
      over_count_vs_worklevel: legacyTrans - withExt,
      note: 'legacy flag is author-level (build.mjs findTranslation); the delta is the over-count our work-level layer removes',
    },
    sl_channel_kept_separate: {
      clusters_in_source_library: inSl,
      clusters_sl_only_prior_quarantined: slOnlyClusters.length,
      sl_impact_clusters_no_external_prior_but_sl_translated: slImpact,
      note: 'two distinct denominators: gap = untranslated BEFORE Source Library (external only); SL impact added back separately, never conflated',
    },
  };
  fs.writeFileSync(path.join(OUT, 'translation-gap-report.json'), JSON.stringify(report, null, 2));

  console.log('\n=== RENAISSANCE/EARLY-MODERN LATIN GAP (external priors only) ===');
  console.log(`denominator (early-modern Latin print clusters): ${D.toLocaleString()}`);
  console.log(`  with an EXTERNAL translation prior:  ${withExt.toLocaleString()} (${report.external_prior_layer.pct_translated_external}%)`);
  console.log(`  GAP — no external prior:             ${gap.toLocaleString()} (${report.gap.pct_untranslated_external}%)`);
  console.log(`\nlegacy author-level flag said translated: ${legacyTrans.toLocaleString()} (${report.legacy_flag_comparison.legacy_pct}%)`);
  console.log(`  → over-count removed by work-level: ${(legacyTrans - withExt).toLocaleString()} clusters`);
  console.log(`\nSL channel (separate): in_sl=${inSl}, SL-only-prior quarantined=${slOnlyClusters.length}`);
  console.log(`\nwrote cluster-external-priors.jsonl + translation-gap-report.json`);
}

main();
