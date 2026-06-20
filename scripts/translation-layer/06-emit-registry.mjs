#!/usr/bin/env node
/**
 * Phase 6 — the TRANSLATION CREDIT REGISTRY.
 *
 * The gap census and the registry are the same act: every "external prior" we
 * matched is a REAL existing English translation, with a translator, publisher,
 * and year we can credit and link. This turns the matched-cluster layer into a
 * public-facing registry that (a) credits the translators who did the work and
 * (b) points readers to translations that already exist — while leaving the
 * never-translated works clearly marked as the gap.
 *
 * Reads:
 *   scripts/output/cluster-external-priors.jsonl   (matched clusters + work_keys)
 *   scripts/output/external-translation-works.jsonl (work_key → catalog_ids)
 *   scripts/output/ustc-latin-clusters.jsonl       (the work being translated)
 *   translation_catalogs (Supabase)                (translator/publisher/year)
 *
 * Writes:
 *   scripts/output/translation-registry.jsonl  — one row per translated cluster:
 *     { work_cluster_id, work:{author,title,year_first_printed},
 *       translations:[{translator, english_title, publisher, year, source}],
 *       in_source_library }
 *   scripts/output/translation-registry-sample.md — human-readable sample.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/06-emit-registry.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supa, pullAll } from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function titleCase(s) {
  return (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

async function main() {
  const priors = readJsonl('cluster-external-priors.jsonl');
  const works = readJsonl('external-translation-works.jsonl');
  const clusters = new Map(readJsonl('ustc-latin-clusters.jsonl').map((c) => [c.work_cluster_id, c]));
  const workByKey = new Map(works.map((w) => [w.work_key, w]));

  console.log('Pulling translation_catalogs credit detail from Supabase…');
  const sb = supa();
  const cat = await pullAll(sb, 'translation_catalogs',
    'id,translator,publisher,english_title,pub_year,source', null);
  const catById = new Map(cat.map((r) => [r.id, r]));
  console.log(`  ${cat.length} catalog rows`);

  const registry = [];
  for (const p of priors) {
    const cluster = clusters.get(p.work_cluster_id);
    if (!cluster) continue;
    // gather every catalog edition behind this cluster's matched works
    const catIds = new Set();
    for (const wk of p.work_keys || []) {
      const w = workByKey.get(wk);
      if (w) for (const id of (w.catalog_ids || [])) catIds.add(id);
    }
    // build a deduped translation list (credit lines)
    const seen = new Set();
    const translations = [];
    for (const id of catIds) {
      const r = catById.get(id);
      if (!r) continue;
      const key = `${(r.translator || '').toLowerCase()}|${(r.english_title || '').toLowerCase()}|${r.pub_year || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      translations.push({
        translator: r.translator || null,
        english_title: r.english_title || null,
        publisher: r.publisher || null,
        year: r.pub_year || null,
        source: r.source,
      });
    }
    // curated-series works carry no catalog row — still credit the series itself
    if (translations.length === 0) {
      for (const s of p.external_translation_sources) {
        if (s.endsWith('_curated')) translations.push({ translator: null, english_title: null, publisher: seriesPublisher(s), year: null, source: s });
      }
    }
    translations.sort((a, b) => (parseInt(a.year) || 9999) - (parseInt(b.year) || 9999));
    registry.push({
      work_cluster_id: p.work_cluster_id,
      work: {
        author: titleCase(cluster.surname),
        title: cluster.title_repr,
        year_first_printed: cluster.year_min,
      },
      translations,
      n_translations: translations.length,
      n_with_named_translator: translations.filter((t) => t.translator).length,
      in_source_library: cluster.in_sl,
    });
  }

  // write registry
  const w = fs.createWriteStream(path.join(OUT, 'translation-registry.jsonl'));
  for (const r of registry) w.write(JSON.stringify(r) + '\n');
  w.end();

  // stats
  const named = registry.filter((r) => r.n_with_named_translator > 0).length;
  const distinctTranslators = new Set();
  for (const r of registry) for (const t of r.translations) if (t.translator) distinctTranslators.add(t.translator.trim());

  // human-readable sample
  const md = ['# Translation registry — sample\n',
    `Generated from the work-level prior layer. ${registry.length.toLocaleString()} early-modern Latin works`,
    `with a known English translation; ${named.toLocaleString()} carry a named translator;`,
    `${distinctTranslators.size.toLocaleString()} distinct translators credited.\n`,
    '| Work (USTC) | First printed | Translated as | Translator | Year | Source |',
    '|---|---|---|---|---|---|'];
  const step = Math.max(1, Math.floor(registry.length / 30));
  for (let i = 0; i < registry.length; i += step) {
    const r = registry[i];
    const t = r.translations.find((x) => x.translator) || r.translations[0] || {};
    md.push(`| ${(r.work.title || '').slice(0, 40).replace(/\|/g, '')} | ${r.work.year_first_printed || '?'} | ${(t.english_title || '—').slice(0, 38).replace(/\|/g, '')} | ${t.translator || '—'} | ${t.year || '—'} | ${t.source || '—'} |`);
  }
  fs.writeFileSync(path.join(OUT, 'translation-registry-sample.md'), md.join('\n') + '\n');

  console.log(`\n=== TRANSLATION REGISTRY ===`);
  console.log(`translated works (clusters):     ${registry.length.toLocaleString()}`);
  console.log(`  with a named translator:       ${named.toLocaleString()}`);
  console.log(`distinct translators credited:   ${distinctTranslators.size.toLocaleString()}`);
  console.log(`already in Source Library:       ${registry.filter((r) => r.in_source_library).length.toLocaleString()}`);
  console.log(`\nwrote translation-registry.jsonl + translation-registry-sample.md`);
}

function seriesPublisher(s) {
  if (s.startsWith('itrl')) return 'Harvard University Press (I Tatti Renaissance Library)';
  if (s.startsWith('doml')) return 'Harvard University Press (Dumbarton Oaks Medieval Library)';
  if (s.startsWith('brill')) return 'Brill';
  return null;
}

main().catch((e) => { console.error(e); process.exit(1); });
