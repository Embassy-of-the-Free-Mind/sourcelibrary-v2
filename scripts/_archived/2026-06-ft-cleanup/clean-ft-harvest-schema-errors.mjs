#!/usr/bin/env node
/**
 * Purge schema-error rows from translation_catalogs that came from earlier
 * FT-harvest runs before the input guards in harvest-ft-into-translation-catalogs.mjs
 * existed.
 *
 * 2026-05-30 audit (.claude/projects/.../memory/project_verify_translation_agent_findings.md)
 * identified four signatures of malformed rows in sl_ft_catalog_verified and
 * sl_ft_llm_claim sources:
 *
 *   1. translator == canonical_author exact match (Budge translating Budge)
 *   2. translator matches the LLM's "I don't know" placeholders (N/A, TBD,
 *      "Original Author", etc.) — these mean the source book was already English
 *      and the LLM correctly refused to invent a translator
 *   3. translator contains "Original Author" / "Original Compiler" parenthetical
 *   4. Source book has language='English' in Mongo (handled at harvest time only —
 *      no SQL-side cleanup needed, ~3 rows in production)
 *
 * Idempotent: safe to re-run, will delete 0 rows on subsequent passes.
 *
 * Usage:
 *   node scripts/maintenance/clean-ft-harvest-schema-errors.mjs            # dry-run
 *   node scripts/maintenance/clean-ft-harvest-schema-errors.mjs --apply    # apply
 */

import pg from 'pg';
import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env.production.local', 'utf8').split('\n')) {
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
if (!env.SUPABASE_DB_URL) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }
const apply = process.argv.includes('--apply');

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();

const SOURCES = "('sl_ft_catalog_verified', 'sl_ft_llm_claim')";

// Pattern 1: translator == canonical_author
const r1 = await c.query(`
  SELECT id, canonical_author, english_title, translator, pub_year, source
  FROM translation_catalogs
  WHERE source IN ${SOURCES}
    AND translator IS NOT NULL AND canonical_author IS NOT NULL
    AND lower(trim(translator)) = lower(trim(canonical_author))
`);
console.log(`Pattern 1 (translator == canonical_author): ${r1.rows.length} rows`);
for (const r of r1.rows.slice(0, 5)) console.log(`  [${r.source}] ${r.canonical_author} → "${(r.english_title||'').slice(0,45)}" by ${r.translator} (${r.pub_year})`);

// Pattern 2: junk translator placeholders
// NB: "unknown" is intentionally excluded — legitimate pre-modern catalog records
// (e.g. anonymous 1688 Diogenes Laertius translation) have translator='unknown'.
const r2 = await c.query(`
  SELECT id, canonical_author, english_title, translator, pub_year, source
  FROM translation_catalogs
  WHERE source IN ${SOURCES}
    AND lower(trim(translator)) IN ('n/a', 'not specified', 'tbd', 'none', 'original author', 'original')
`);
console.log(`\nPattern 2 (junk translator placeholders): ${r2.rows.length} rows`);
for (const r of r2.rows.slice(0, 5)) console.log(`  [${r.source}] ${r.canonical_author} → "${(r.english_title||'').slice(0,45)}" by ${r.translator} (${r.pub_year})`);

// Pattern 3: translator contains "Original Author" / "Original Compiler"
const r3 = await c.query(`
  SELECT id, canonical_author, english_title, translator, pub_year, source
  FROM translation_catalogs
  WHERE source IN ${SOURCES}
    AND translator ~* '\\m(original author|original compiler)\\M'
    AND id NOT IN (SELECT id FROM translation_catalogs
                   WHERE lower(trim(translator)) IN ('original author', 'original'))
`);
console.log(`\nPattern 3 (translator contains "Original Author" parenthetical): ${r3.rows.length} rows`);
for (const r of r3.rows.slice(0, 5)) console.log(`  [${r.source}] ${r.canonical_author} → "${(r.english_title||'').slice(0,45)}" by ${r.translator} (${r.pub_year})`);

// Pattern 4: source book in Mongo is already English. Cross-reference distinct
// (canonical_author, canonical_work) pairs from sl_ft_* sources against Mongo.
// Slow but bounded — ~2600 distinct pairs to check.
console.log(`\nPattern 4 (source book already English, Mongo cross-check)…`);
const mongo = new MongoClient(env.MONGODB_URI); await mongo.connect();
const db = mongo.db('bookstore');
const distinctPairs = await c.query(`
  SELECT DISTINCT canonical_author, canonical_work
  FROM translation_catalogs
  WHERE source IN ${SOURCES}
    AND canonical_author IS NOT NULL AND canonical_work IS NOT NULL
`);
const r4ids = [];
let checked = 0;
for (const pair of distinctPairs.rows) {
  checked++;
  const surnameHint = (pair.canonical_author || '').split(/[,;()]/)[0].split(/\s+/).pop()?.slice(0, 20) || '';
  const titleHint = (pair.canonical_work || '').slice(0, 30).replace(/[^\w\s]/g, '').trim();
  if (surnameHint.length < 3 || titleHint.length < 4) continue;
  // Escape regex metacharacters to avoid MongoDB regex parse errors
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const book = await db.collection('books').findOne(
    {
      author: { $regex: esc(surnameHint), $options: 'i' },
      $or: [
        { title: { $regex: esc(titleHint), $options: 'i' } },
        { display_title: { $regex: esc(titleHint), $options: 'i' } },
      ],
    },
    { projection: { language: 1 } }
  );
  if (!book) continue;
  if (book.language && /^(english|en|eng)$/i.test(book.language)) {
    // Pull all rows for this pair
    const ids = await c.query(
      `SELECT id FROM translation_catalogs WHERE source IN ${SOURCES} AND canonical_author = $1 AND canonical_work = $2`,
      [pair.canonical_author, pair.canonical_work]
    );
    for (const row of ids.rows) r4ids.push(row.id);
  }
}
await mongo.close();
console.log(`  Pattern 4: ${r4ids.length} rows tied to English-language source books (scanned ${checked} pairs)`);

const allIds = new Set([
  ...r1.rows.map(r => r.id),
  ...r2.rows.map(r => r.id),
  ...r3.rows.map(r => r.id),
  ...r4ids,
]);
console.log(`\nTotal distinct rows to delete: ${allIds.size}`);

if (!apply) {
  console.log('\nDry-run. Re-run with --apply to delete.');
  await c.end();
  process.exit(0);
}

const ids = Array.from(allIds);
const batch = 500;
let deleted = 0;
for (let i = 0; i < ids.length; i += batch) {
  const chunk = ids.slice(i, i + batch);
  const placeholders = chunk.map((_, j) => `$${j + 1}`).join(',');
  const r = await c.query(`DELETE FROM translation_catalogs WHERE id IN (${placeholders})`, chunk);
  deleted += r.rowCount;
}
console.log(`\nDeleted ${deleted} rows from translation_catalogs.`);

const after = await c.query(`SELECT source, count(*) FROM translation_catalogs WHERE source IN ${SOURCES} GROUP BY source`);
console.log('Post-cleanup sl_ft_* counts:');
for (const r of after.rows) console.log(`  ${r.source}: ${r.count}`);

await c.end();
