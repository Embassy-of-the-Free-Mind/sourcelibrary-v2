#!/usr/bin/env node
/**
 * Enumerate → dedupe → source: the disciplined import workflow.
 *
 * Generalizes what we did by hand for the Daoist batches (2026-06-01). Given a
 * source query, it:
 *   1. ENUMERATE — list candidate items from a source (Internet Archive today;
 *      pluggable for others).
 *   2. DEDUPE     — drop anything we already hold (exact match on the same
 *      source_fingerprint the import routes use, via src/lib/dedup.ts), and flag
 *      likely-same-work candidates by normalized title.
 *   3. REVIEW     — emit a candidate list (JSON + readable table) for a human/
 *      curator to subject-filter BEFORE import. It does NOT import. Keyword
 *      enumeration is noisy (Confucian/math/drama texts match stray characters),
 *      so the subject-filter step is deliberately manual.
 *
 * This is the "do it for all imports" loop, made repeatable. Importing the
 * approved subset is a separate step (per-source import scripts / /api/import/*),
 * where the in-route checkDuplicate() is the final exact-match safety net.
 *
 * Usage (run with tsx):
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/import/enumerate-dedupe-source.ts --ia-collection universallibrary --q '參同契 OR 悟真篇' --out /tmp/cand.json
 *   npx tsx scripts/import/enumerate-dedupe-source.ts --ia-query 'collection:(americana) AND alchemy' --rows 200
 *
 * Flags:
 *   --ia-collection NAME   IA collection to scope to (combined with --q)
 *   --q TERMS              query terms (OR/AND ok); combined with --ia-collection
 *   --ia-query RAW         raw IA advancedsearch query (overrides the two above)
 *   --rows N               max candidates to pull (default 200)
 *   --min-images N         skip items with fewer than N page images (default 10)
 *   --resolve-images       for items the search index gives no imagecount for,
 *                          read the real page count from IA's IIIF manifest.
 *                          Needed for whole channels (eGangotri: 0% coverage).
 *   --resolve-concurrency N  parallel manifest fetches while resolving (default 4).
 *                          Do NOT raise this casually: at 12 archive.org
 *                          throttled us to an 87% failure rate within minutes.
 *   --out PATH             write candidate JSON here (default: stdout table only)
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { normalizeTitle, normalizeAuthor, sourceFingerprint } from '../../src/lib/dedup';

function arg(name: string, def: string | null = null) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }

const IA_COLLECTION = arg('--ia-collection');
const Q = arg('--q');
const IA_QUERY_RAW = arg('--ia-query');
const ROWS = parseInt(arg('--rows', '200'), 10);
const MIN_IMAGES = parseInt(arg('--min-images', '10'), 10);
const OUT = arg('--out');
const RESOLVE_IMAGES = process.argv.includes('--resolve-images');
const RESOLVE_CONCURRENCY = parseInt(arg('--resolve-concurrency', '4'), 10);

// Page count for an item whose `imagecount` the search index does not carry.
// Same first step the /api/import/ia route uses (IIIF canvases), so a count
// here matches the count the import will actually produce.
// A short deadline is deliberate. Measured over eGangotri: a manifest either
// answers in ~0.6-3s or does not answer at all, and ~25% fall in the second
// group. Waiting 25s and then RETRYING them turned a 4-minute job into a
// 4-hour one for no extra data. Unknown is a fine answer here — the import
// route resolves the count itself and fails closed if it cannot.
async function resolveImageCount(identifier: string): Promise<number | null> {
  try {
    const r = await fetch(`https://iiif.archive.org/iiif/${identifier}/manifest.json`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const m = await r.json();
    if (Array.isArray(m.items)) return m.items.length;
    if (Array.isArray(m.sequences?.[0]?.canvases)) return m.sequences[0].canvases.length;
    return null;
  } catch {
    return null;
  }
}

function buildIaQuery() {
  if (IA_QUERY_RAW) return IA_QUERY_RAW;
  const parts = ['mediatype:(texts)'];
  if (IA_COLLECTION) parts.push(`collection:(${IA_COLLECTION})`);
  if (Q) parts.push(`(${Q})`);
  return parts.join(' AND ');
}

// ── ENUMERATE (Internet Archive) ─────────────────────────────────────────────
async function enumerateIA() {
  const q = buildIaQuery();
  const fields = ['identifier', 'title', 'creator', 'year', 'imagecount', 'language'];
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}`
    + fields.map(f => `&fl[]=${f}`).join('')
    + `&rows=${ROWS}&output=json`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`IA search HTTP ${r.status}`);
  const j = await r.json();
  return (j.response?.docs || []).map(d => ({
    source: 'internet_archive',
    ia_identifier: d.identifier,
    title: Array.isArray(d.title) ? d.title[0] : (d.title || ''),
    author: Array.isArray(d.creator) ? d.creator[0] : (d.creator || ''),
    year: d.year || null,
    // `imagecount` is ABSENT from the advancedsearch index for whole channels
    // (every eGangotri item, for one). Coercing that to 0 made --min-images
    // reject 100% of them as THIN — a missing field read as an empty book.
    // null means "unknown", which is not the same as "none": resolve it with
    // --resolve-images, never silently treat it as a reason to skip.
    images: d.imagecount != null && d.imagecount !== '' ? Number(d.imagecount) : null,
    language: Array.isArray(d.language) ? d.language.join(',') : (d.language || ''),
  }));
}

// ── DEDUPE (against current holdings) ────────────────────────────────────────
async function loadHeldIndex(db) {
  // Pull the dedup keys for every book: source_fingerprint + normalized_title.
  const docs = await db.collection('books')
    .find({}, { projection: { _id: 0, source_fingerprint: 1, normalized_title: 1, normalized_author: 1, ia_identifier: 1, visible: 1 } })
    .toArray();
  const byFingerprint = new Set();
  const byNormTitle = new Map(); // normTitle -> [{title-ish}]
  for (const d of docs) {
    if (d.source_fingerprint) byFingerprint.add(d.source_fingerprint);
    if (d.ia_identifier) byFingerprint.add(`ia:${d.ia_identifier}`);
    if (d.normalized_title) {
      if (!byNormTitle.has(d.normalized_title)) byNormTitle.set(d.normalized_title, []);
      byNormTitle.get(d.normalized_title).push({ na: d.normalized_author, vis: d.visible });
    }
  }
  return { byFingerprint, byNormTitle, total: docs.length };
}

function classify(cand, held) {
  const fp = sourceFingerprint(cand); // uses ia_identifier → "ia:..."
  if (fp && held.byFingerprint.has(fp)) return { status: 'HELD', reason: `fingerprint ${fp}` };
  const nt = normalizeTitle(cand.title || '');
  const na = normalizeAuthor(cand.author || '');
  if (nt.length >= 5 && held.byNormTitle.has(nt)) {
    const authors = held.byNormTitle.get(nt);
    const sameAuthor = authors.some(a => a.na === na);
    return { status: sameAuthor ? 'LIKELY_DUP' : 'TITLE_CLASH', reason: `normTitle "${nt}"${sameAuthor ? ' + author' : ''}` };
  }
  return { status: 'NEW', reason: '' };
}

async function main() {
  if (!IA_COLLECTION && !Q && !IA_QUERY_RAW) {
    console.error('Provide --ia-collection and/or --q, or --ia-query. See header.');
    process.exit(1);
  }
  console.error(`ENUMERATE: ${buildIaQuery()}  (rows≤${ROWS})`);
  const candidates = await enumerateIA();
  console.error(`  → ${candidates.length} items from source`);

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const held = await loadHeldIndex(client.db('bookstore'));
  await client.close();
  console.error(`DEDUPE: against ${held.total} held books`);

  if (RESOLVE_IMAGES) {
    const unknown = candidates.filter(c => c.images == null);
    console.error(`RESOLVE: ${unknown.length} items have no imagecount — reading page counts from IA's IIIF manifests`);
    let done = 0, failed = 0, next = 0;
    // Worker pool, NOT fixed batches: with batches, one slow manifest blocks the
    // other five in its group, and the whole pass runs at the speed of its worst
    // item. Each worker just takes the next index when it is free.
    // Bail if the source has clearly stopped answering us, instead of grinding
    // through thousands of items at a 0% success rate and calling it progress
    // (the #4341 lesson: a swallowed failure reads as slow, not as blocked).
    let aborted = false;
    const worker = async () => {
      for (;;) {
        if (aborted) return;
        const i = next++;
        if (i >= unknown.length) return;
        unknown[i].images = await resolveImageCount(unknown[i].ia_identifier);
        if (unknown[i].images == null) failed++;
        if (++done % 200 === 0) console.error(`  …${done}/${unknown.length} (${failed} unresolved)`);
        if (done >= 120 && failed / done > 0.6) {
          aborted = true;
          console.error(`  ABORT: ${failed}/${done} manifest fetches failed (>60%). archive.org is almost certainly throttling —`);
          console.error(`  lower --resolve-concurrency (4 is the tested default) or drop --resolve-images. Sizes stay UNKNOWN_SIZE, which is honest.`);
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, RESOLVE_CONCURRENCY) }, worker));
    // Say what stayed unknown. A silent skip here would put items back in the
    // same hole the missing-imagecount bug dug.
    console.error(`  resolved ${done - failed}/${unknown.length}; ${failed} still unknown (manifest fetch failed)`);
  }

  // Dedupe WITHIN the candidate list, not only against holdings. A source can
  // carry the same item twice: eGangotri re-uploads manuscripts with a
  // `_2017xx` identifier suffix, and 431 of 1,689 tantra candidates were such
  // pairs. Nothing downstream would have caught it — each id is genuinely new
  // to us, so both would import as separate books.
  const seenBase = new Map<string, string>();
  for (const c of candidates) {
    const base = String(c.ia_identifier).replace(/_\d{6}$/, '').toLowerCase();
    if (!seenBase.has(base)) seenBase.set(base, c.ia_identifier);
  }

  const rows = candidates.map(c => {
    const cls = classify(c, held);
    if (cls.status !== 'NEW') return { ...c, status: cls.status, reason: cls.reason };
    const base = String(c.ia_identifier).replace(/_\d{6}$/, '').toLowerCase();
    const keeper = seenBase.get(base);
    if (keeper && keeper !== c.ia_identifier) {
      return { ...c, status: 'REUPLOAD', reason: `same item as ${keeper} (source re-upload)` };
    }
    // Unknown size is a gap in our knowledge, not a property of the book.
    if (c.images == null) return { ...c, status: 'UNKNOWN_SIZE', reason: 'no imagecount; re-run with --resolve-images' };
    const tooThin = c.images < MIN_IMAGES;
    return { ...c, status: tooThin ? 'THIN' : 'NEW', reason: tooThin ? `${c.images} images < ${MIN_IMAGES}` : cls.reason };
  });

  const counts = rows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
  console.error(`\nRESULT: ${JSON.stringify(counts)}`);
  console.error(`  NEW = not held, worth subject-filtering for import.`);
  console.error(`  LIKELY_DUP / HELD = skip. TITLE_CLASH = same title diff author (check). THIN = too few images.`);
  console.error(`  REUPLOAD = the SAME item twice in this list (source re-upload) — import the keeper only.`);
  console.error(`  UNKNOWN_SIZE = source gave no imagecount — NOT a judgement about the book; re-run with --resolve-images.\n`);

  // Readable table — NEW first
  const order = { NEW: 0, TITLE_CLASH: 1, UNKNOWN_SIZE: 2, THIN: 3, REUPLOAD: 4, LIKELY_DUP: 5, HELD: 6 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || String(a.title).localeCompare(String(b.title)));
  for (const r of rows) {
    console.log(`  [${r.status.padEnd(11)}] ${String(r.ia_identifier).padEnd(16)} img=${String(r.images).padStart(4)} | ${String(r.title).slice(0, 50)}`);
  }

  if (OUT) {
    // UNKNOWN_SIZE rides along: dropping it here would hide the very items the
    // missing-imagecount bug used to swallow.
    const newOnes = rows.filter(r => r.status === 'NEW' || r.status === 'TITLE_CLASH' || r.status === 'UNKNOWN_SIZE');
    writeFileSync(OUT, JSON.stringify({ query: buildIaQuery(), generatedFrom: candidates.length, heldCount: held.total, counts, candidates: newOnes }, null, 2));
    console.error(`\nWrote ${newOnes.length} review candidates (NEW + TITLE_CLASH + UNKNOWN_SIZE) → ${OUT}`);
    console.error(`Next: subject-filter this list by hand, then import the approved ids.`);
  }
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
