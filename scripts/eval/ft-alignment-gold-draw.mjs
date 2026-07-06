#!/usr/bin/env node
/**
 * Tier-0 ALIGNMENT-GOLD draw — issue #2885(b).  READ-ONLY.
 *
 * #2880 measured the SEARCH tiers (Gemini vs Claude). This measures the
 * deterministic, pre-LLM **Tier-0 alignment** underneath them: "when Tier-0 links
 * a book to a prior (catalog row) or co-clusters two of our own editions under one
 * `work_id`, is that link RIGHT?" A wrong link is an FT error in disguise:
 *   - false MERGE (two different works linked as one)  → false DEMOTE of a real first
 *   - false SPLIT (one work scattered across work_ids) → a real prior goes unmatched
 *
 * "Are these two records the same work? y/n" is a CLOSED yes/no per pair, so link
 * precision / cluster homogeneity / split rate are finitely measurable. This
 * script draws the gold; a judge (J0 metadata + J1 Claude subagents, unprimed)
 * labels same-work y/n; `ft-alignment-score.ts` scores it.
 *
 * All three strata reduce to ONE unit — a same-work pair judgment:
 *   • link      book ↔ translation_catalogs row  (the Tier-0 catalog match)
 *               same=false ⇒ FALSE MERGE (the auto-demote would be wrong)
 *   • cocluster book ↔ book sharing one work_id   (the #2318 clustering)
 *               same=false ⇒ cluster IMPURITY (a false merge in clustering)
 *   • split     book ↔ book with DIFFERENT work_id but a title-family collision
 *               same=true  ⇒ FALSE SPLIT (a recall miss — clustering under-merged)
 *
 * It reuses the PRODUCTION guarded matcher (`matchBookToCatalog` from
 * ft-catalog-match.mjs) — NOT a re-implementation. A simplified re-match is the
 * "sampler-strawman" that produced fake false-merges in the #2880 R2 audit.
 *
 * WRITES NOTHING to the database. Emits two files to scripts/eval/results/:
 *   ft-alignment-gold-<date>.json        {summary, manifest}  (judge-visible; neutral metadata only)
 *   ft-alignment-scoringkey-<date>.json  {pair_id: _key}       (HIDDEN from any judge)
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   node scripts/eval/ft-alignment-gold-draw.mjs [--seed 42] [--date YYYY-MM-DD]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import {
  buildCatalogIndex, matchBookToCatalog,
  normalise, sigTokens, extractSurname,
} from './ft-catalog-match.mjs';
import { sig, surname, sameSeries } from '../lib/work-identity-util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');

const argSeed = (() => { const i = process.argv.indexOf('--seed'); return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 42; })();
const DATE = (() => { const i = process.argv.indexOf('--date'); return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : new Date().toISOString().slice(0, 10); })();

// Sample sizes. LINK demote_candidates are a CENSUS (there are only ~22 across the
// whole corpus — catalog is Latin-only, #2899), so we take ALL of them; the rest
// are true samples, oversampling the generic-title / namesake-prone slice where
// false merges concentrate.
const LINK_REVIEW_SAMPLE = 28;   // sampled needs_review links (guard-rejection context)
const COCLUSTER_SAMPLE = 50;     // work_id co-cluster pairs
const SPLIT_SAMPLE = 30;         // title-family split-candidate pairs (recall)

const ENGLISH = [null, 'en', 'eng', 'English', 'english'];
const ELIG = { visible: true, pages_translated: { $gt: 0 }, language: { $nin: ENGLISH } };

// ── Deterministic PRNG (mulberry32) + seeded shuffle — reproducible draws ───────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const rnd = mulberry32(argSeed);

// ── Stable, order-independent pair id (djb2 over the sorted member keys) ────────
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
function pairId(kind, keyA, keyB) {
  const [x, y] = [String(keyA), String(keyB)].sort();
  return `${kind}_${hash(`${x}::${y}`)}`;
}

// generic title = too few significant tokens to disambiguate a work.
function isGenericTitle(title) {
  return sigTokens(title || '').length <= 2;
}

// Draw `n` items with ~half from the generic-namesake sub-stratum when available.
function stratifiedDraw(items, n, isGenNamesake) {
  const gen = shuffle(items.filter(isGenNamesake), rnd);
  const spec = shuffle(items.filter((x) => !isGenNamesake(x)), rnd);
  const half = Math.floor(n / 2);
  const takeGen = gen.slice(0, Math.min(half, gen.length));
  const takeSpec = spec.slice(0, n - takeGen.length);
  // if one side was short, backfill from the other
  const short = n - takeGen.length - takeSpec.length;
  const backfill = short > 0 ? gen.slice(takeGen.length, takeGen.length + short) : [];
  return [...takeGen, ...takeSpec, ...backfill];
}

const bookMeta = (b) => ({ type: 'book', id: b.id, title: b.title, author: b.author, language: b.language, original_language: b.original_language ?? null });

async function main() {
  await withMongo(async (db) => {
    const books = await db.collection('books').find(ELIG)
      .project({ _id: 0, id: 1, author: 1, title: 1, language: 1, original_language: 1, work_id: 1, work_id_source: 1, work_id_confidence: 1, work_title: 1 })
      .toArray();
    // Exclude the contaminated discovery harvest — same guard the matcher enforces.
    const catRows = await db.collection('translation_catalogs')
      .find({ source: { $ne: 'ft_verification_discovery' } })
      .project({ _id: 1, source: 1, author: 1, author_normalized: 1, author_surname: 1, canonical_author: 1, canonical_author_normalized: 1, english_title: 1, english_title_normalized: 1, canonical_work: 1, canonical_work_normalized: 1, translator: 1, pub_year: 1, pub_year_int: 1, publisher: 1, completeness: 1, source_language: 1, url: 1, source_url: 1 })
      .toArray();
    console.log(`Loaded ${books.length} eligible books, ${catRows.length} catalog rows (excl. ft_verification_discovery).`);

    const idx = buildCatalogIndex(catRows);

    // Namesake maps. A surname is "namesake-prone" when it maps to ≥2 distinct
    // people — on the CATALOG side (distinct canonical authors) for links, and on
    // OUR side (distinct work_ids) for co-cluster / split pairs.
    const catAuthorsBySurname = new Map();
    for (const [sn, rows] of idx.entries()) {
      catAuthorsBySurname.set(sn, new Set(rows.map((r) => r.canonical_author_normalized || r.author_normalized || normalise(r.canonical_author || r.author || ''))));
    }
    const workIdsBySurname = new Map();
    for (const b of books) {
      const sn = surname(b.author || '');
      if (!sn) continue;
      if (!workIdsBySurname.has(sn)) workIdsBySurname.set(sn, new Set());
      if (b.work_id) workIdsBySurname.get(sn).add(b.work_id);
    }
    const catNamesake = (author) => (catAuthorsBySurname.get(extractSurname(author))?.size ?? 0) >= 2;
    const ourNamesake = (author) => (workIdsBySurname.get(surname(author || ''))?.size ?? 0) >= 2;

    const manifest = [];
    const key = {};

    // ── A. LINK stratum — run the real matcher over the whole eligible corpus ──
    const linkResults = [];
    for (const b of books) {
      const r = matchBookToCatalog(b, idx);
      if (r) linkResults.push({ book: b, r });
    }
    const demote = linkResults.filter((x) => x.r.tier === 'demote_candidate');
    const review = linkResults.filter((x) => x.r.tier === 'needs_review');
    // census all demote_candidate; sample needs_review (oversampling generic/namesake)
    const reviewSample = stratifiedDraw(review, LINK_REVIEW_SAMPLE, (x) => isGenericTitle(x.book.title) || catNamesake(x.book.author));
    for (const { book, r } of [...demote, ...reviewSample]) {
      const bm = r.best_match;
      const pid = pairId('link', book.id, bm.catalog_id);
      const gn = isGenericTitle(book.title) || catNamesake(book.author);
      manifest.push({
        pair_id: pid,
        kind: 'link',
        left: bookMeta(book),
        right: { type: 'catalog_row', english_title: bm.english_title, canonical_work: bm.canonical_work, author: bm.catalog_author, translator: bm.translator, pub_year: bm.pub_year, source_language: bm.source_language, completeness: bm.completeness },
      });
      key[pid] = {
        kind: 'link',
        stratum: gn ? 'link · generic-namesake' : 'link · specific',
        matcher_tier: r.tier,
        guards: bm.guards, failed_guards: bm.failed_guards,
        author_overlap: bm.author_overlap, title_coverage: bm.title_coverage,
        catalog_source: bm.source, catalog_id: bm.catalog_id,
        book_id: book.id, book_source_iso: r.book_source_iso,
      };
    }

    // ── B. COCLUSTER stratum — pairs of our books sharing one work_id ──────────
    const byWork = new Map();
    for (const b of books) {
      if (!b.work_id) continue;
      if (!byWork.has(b.work_id)) byWork.set(b.work_id, []);
      byWork.get(b.work_id).push(b);
    }
    const clusters = [...byWork.entries()].filter(([, arr]) => arr.length >= 2).map(([wid, arr]) => ({ wid, arr }));
    const clusterSample = stratifiedDraw(clusters, COCLUSTER_SAMPLE, ({ arr }) => isGenericTitle(arr[0].work_title || arr[0].title) || ourNamesake(arr[0].author));
    for (const { wid, arr } of clusterSample) {
      const sh = shuffle(arr, rnd);
      const [a, b] = [sh[0], sh[1]];
      const pid = pairId('cocluster', a.id, b.id);
      const gn = isGenericTitle(a.work_title || a.title) || ourNamesake(a.author);
      manifest.push({ pair_id: pid, kind: 'cocluster', left: bookMeta(a), right: bookMeta(b) });
      key[pid] = {
        kind: 'cocluster',
        stratum: gn ? 'cocluster · generic-namesake' : 'cocluster · specific',
        work_id: wid, work_title: a.work_title ?? null,
        work_id_source: a.work_id_source ?? null, work_id_confidence: a.work_id_confidence ?? null,
        book_ids: [a.id, b.id],
      };
    }

    // ── C. SPLIT stratum — title-family collisions across DIFFERENT work_ids ───
    // family = surname + top-2 significant title tokens. A family spanning ≥2
    // work_ids is a candidate under-merge; keep a cross-work pair only when
    // sameSeries() agrees (rejects legit series distinguishers, e.g. vol 10 vs 11).
    const byFamily = new Map();
    for (const b of books) {
      if (!b.work_id) continue;
      const sn = surname(b.author || '');
      const toks = sig(b.title || '').slice().sort().slice(0, 2);
      if (!sn || toks.length === 0) continue;
      const fk = `${sn}|${toks.join('-')}`;
      if (!byFamily.has(fk)) byFamily.set(fk, []);
      byFamily.get(fk).push(b);
    }
    const splitCandidates = [];
    for (const [fk, arr] of byFamily.entries()) {
      const wids = new Set(arr.map((b) => b.work_id));
      if (wids.size < 2) continue; // all one work_id already — no split to test
      // find a cross-work pair that passes the series guard
      let picked = null;
      const sh = shuffle(arr, rnd);
      outer: for (let i = 0; i < sh.length; i++) {
        for (let j = i + 1; j < sh.length; j++) {
          if (sh[i].work_id === sh[j].work_id) continue;
          if (!sameSeries(sh[i].title || '', sh[j].title || '')) continue;
          picked = [sh[i], sh[j]]; break outer;
        }
      }
      if (picked) splitCandidates.push({ fk, pair: picked });
    }
    const splitSample = stratifiedDraw(splitCandidates, SPLIT_SAMPLE, ({ pair }) => isGenericTitle(pair[0].title) || ourNamesake(pair[0].author));
    for (const { fk, pair } of splitSample) {
      const [a, b] = pair;
      const pid = pairId('split', a.id, b.id);
      const gn = isGenericTitle(a.title) || ourNamesake(a.author);
      manifest.push({ pair_id: pid, kind: 'split', left: bookMeta(a), right: bookMeta(b) });
      key[pid] = {
        kind: 'split',
        stratum: gn ? 'split · generic-namesake' : 'split · specific',
        family_key: fk,
        work_id_left: a.work_id, work_id_right: b.work_id,
        work_id_source_left: a.work_id_source ?? null, work_id_source_right: b.work_id_source ?? null,
        book_ids: [a.id, b.id],
      };
    }

    // ── Sanity asserts (mirror ft-catalog-match empty-bucket warnings) ─────────
    const byKind = manifest.reduce((m, p) => ((m[p.kind] = (m[p.kind] || 0) + 1), m), {});
    if (!demote.length) console.warn('[WARN] 0 demote_candidate links — the link-precision stratum is empty (all-Latin catalog; investigate before trusting).');
    for (const k of ['link', 'cocluster', 'split']) if (!byKind[k]) console.warn(`[WARN] stratum "${k}" drew 0 pairs.`);

    const summary = {
      built: DATE,
      issue: '#2885(b) — Tier-0 alignment-gold',
      seed: argSeed,
      purpose: 'Measure Tier-0 link precision, work_id co-cluster homogeneity, and split (recall) rate. Each item is a same-work y/n pair judgment. MEASURE-ONLY — no flips, no DB writes.',
      eligible_books: books.length,
      catalog_rows: catRows.length,
      n: manifest.length,
      by_kind: byKind,
      link_census: { demote_candidate: demote.length, needs_review_total: review.length, needs_review_sampled: reviewSample.length },
      note: 'UNPRIMED: the judge sees only left/right metadata. It must NOT be shown matcher_tier, guards, stratum, or work_id (those live in ft-alignment-scoringkey-<date>.json).',
    };

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const goldPath = path.join(RESULTS_DIR, `ft-alignment-gold-${DATE}.json`);
    const keyPath = path.join(RESULTS_DIR, `ft-alignment-scoringkey-${DATE}.json`);
    fs.writeFileSync(goldPath, JSON.stringify({ summary, manifest }, null, 2));
    fs.writeFileSync(keyPath, JSON.stringify(key, null, 2));

    console.log(`\n${summary.n} pairs drawn — ${JSON.stringify(byKind)}`);
    console.log(`  link census: ${demote.length} demote_candidate (ALL) + ${reviewSample.length}/${review.length} needs_review sampled`);
    console.log(`Wrote ${goldPath}`);
    console.log(`Wrote ${keyPath}  (HIDDEN — never show to a judge)`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
