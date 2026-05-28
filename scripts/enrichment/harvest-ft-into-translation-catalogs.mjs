#!/usr/bin/env node
/**
 * Harvest English-translation findings from MongoDB books.translation_verification
 * into Supabase translation_catalogs so the verify-translation agent can hit
 * them as cheap in-house lookups instead of always going to web search.
 *
 * Sources harvested (each gets its own source label so downstream callers can
 * weight by confidence):
 *   - translation_verification.translations[]             → sl_ft_catalog_verified
 *     (Stage 1 catalog hit; Stage 2 may or may not have verified the ID)
 *   - translation_verification.validated_translations[]   → sl_ft_catalog_verified
 *     (Stage 2 Path A — Stage 1 found it AND Stage 2 confirmed catalog ID)
 *   - translation_verification.llm_knowledge_translations[] → sl_ft_llm_claim
 *     (Stage 2 Path B — LLM said yes, no catalog corroboration; ~15-20% hallucination)
 *
 * Idempotency: relies on the UNIQUE constraint added by
 * 20260528000000_translation_catalogs_dedup_key.sql. Without that migration,
 * this script will create duplicates — RUN THE MIGRATION FIRST.
 *
 * Dedup ratchet: if a row already exists with a higher-confidence source,
 * the existing row is preserved (no downgrade). Implemented via
 * `Prefer: resolution=merge-duplicates` + a server-side trigger or, simpler,
 * by ordering inserts highest-confidence-first so the constraint rejects
 * subsequent lower-confidence dups.
 *
 * Usage:
 *   node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs           # dry-run
 *   node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs --apply
 *   node scripts/enrichment/harvest-ft-into-translation-catalogs.mjs --apply --limit 200
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing MONGODB_URI / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractSurname(authorStr) {
  if (!authorStr) return '';
  const cleaned = authorStr.split(/[;|]/)[0].trim();
  const comma = cleaned.indexOf(',');
  let name = comma > 0 ? cleaned.substring(0, comma) : cleaned;
  name = name.replace(/\b(saint|st\.?|von|de|van|del|di|da|al-)\b/gi, '').trim();
  const parts = name.split(/\s+/);
  return (parts[parts.length - 1] || '').toLowerCase();
}

function canonicalAuthor(authorStr) {
  if (!authorStr) return '';
  return authorStr.split(/[;|]/)[0].trim();
}

function canonicalWork(book) {
  // Prefer the book's display_title (curator-set) over raw title; fall back to title.
  // Strip trailing volume / edition markers.
  const raw = (book.display_title || book.title || '').trim();
  return raw
    .replace(/\s*[(\[][^\)\]]*[)\]]\s*$/g, '')
    .replace(/\b(vol(ume)?|tom(us|e)|book|part|pt|bk)\.?\s*[ivxlcdm\d]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRow(book, trans, source) {
  if (!trans?.english_title) return null;
  const author = canonicalAuthor(book.author);
  const work = canonicalWork(book);
  if (!author || !work) return null;
  return {
    source,
    author: book.author || author,
    author_surname: extractSurname(book.author),
    canonical_author: author,
    english_title: trans.english_title,
    original_title: book.title || '',
    canonical_work: work,
    translator: trans.translator || null,
    pub_year: trans.pub_year || null,
    publisher: trans.publisher || null,
    series: trans.series || null,
    completeness: trans.completeness || 'unknown',
    // _lower columns are STORED generated — Postgres fills them automatically
  };
}

// ── Supabase upsert ─────────────────────────────────────────────────

async function upsertBatch(rows) {
  // Use PostgREST's merge-duplicates resolution. Server-side trigger or
  // application-side ordering handles the confidence-ratchet (we send
  // highest-confidence sources first so subsequent dup-key inserts are
  // discarded by the UNIQUE constraint).
  if (!rows.length) return { inserted: 0, errored: 0 };
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/translation_catalogs`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { inserted: 0, errored: rows.length, error: `${resp.status}: ${body.slice(0, 300)}` };
  }
  return { inserted: rows.length, errored: 0 };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

  console.log('=== Harvest FT findings → translation_catalogs ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  if (limit) console.log('Per-source limit:', limit);
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // ── Pass 1: catalog-verified (highest sl_ft_* tier — write first) ──
  const tier1Books = await db.collection('books').find({
    $or: [
      { 'translation_verification.validated_translations.0': { $exists: true } },
      { 'translation_verification.translations.0': { $exists: true } },
    ],
  }).project({
    id: 1, title: 1, display_title: 1, author: 1, language: 1,
    'translation_verification.translations': 1,
    'translation_verification.validated_translations': 1,
  }).toArray();

  const tier1Rows = [];
  for (const b of tier1Books) {
    const v = b.translation_verification || {};
    const sources = [...(v.validated_translations || []), ...(v.translations || [])];
    for (const t of sources) {
      const row = buildRow(b, t, 'sl_ft_catalog_verified');
      if (row) tier1Rows.push(row);
    }
  }

  // ── Pass 2: LLM claims (lower tier — written after) ──
  const tier2Books = await db.collection('books').find({
    'translation_verification.llm_knowledge_translations.0': { $exists: true },
  }).project({
    id: 1, title: 1, display_title: 1, author: 1, language: 1,
    'translation_verification.llm_knowledge_translations': 1,
  }).toArray();

  const tier2Rows = [];
  for (const b of tier2Books) {
    for (const t of (b.translation_verification?.llm_knowledge_translations || [])) {
      const row = buildRow(b, t, 'sl_ft_llm_claim');
      if (row) tier2Rows.push(row);
    }
  }

  await client.close();

  console.log(`Pass 1 (sl_ft_catalog_verified): ${tier1Rows.length} rows from ${tier1Books.length} books`);
  console.log(`Pass 2 (sl_ft_llm_claim):        ${tier2Rows.length} rows from ${tier2Books.length} books`);

  if (limit) {
    tier1Rows.splice(limit);
    tier2Rows.splice(limit);
    console.log(`  (capped to first ${limit} of each tier)`);
  }

  // Sample what we'd insert
  console.log('\nSample Pass 1 rows (first 3):');
  for (const r of tier1Rows.slice(0, 3)) {
    console.log(`  [${r.source}] ${r.canonical_author} / ${r.canonical_work}`);
    console.log(`              "${r.english_title}" by ${r.translator || '?'} (${r.pub_year || '?'})`);
  }
  console.log('\nSample Pass 2 rows (first 3):');
  for (const r of tier2Rows.slice(0, 3)) {
    console.log(`  [${r.source}] ${r.canonical_author} / ${r.canonical_work}`);
    console.log(`              "${r.english_title}" by ${r.translator || '?'} (${r.pub_year || '?'})`);
  }

  if (dryRun) {
    console.log('\nDry-run complete. Re-run with --apply.');
    return;
  }

  // Insert in batches of 500. Pass 1 first (so higher-confidence rows win
  // when later Pass 2 rows hit the dup key).
  const BATCH = 500;
  let p1Inserted = 0, p1Err = 0;
  for (let i = 0; i < tier1Rows.length; i += BATCH) {
    const r = await upsertBatch(tier1Rows.slice(i, i + BATCH));
    p1Inserted += r.inserted;
    p1Err += r.errored;
    if (r.error) console.log(`  Pass 1 batch ${i / BATCH + 1} ERR: ${r.error}`);
    if ((i / BATCH) % 10 === 0) console.log(`  Pass 1 progress: ${i + BATCH}/${tier1Rows.length}`);
  }

  let p2Inserted = 0, p2Err = 0;
  for (let i = 0; i < tier2Rows.length; i += BATCH) {
    const r = await upsertBatch(tier2Rows.slice(i, i + BATCH));
    p2Inserted += r.inserted;
    p2Err += r.errored;
    if (r.error) console.log(`  Pass 2 batch ${i / BATCH + 1} ERR: ${r.error}`);
    if ((i / BATCH) % 10 === 0) console.log(`  Pass 2 progress: ${i + BATCH}/${tier2Rows.length}`);
  }

  console.log(`\nDone.`);
  console.log(`  Pass 1: attempted ${tier1Rows.length}, accepted ~${p1Inserted}, errored ${p1Err}`);
  console.log(`  Pass 2: attempted ${tier2Rows.length}, accepted ~${p2Inserted}, errored ${p2Err}`);
  console.log(`  (Dup-key rejections show as accepted by PostgREST when Prefer:resolution=ignore-duplicates;`);
  console.log(`   actual net insert count visible by re-running the COUNT in task #12.)`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
