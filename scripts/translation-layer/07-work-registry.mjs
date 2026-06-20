#!/usr/bin/env node
/**
 * Phase 7 — the CLEAN, work-centric public registry.
 *
 * Phase 06 keyed the registry on USTC edition-clusters, which over-split a work
 * into many rows (Cicero ~562) and conflated same-surname authors (Roger vs
 * Francis Bacon). This phase keys on the EXTERNAL WORK instead — which is already
 * work-level (deduped by work_key in phase 01) and carries a full author name,
 * a clean canonical title, and a composition year/era. That gives one row per
 * work, the right author, and credits merged — the "dedup-first" registry.
 *
 * Each registry row = one external translated work that matched ≥1 USTC Latin
 * cluster (so we know the original is in the early-modern record), with its
 * existing English translations credited.
 *
 * Reads (all in scripts/output/):
 *   external-translation-works.jsonl, cluster-external-priors.jsonl,
 *   ustc-latin-clusters.jsonl, + translation_catalogs credit detail (Supabase).
 * Writes:
 *   translation-registry-public.json  — confidence-gated, work-level, for the page.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/07-work-registry.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supa, pullAll, surnameStems, distinctiveTokens } from './lib.mjs';

// the work-identifying surname stem = the longest stem (the actual surname, not
// a given name): "Andrea Alciati"→{andre,alciat}→"alciat"; "Alciato"→"alciat".
const keyStem = (author, surname) => {
  const stems = surnameStems(author || surname);
  return stems.sort((a, b) => b.length - a.length)[0] || (surname || '').toLowerCase();
};

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '../../scripts/output');
const readJsonl = (f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const titleCase = (s) => (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());
const cleanTranslator = (t) => t ? t.replace(/,?\s*(tr\.|trans\.|translator|ed\.|editor|illus\.|comp\.|d\.\s*\d+|\d{4}\??-?\d{0,4}\??)/gi, '').replace(/[;,]\s*$/, '').replace(/\s+/g, ' ').trim() : null;
const cleanYear = (y) => { const n = parseInt(y); return n >= 1450 && n <= 2026 ? n : null; };

async function main() {
  const works = readJsonl('external-translation-works.jsonl');
  const workByKey = new Map(works.map((w) => [w.work_key, w]));
  const clustersById = new Map(readJsonl('ustc-latin-clusters.jsonl').map((c) => [c.work_cluster_id, c]));
  const priors = readJsonl('cluster-external-priors.jsonl');

  // invert: work_key -> { clusters:Set, in_sl, best_score, channels:Set }
  const byWork = new Map();
  for (const p of priors) {
    const cl = clustersById.get(p.work_cluster_id);
    for (const wk of p.work_keys || []) {
      let e = byWork.get(wk);
      if (!e) { e = { clusters: new Set(), in_sl: false, best_score: 0, channels: new Set() }; byWork.set(wk, e); }
      e.clusters.add(p.work_cluster_id);
      if (cl && cl.in_sl) e.in_sl = true;
      if ((p.best_title_score || 0) > e.best_score) e.best_score = p.best_title_score || 0;
      (p.channels || []).forEach((c) => e.channels.add(c));
    }
  }
  console.log(`external works that matched ≥1 USTC cluster: ${byWork.size}`);

  console.log('Pulling translation_catalogs credit detail…');
  const sb = supa();
  const cat = await pullAll(sb, 'translation_catalogs', 'id,translator,publisher,english_title,pub_year,source', null);
  const catById = new Map(cat.map((r) => [r.id, r]));
  console.log(`  ${cat.length} catalog rows`);

  // build one entry per matched work
  let rows = [];
  for (const [wk, m] of byWork) {
    const w = workByKey.get(wk);
    if (!w) continue;
    // credits from the work's catalog editions
    const seen = new Set();
    const credits = [];
    for (const id of (w.catalog_ids || [])) {
      const r = catById.get(id);
      if (!r) continue;
      const tr = cleanTranslator(r.translator);
      const y = cleanYear(r.pub_year);
      const key = `${(tr || '').toLowerCase()}|${y || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      credits.push({ tr, t: r.english_title || null, pub: r.publisher || null, y, s: r.source });
    }
    if (credits.length === 0) {
      for (const s of m.channels) if (s === 'curated_series') credits.push({ tr: null, t: w.title_en || null, pub: null, y: w.orig_year || null, s: [...w.sources].find((x) => x.endsWith('_curated')) || 'curated' });
    }
    credits.sort((a, b) => (a.y || 9999) - (b.y || 9999));
    rows.push({
      surname: w.surname,
      author: titleCase(w.author && w.author.split(/\s+/).length > 1 ? w.author : w.surname),
      work: w.title_en || titleCase(w.title) || '(untitled)',
      work_latin: w.title && w.title !== w.title_en ? w.title : null,
      orig_year: w.orig_year ?? null,
      era: w.era,
      is_target: w.is_target,
      credits: credits.slice(0, 4),
      n_named: credits.filter((c) => c.tr).length,
      n_ustc_editions: m.clusters.size,
      in_sl: m.in_sl,
      score: m.best_score,
      curated: m.channels.has('curated_series'),
    });
  }

  // residual collapse: same author + same English-title first-3 tokens + same era
  const merged = new Map();
  for (const r of rows) {
    // distinctive (stopword-stripped) title tokens so "Book of Emblems" == "Emblems"
    const tnorm = distinctiveTokens(r.work).slice(0, 2).join(' ');
    const key = `${keyStem(r.author, r.surname)}|${tnorm}|${r.era}`;
    const m = merged.get(key);
    if (!m) { merged.set(key, r); continue; }
    // prefer the cleanest display author: "Firstname Lastname", no comma, longer
    const better = (a, b) => (!a.includes(',') && a.includes(' ') ? 2 : 0) + a.length / 100 > (!b.includes(',') && b.includes(' ') ? 2 : 0) + b.length / 100;
    if (better(r.author, m.author)) m.author = r.author;
    if (r.orig_year != null && (m.orig_year == null || r.orig_year < m.orig_year)) m.orig_year = r.orig_year;
    for (const c of r.credits) if (!m.credits.some((x) => x.tr === c.tr && x.y === c.y)) m.credits.push(c);
    m.credits = m.credits.slice(0, 4);
    m.n_named = m.credits.filter((c) => c.tr).length;
    m.n_ustc_editions += r.n_ustc_editions;
    if (r.in_sl) m.in_sl = true;
    if (r.score > m.score) m.score = r.score;
    if (r.curated) m.curated = true;
    if (r.is_target) m.is_target = true;
  }
  rows = [...merged.values()];

  // public confidence gate
  const pub = rows.filter((r) => r.score >= 9 || (r.score >= 7 && r.n_named > 0) || r.curated)
    .sort((a, b) => a.author.localeCompare(b.author) || (a.orig_year || 0) - (b.orig_year || 0));

  fs.writeFileSync(path.join(OUT, 'translation-registry-public.json'), JSON.stringify({
    generated: '2026-06-21',
    note: 'Confidence-gated, work-level registry of early-modern Latin (and adjacent) works with a known external English translation. Keyed on the work, not the edition. The gap = works with no entry here.',
    count: pub.length,
    works: pub.map((r) => ({ a: r.author, w: r.work, wl: r.work_latin || undefined, y: r.orig_year, era: r.era, tgt: r.is_target || undefined, c: r.credits, ed: r.n_ustc_editions, sl: r.in_sl || undefined })),
  }));

  const named = pub.filter((r) => r.n_named > 0).length;
  const translators = new Set();
  for (const r of pub) for (const c of r.credits) if (c.tr) translators.add(c.tr.toLowerCase());
  console.log(`\n=== CLEAN WORK-LEVEL REGISTRY (public) ===`);
  console.log(`distinct translated works:       ${pub.length}`);
  console.log(`  with a named translator:       ${named}`);
  console.log(`  Renaissance-Latin (is_target): ${pub.filter((r) => r.is_target).length}`);
  console.log(`distinct translators credited:   ${translators.size}`);
  console.log(`already in Source Library:       ${pub.filter((r) => r.in_sl).length}`);
  console.log(`\nwrote translation-registry-public.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
