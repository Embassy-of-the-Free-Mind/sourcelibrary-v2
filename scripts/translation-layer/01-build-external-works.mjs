#!/usr/bin/env node
/**
 * Phase 1 — assemble the set of distinct ENGLISH-TRANSLATED works from EXTERNAL
 * (non-Source-Library) evidence, plus a separate SL-origin quarantine channel.
 *
 * Inputs:
 *   - Curated scholarly series (high-trust, with Latin titles for matching):
 *       scripts/translation-layer/series/i-tatti.json
 *       scripts/translation-layer/series/brill-doml.json
 *   - translation_catalogs (Supabase) ⨝ the validated flash-lite enrichment
 *       (scripts/output/translation-census-enriched-2026-06-20.jsonl, keyed on id),
 *     restricted to EXTERNAL sources. The enrichment supplies the normalized
 *     original author / Latin title / composition year / era / is_target / work_key.
 *
 * Outputs (scripts/output/):
 *   external-translation-works.jsonl  — one row per distinct work (work_key),
 *                                        with merged provenance sources[].
 *   quarantine-sl-works.jsonl         — SL-origin-only works (the priors we must
 *                                        NOT count): sl_ft_llm_claim etc.
 *
 * --staging (#7769): ALSO read the staged multi-language English-translation
 * sets as external works — LoC MARC 041$h (loc_marc_041), Open Library
 * translated_from (openlibrary_translated_from), Wikidata P629
 * (wikidata_p629) — from TL_STAGING_DIR (default scripts/output/translation-staging/,
 * one *.jsonl per source, rows { source, source_id, url, orig_lang, orig_author,
 * orig_title, en_title, en_year, orig_year }). The union is written to
 * external-translation-works-staging.jsonl, NEVER over external-translation-works.jsonl:
 * phase 03 reads that file and phase 04 writes its priors into Supabase, and
 * staged rows must not reach translation_catalogs or the public badges.
 *
 * The enrichment that gives catalog rows their original language is a laptop
 * file (TL_ENRICH overrides the path). Without it the catalog leg is skipped
 * LOUDLY and only series (+ staging) are built — the output then understates the
 * catalogued external side and must not be quoted as the baseline.
 *
 * Usage: set -a; source .env.production.local; set +a
 *        node scripts/translation-layer/01-build-external-works.mjs [--staging]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  supa, pullAll, isExternalSource, SL_ORIGIN_SOURCES, SL_AMBIGUOUS_SOURCES,
  extractSurname, surnameStem, distinctiveTokens, deaccent,
} from './lib.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SERIES_DIR = path.join(__dir, 'series');
// enrichment lives in the main checkout (scripts/output is gitignored)
const ENRICH = process.env.TL_ENRICH || '/Users/dereklomas/sourcelibrary/scripts/output/translation-census-enriched-2026-06-20.jsonl';
const OUT_DIR = path.join(__dir, '../../scripts/output');
const STAGING = process.argv.includes('--staging');
const STAGING_DIR = process.env.TL_STAGING_DIR || path.join(OUT_DIR, 'translation-staging');
fs.mkdirSync(OUT_DIR, { recursive: true });

function eraFromYear(y) {
  if (!y || !Number.isFinite(y)) return 'unknown';
  if (y < 500) return 'antiquity';
  if (y < 1400) return 'medieval';
  if (y <= 1700) return 'renaissance_early_modern';
  return 'modern';
}

// A work_key independent of source, so series and catalog rows for the same work merge.
function workKey(surname, title, year) {
  const ss = surnameStem(surname) || 'unknown';
  const tok = distinctiveTokens(title).slice(0, 2).join('-') || 'untitled';
  const decade = year && Number.isFinite(year) ? Math.round(year / 25) * 25 : 0;
  return `${ss}|${tok}|${decade}`;
}

// merge a work into the accumulator
function add(map, w) {
  const key = w.work_key;
  if (!map.has(key)) {
    map.set(key, {
      work_key: key,
      surname: w.surname,
      author: w.author || w.surname,
      title: w.title,
      title_en: w.title_en || '',
      orig_year: w.orig_year ?? null,
      era: w.era,
      orig_lang: w.orig_lang,
      is_target: !!w.is_target,
      sources: new Set(),
      catalog_ids: [],
      ...(w.staged_ref ? { staged_refs: [] } : {}),
    });
  }
  const e = map.get(key);
  w.sources.forEach((s) => e.sources.add(s));
  if (w.catalog_id != null) e.catalog_ids.push(w.catalog_id);
  // provenance for staged rows: every one traceable to a public record (capped per work)
  if (w.staged_ref) { e.staged_refs ??= []; if (e.staged_refs.length < 20) e.staged_refs.push(w.staged_ref); }
  // prefer a Latin title that has distinctive tokens if current is empty
  if ((!e.title || distinctiveTokens(e.title).length === 0) && w.title) e.title = w.title;
  if (!e.title_en && w.title_en) e.title_en = w.title_en;
  if (e.orig_year == null && w.orig_year != null) e.orig_year = w.orig_year;
  if (w.is_target) e.is_target = true;
  return e;
}

async function main() {
  const external = new Map();
  const quarantine = new Map();

  // --- (1) Curated series (high trust) — load every series/*.json by schema.
  // Records WITH a `series` field use it as the source channel (brill/doml);
  // records WITHOUT one are I Tatti (ITRL). The era is taken from the record
  // if present, else derived from the composition year.
  let seriesCount = 0;
  const seriesFiles = fs.readdirSync(SERIES_DIR).filter((f) => f.endsWith('.json'));
  for (const f of seriesFiles) {
    const rows = JSON.parse(fs.readFileSync(path.join(SERIES_DIR, f), 'utf8'));
    for (const v of rows) {
      const year = Number(v.orig_year) || null;
      const era = v.era || eraFromYear(year);
      const lang = v.orig_lang || 'latin';
      const channel = v.series ? `${v.series}_curated` : 'itrl_curated';
      add(external, {
        work_key: workKey(v.author_surname, v.title_latin || v.title_en, year),
        surname: extractSurname(v.author_surname) || (v.author_surname || '').toLowerCase(),
        author: v.author_en || v.author_surname,
        title: v.title_latin || v.title_en,
        title_en: v.title_en,
        orig_year: year,
        era,
        orig_lang: lang,
        is_target: era === 'renaissance_early_modern' && lang === 'latin',
        sources: [channel],
      });
      seriesCount++;
    }
  }

  // --- (2) translation_catalogs ⨝ enrichment ---
  const haveEnrich = fs.existsSync(ENRICH);
  if (!haveEnrich) {
    console.warn(`\n⚠️  enrichment not found at ${ENRICH} (set TL_ENRICH).`);
    console.warn('   SKIPPING the translation_catalogs leg: output = series' + (STAGING ? ' + staging' : '') + ' only.');
    console.warn('   Do NOT quote it as the catalogued external baseline.\n');
  }
  if (haveEnrich) {
  console.log('Loading translation_catalogs from Supabase…');
  const sb = supa();
  const cat = await pullAll(sb, 'translation_catalogs', 'id,source', null);
  const sourceById = new Map(cat.map((r) => [r.id, r.source]));
  console.log(`  ${cat.length} catalog rows`);

  console.log('Loading enrichment…');
  const enrich = new Map();
  for (const line of fs.readFileSync(ENRICH, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    enrich.set(o.id, o);
  }
  console.log(`  ${enrich.size} enrichment rows`);

  let extRows = 0, slRows = 0, noEnrich = 0;
  for (const [id, source] of sourceById) {
    const e = enrich.get(id);
    if (!e || e._failed) { noEnrich++; continue; }
    const surname = extractSurname(e.orig_author);
    if (!surname) continue;
    const title = e.orig_title || e.orig_title_en || '';
    const year = Number.isFinite(e.orig_year_est) ? e.orig_year_est : null;
    const era = e.era || eraFromYear(year);
    const lang = e.orig_language || 'unknown';
    const isTarget = !!e.is_target;
    // prefer the enrichment work_key; fall back to ours
    const wk = e.work_key && e.work_key.includes('|') ? e.work_key : workKey(surname, title, year);
    const rec = {
      work_key: wk,
      surname,
      author: e.orig_author || surname,
      title,
      title_en: e.orig_title_en || '',
      orig_year: year,
      era,
      orig_lang: lang,
      is_target: isTarget,
      sources: [source],
      catalog_id: id,
    };
    if (isExternalSource(source)) { add(external, rec); extRows++; }
    else { add(quarantine, rec); slRows++; }
  }
  console.log(`  external catalog rows: ${extRows} | SL-origin rows: ${slRows} | no enrichment: ${noEnrich}`);
  }

  // --- (3) staged multi-language sets (#7769), only with --staging ---
  const stagedBySource = {};
  if (STAGING) {
    const files = fs.existsSync(STAGING_DIR) ? fs.readdirSync(STAGING_DIR).filter((f) => f.endsWith('.jsonl')) : [];
    if (!files.length) throw new Error(`--staging: no *.jsonl in ${STAGING_DIR}`);
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(STAGING_DIR, f), 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r; try { r = JSON.parse(line); } catch { continue; }
        const surname = extractSurname(r.orig_author);
        const title = r.orig_title || r.en_title || '';
        if (!surname || !title || !r.source || !r.orig_lang) continue;
        const year = Number(r.orig_year) || null;
        const era = eraFromYear(year);
        // the key carries no language; one surname+title in two source languages
        // (Hoffmann's Nussknacker and Dumas's French retelling) must stay two works
        let wk = workKey(surname, title, year);
        if (external.has(wk) && external.get(wk).orig_lang !== r.orig_lang) wk += `|${r.orig_lang}`;
        add(external, {
          work_key: wk,
          surname,
          author: r.orig_author,
          title,
          title_en: r.en_title || '',
          orig_year: year,
          era,
          orig_lang: r.orig_lang,
          is_target: era === 'renaissance_early_modern' && r.orig_lang === 'latin',
          sources: [r.source],
          staged_ref: { source: r.source, id: r.source_id, url: r.url },
        });
        const k = `${r.source}\t${r.orig_lang}`;
        stagedBySource[k] = (stagedBySource[k] || 0) + 1;
      }
    }
    console.log(`  staged rows read from ${STAGING_DIR} (rows with no author or title are not counted; they cannot anchor a work match):`);
    for (const [k, n] of Object.entries(stagedBySource).sort()) console.log(`    ${k.replace('\t', '  ')}  ${n}`);
  }

  // --- write ---
  const extOut = path.join(OUT_DIR, STAGING ? 'external-translation-works-staging.jsonl' : 'external-translation-works.jsonl');
  const qOut = path.join(OUT_DIR, STAGING ? 'quarantine-sl-works-staging.jsonl' : 'quarantine-sl-works.jsonl');
  const w1 = fs.createWriteStream(extOut);
  for (const e of external.values()) w1.write(JSON.stringify({ ...e, sources: [...e.sources] }) + '\n');
  w1.end();
  const w2 = fs.createWriteStream(qOut);
  for (const e of quarantine.values()) {
    // only keep SL works that are NOT independently corroborated by an external row
    if (external.has(e.work_key)) continue;
    w2.write(JSON.stringify({ ...e, sources: [...e.sources] }) + '\n');
  }
  w2.end();

  // --- summary ---
  const extArr = [...external.values()];
  const tgt = extArr.filter((w) => w.is_target);
  const qArr = [...quarantine.values()].filter((e) => !external.has(e.work_key));
  const qTgt = qArr.filter((w) => w.is_target);
  console.log('\n=== external works ===');
  console.log(`distinct external works:            ${extArr.length}`);
  console.log(`  is_target (renaissance+latin):    ${tgt.length}`);
  console.log(`distinct SL-origin-only works (quarantine): ${qArr.length}`);
  console.log(`  is_target among quarantine:       ${qTgt.length}`);
  console.log(`\nwrote ${extOut}`);
  console.log(`wrote ${qOut}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
