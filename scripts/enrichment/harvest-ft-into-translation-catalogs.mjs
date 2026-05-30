#!/usr/bin/env node
/**
 * Harvest English-translation findings from MongoDB books.translation_verification
 * into Supabase translation_catalogs so the verify-translation agent can hit
 * them as cheap in-house lookups instead of always going to web search.
 *
 * Sources harvested (each gets its own source label so downstream callers can
 * weight by confidence):
 *   - translation_verification.translations[]             → sl_ft_catalog_verified
 *   - translation_verification.validated_translations[]   → sl_ft_catalog_verified
 *   - translation_verification.llm_knowledge_translations[] → sl_ft_llm_claim
 *
 * Dedup-on-write: BEFORE inserting each row we query for an existing match
 * on (author_surname, english_title, translator, pub_year). If a row already
 * exists, we skip the insert (regardless of source — we never downgrade).
 *
 * Why dedup-on-write rather than a UNIQUE constraint:
 *   - translation_catalogs has many rows where canonical_work is empty and
 *     english_title contains series names ("Ante-Nicene Christian Library")
 *     shared across 30+ distinct volumes. A blanket UNIQUE constraint on
 *     (author, work, translator, year) would over-collapse — measured
 *     5,085-6,330 rows lost including 1,652-2,851 distinct titles. Per-row
 *     check is slower but doesn't risk data loss.
 *
 * Cost: ~3,928 inserts × 1 SELECT + maybe 1 INSERT each = ~8K PostgREST calls,
 * ~1-2 minutes wall time, $0 LLM spend.
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

function normalize(s) {
  return (s || '').toLowerCase().trim();
}

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
  const raw = (book.display_title || book.title || '').trim();
  return raw
    .replace(/\s*[(\[][^\)\]]*[)\]]\s*$/g, '')
    .replace(/\b(vol(ume)?|tom(us|e)|book|part|pt|bk)\.?\s*[ivxlcdm\d]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Junk-translator patterns produced by LLM when the book is itself English-original
// or when no specific translation actually exists. The 2026-05-30 audit found ~50
// such rows in production from earlier harvest runs (Pordage / Knight / Hakluyt cases
// where book is English, LLM produced translator="Original Author" or "N/A").
// "unknown" is intentionally NOT in this list — anonymous early-modern
// translations are legitimately catalogued with translator='unknown' (e.g.
// 1688 Diogenes Laertius). Only block the clear LLM-placeholder forms.
const JUNK_TRANSLATOR_RE = /^(n\/a|not specified|tbd|none|original author|original)$/i;
const ORIGINAL_AUTHOR_RE = /\b(original author|original compiler)\b/i;

function isEnglishLanguage(language) {
  if (!language) return false;
  const l = language.toLowerCase().trim();
  return l === 'english' || l === 'en' || l === 'eng';
}

function authorMatchesTranslator(authorRaw, translatorRaw) {
  if (!authorRaw || !translatorRaw) return false;
  const norm = s => s.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').replace(/[,;].*$/, '').trim();
  return norm(authorRaw) === norm(translatorRaw);
}

function buildRow(book, trans, source, skipReasons) {
  if (!trans?.english_title) return null;
  const author = canonicalAuthor(book.author);
  const work = canonicalWork(book);
  if (!author || !work) return null;

  // Schema-error guards — see CLAUDE.md "verify-translation invariants" + 2026-05-30 audit
  if (isEnglishLanguage(book.language)) {
    skipReasons.english_source++;
    return null;
  }
  if (trans.translator && JUNK_TRANSLATOR_RE.test(trans.translator.trim())) {
    skipReasons.junk_translator++;
    return null;
  }
  if (trans.translator && ORIGINAL_AUTHOR_RE.test(trans.translator)) {
    skipReasons.original_author++;
    return null;
  }
  if (authorMatchesTranslator(book.author, trans.translator)) {
    skipReasons.author_eq_translator++;
    return null;
  }

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
  };
}

// ── Supabase ────────────────────────────────────────────────────────

async function existingRowId(row) {
  // Match on (author_surname_lower, english_title_lower, lower(translator), pub_year).
  // english_title is the most stable identifier; canonical_work is too often empty
  // / contains series names. Using PostgREST .eq syntax with NULL handled via is.null.
  const params = new URLSearchParams();
  params.set('select', 'id,source');
  params.set('limit', '1');
  if (row.author_surname) params.set('author_surname_lower', `eq.${row.author_surname.toLowerCase()}`);
  // Use ilike for case-insensitive english_title match
  if (row.english_title) params.set('english_title_lower', `eq.${row.english_title.toLowerCase()}`);
  if (row.translator) params.set('translator', `eq.${row.translator}`);
  else params.set('translator', 'is.null');
  if (row.pub_year) params.set('pub_year', `eq.${row.pub_year}`);
  else params.set('pub_year', 'is.null');

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/translation_catalogs?${params}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) return null;
  const matches = await resp.json();
  return matches.length ? matches[0] : null;
}

async function insertRow(row) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/translation_catalogs`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, error: `${resp.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

async function processRow(row) {
  const existing = await existingRowId(row);
  if (existing) return { result: 'skipped_existing', existing_source: existing.source };
  const res = await insertRow(row);
  return res.ok ? { result: 'inserted' } : { result: 'error', error: res.error };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

  console.log('=== Harvest FT findings → translation_catalogs ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  console.log('Dedup strategy: per-row SELECT before INSERT');
  if (limit) console.log('Per-pass limit:', limit);
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Pass 1: catalog-verified (highest sl_ft_* tier)
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

  const skipReasons1 = { english_source: 0, junk_translator: 0, original_author: 0, author_eq_translator: 0 };
  const tier1Rows = [];
  for (const b of tier1Books) {
    const v = b.translation_verification || {};
    const seenEnTitles = new Set();
    const sources = [...(v.validated_translations || []), ...(v.translations || [])];
    for (const t of sources) {
      const key = normalize(t.english_title);
      if (!key || seenEnTitles.has(key)) continue;  // skip in-book duplicates
      seenEnTitles.add(key);
      const row = buildRow(b, t, 'sl_ft_catalog_verified', skipReasons1);
      if (row) tier1Rows.push(row);
    }
  }

  // Pass 2: LLM claims
  const tier2Books = await db.collection('books').find({
    'translation_verification.llm_knowledge_translations.0': { $exists: true },
  }).project({
    id: 1, title: 1, display_title: 1, author: 1, language: 1,
    'translation_verification.llm_knowledge_translations': 1,
  }).toArray();

  const skipReasons2 = { english_source: 0, junk_translator: 0, original_author: 0, author_eq_translator: 0 };
  const tier2Rows = [];
  for (const b of tier2Books) {
    const seenEnTitles = new Set();
    for (const t of (b.translation_verification?.llm_knowledge_translations || [])) {
      const key = normalize(t.english_title);
      if (!key || seenEnTitles.has(key)) continue;
      seenEnTitles.add(key);
      const row = buildRow(b, t, 'sl_ft_llm_claim', skipReasons2);
      if (row) tier2Rows.push(row);
    }
  }

  await client.close();

  console.log(`Pass 1 (sl_ft_catalog_verified): ${tier1Rows.length} rows from ${tier1Books.length} books`);
  console.log(`  skipped (schema guards): ${JSON.stringify(skipReasons1)}`);
  console.log(`Pass 2 (sl_ft_llm_claim):        ${tier2Rows.length} rows from ${tier2Books.length} books`);
  console.log(`  skipped (schema guards): ${JSON.stringify(skipReasons2)}`);
  if (limit) {
    tier1Rows.splice(limit);
    tier2Rows.splice(limit);
    console.log(`  (capped to first ${limit} of each tier)`);
  }

  console.log('\nSample Pass 1 (first 3):');
  for (const r of tier1Rows.slice(0, 3)) {
    console.log(`  ${r.canonical_author} / "${r.english_title?.slice(0, 60)}" by ${r.translator || '?'} (${r.pub_year || '?'})`);
  }
  console.log('\nSample Pass 2 (first 3):');
  for (const r of tier2Rows.slice(0, 3)) {
    console.log(`  ${r.canonical_author} / "${r.english_title?.slice(0, 60)}" by ${r.translator || '?'} (${r.pub_year || '?'})`);
  }

  if (dryRun) {
    console.log('\nDry-run complete. Re-run with --apply.');
    return;
  }

  // Pass 1 first so highest-confidence rows are present before Pass 2 tries
  // to insert. Pass 2 will skip-existing on any (author, title, translator,
  // year) tuple already in Pass 1.
  const processList = async (label, rows) => {
    const counts = { inserted: 0, skipped_existing: 0, error: 0 };
    const errorSamples = [];
    for (let i = 0; i < rows.length; i++) {
      const r = await processRow(rows[i]);
      counts[r.result]++;
      if (r.result === 'error' && errorSamples.length < 5) errorSamples.push(r.error);
      if ((i + 1) % 200 === 0) {
        console.log(`  ${label}: ${i + 1}/${rows.length} (ins=${counts.inserted} skip=${counts.skipped_existing} err=${counts.error})`);
      }
    }
    return { counts, errorSamples };
  };

  console.log('\n→ Pass 1 (catalog_verified) ...');
  const p1 = await processList('P1', tier1Rows);
  console.log(`  Pass 1 final: inserted=${p1.counts.inserted}, skipped_existing=${p1.counts.skipped_existing}, errors=${p1.counts.error}`);
  if (p1.errorSamples.length) console.log('  Error samples:\n   ' + p1.errorSamples.join('\n   '));

  console.log('\n→ Pass 2 (llm_claim) ...');
  const p2 = await processList('P2', tier2Rows);
  console.log(`  Pass 2 final: inserted=${p2.counts.inserted}, skipped_existing=${p2.counts.skipped_existing}, errors=${p2.counts.error}`);
  if (p2.errorSamples.length) console.log('  Error samples:\n   ' + p2.errorSamples.join('\n   '));

  console.log('\nDone.');
  console.log(`  Total inserted:        ${p1.counts.inserted + p2.counts.inserted}`);
  console.log(`  Total skipped (dup):   ${p1.counts.skipped_existing + p2.counts.skipped_existing}`);
  console.log(`  Total errors:          ${p1.counts.error + p2.counts.error}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
