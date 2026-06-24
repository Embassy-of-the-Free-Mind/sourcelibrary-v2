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
    images: d.imagecount || 0,
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

  const rows = candidates.map(c => {
    const cls = classify(c, held);
    const tooThin = (c.images || 0) < MIN_IMAGES;
    return { ...c, status: tooThin && cls.status === 'NEW' ? 'THIN' : cls.status, reason: tooThin ? `${c.images} images < ${MIN_IMAGES}` : cls.reason };
  });

  const counts = rows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {});
  console.error(`\nRESULT: ${JSON.stringify(counts)}`);
  console.error(`  NEW = not held, worth subject-filtering for import.`);
  console.error(`  LIKELY_DUP / HELD = skip. TITLE_CLASH = same title diff author (check). THIN = too few images.\n`);

  // Readable table — NEW first
  const order = { NEW: 0, TITLE_CLASH: 1, THIN: 2, LIKELY_DUP: 3, HELD: 4 };
  rows.sort((a, b) => (order[a.status] - order[b.status]) || String(a.title).localeCompare(String(b.title)));
  for (const r of rows) {
    console.log(`  [${r.status.padEnd(11)}] ${String(r.ia_identifier).padEnd(16)} img=${String(r.images).padStart(4)} | ${String(r.title).slice(0, 50)}`);
  }

  if (OUT) {
    const newOnes = rows.filter(r => r.status === 'NEW' || r.status === 'TITLE_CLASH');
    writeFileSync(OUT, JSON.stringify({ query: buildIaQuery(), generatedFrom: candidates.length, heldCount: held.total, counts, candidates: newOnes }, null, 2));
    console.error(`\nWrote ${newOnes.length} review candidates (NEW + TITLE_CLASH) → ${OUT}`);
    console.error(`Next: subject-filter this list by hand, then import the approved ids.`);
  }
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
