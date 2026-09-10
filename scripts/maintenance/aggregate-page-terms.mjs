#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/build-page-terms.mjs (pass 1, produces the shards this reads);
// scripts/enrichment/dedup-entities.mjs (canonicalises NAMES into entity_aliases — different
// unit, no glosses, no page evidence). #4695.
/**
 * aggregate-page-terms — PASS 2 of two (#4695). Reduce the per-book shards written by
 * build-page-terms.mjs into ONE global term table and write only that to Mongo `page_terms`.
 *
 * Why not write the shards themselves: 10.5 distinct terms per page ≈ 70M per-book rows
 * corpus-wide, most of them one-off names and OCR noise. The concept vocabulary we want is
 * the recurring, glossed, or original-script tail. Grouping is done in SQLite (node:sqlite,
 * on disk) because the global key set does not fit in memory.
 *
 * Global row (one per term_key):
 *   { term_key, term (most frequent surface form), kinds: {vocab,term,keyword,original},
 *     langs: {Latin: n, …}, glosses: [{gloss, n}] (top 5), books: n, pages: n,
 *     original_verified: n, original_unverified: n,
 *     evidence: [{book_id, page_number, kind, gloss}] (≤5, distinct books),
 *     field_provenance: {source, method, date} }
 *
 * Kept for Mongo (--apply) when ANY of: has a gloss; <term>-tagged in ≥2 books; verified
 * original in ≥2 books; <vocab> in ≥3 books; non-Latin script. Everything else stays in the
 * SQLite file (queryable there). Rows are upserted by term_key, so re-running after new
 * shards is safe.
 *
 *   node scripts/maintenance/aggregate-page-terms.mjs --in-dir <dir> [--db page-terms.sqlite] [--out global.jsonl]
 *   node scripts/maintenance/aggregate-page-terms.mjs --in-dir <dir> --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MongoClient } from 'mongodb';
import { isLatinScript } from '../lib/page-terms-parse.mjs';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const IN_DIR = getArg('--in-dir') || 'scripts/output/page-terms';
const DB_PATH = getArg('--db') || path.join(IN_DIR, '..', 'page-terms.sqlite');
const OUT = getArg('--out') || path.join(IN_DIR, '..', 'page-terms-global.jsonl');
const APPLY = args.includes('--apply');
const REBUILD = args.includes('--rebuild');
const METHOD = 'aggregate-page-terms.mjs@1';

if (APPLY && !process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

if (REBUILD && fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
const sql = new DatabaseSync(DB_PATH);
sql.exec(`
  PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;
  CREATE TABLE IF NOT EXISTS raw (term_key TEXT, term TEXT, kind TEXT, lang TEXT, gloss TEXT, book_id TEXT, page_number INTEGER, verified INTEGER);
  CREATE TABLE IF NOT EXISTS loaded (book_id TEXT PRIMARY KEY);
`);

// ---- load shards (skip books already loaded) ----
const shards = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.jsonl'));
const isLoaded = sql.prepare('SELECT 1 FROM loaded WHERE book_id = ?');
const markLoaded = sql.prepare('INSERT INTO loaded (book_id) VALUES (?)');
const ins = sql.prepare('INSERT INTO raw VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
let loaded = 0, rows = 0;
for (const f of shards) {
  const bookId = f.replace(/\.jsonl$/, '');
  if (isLoaded.get(bookId)) continue;
  const text = fs.readFileSync(path.join(IN_DIR, f), 'utf8');
  sql.exec('BEGIN');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    ins.run(r.term_key, r.term, r.kind, r.lang ?? null, r.gloss ?? null, r.book_id, r.page_number, r.verified === true ? 1 : r.verified === false ? 0 : null);
    rows++;
  }
  markLoaded.run(bookId);
  sql.exec('COMMIT');
  loaded++;
  if (loaded % 500 === 0) console.log(`loaded ${loaded} shards · ${rows} rows`);
}
console.log(`shards: ${shards.length} (${loaded} newly loaded, ${rows} rows)`);
sql.exec('CREATE INDEX IF NOT EXISTS raw_key ON raw (term_key)');

// ---- group ----
const groups = sql.prepare(`
  SELECT term_key,
         COUNT(*) AS n,
         COUNT(DISTINCT book_id) AS books,
         COUNT(DISTINCT book_id || ':' || page_number) AS pages,
         SUM(kind='vocab') AS k_vocab, SUM(kind='term') AS k_term, SUM(kind='keyword') AS k_keyword, SUM(kind='original') AS k_original,
         SUM(kind='original' AND verified=1) AS ov, SUM(kind='original' AND verified=0) AS ou,
         SUM(gloss IS NOT NULL) AS glossed
  FROM raw GROUP BY term_key
`);
const detail = sql.prepare('SELECT term, kind, lang, gloss, book_id, page_number, verified FROM raw WHERE term_key = ?');
const distinctBooksBy = sql.prepare("SELECT COUNT(DISTINCT book_id) AS b FROM raw WHERE term_key = ? AND kind = ? AND (? IS NULL OR verified = ?)");

const out = fs.createWriteStream(OUT, { flags: 'w' });
const stats = { groups: 0, kept: 0, why: { gloss: 0, term2: 0, orig2: 0, vocab3: 0, nonLatin: 0 } };
const kept = [];
const now = new Date();
for (const g of groups.iterate()) {
  stats.groups++;
  const nonLatin = !isLatinScript(g.term_key);
  let why = null;
  if (g.glossed > 0) why = 'gloss';
  else if (nonLatin) why = 'nonLatin';
  else if (g.k_term > 0 && distinctBooksBy.get(g.term_key, 'term', null, null).b >= 2) why = 'term2';
  else if (g.ov > 0 && distinctBooksBy.get(g.term_key, 'original', 1, 1).b >= 2) why = 'orig2';
  else if (g.k_vocab > 0 && distinctBooksBy.get(g.term_key, 'vocab', null, null).b >= 3) why = 'vocab3';
  if (!why) continue;
  stats.kept++; stats.why[why]++;

  const surface = new Map(), langs = {}, glosses = new Map(), evidence = [], evBooks = new Set();
  for (const d of detail.iterate(g.term_key)) {
    surface.set(d.term, (surface.get(d.term) || 0) + 1);
    if (d.lang) langs[d.lang] = (langs[d.lang] || 0) + 1;
    if (d.gloss) glosses.set(d.gloss, (glosses.get(d.gloss) || 0) + 1);
    if (evidence.length < 5 && !evBooks.has(d.book_id) && (d.kind !== 'original' || d.verified === 1)) {
      evBooks.add(d.book_id);
      evidence.push({ book_id: d.book_id, page_number: d.page_number, kind: d.kind, gloss: d.gloss });
    }
  }
  const row = {
    term_key: g.term_key,
    term: [...surface.entries()].sort((a, b) => b[1] - a[1])[0][0],
    kinds: { vocab: g.k_vocab, term: g.k_term, keyword: g.k_keyword, original: g.k_original },
    langs,
    glosses: [...glosses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([gloss, n]) => ({ gloss, n })),
    books: g.books, pages: g.pages,
    original_verified: g.ov, original_unverified: g.ou,
    non_latin: nonLatin,
    evidence,
    field_provenance: { source: 'ocr.data <vocab> + translation.data <term>/<gloss>/<keywords>/<note original>', method: METHOD, kept_because: why, date: now },
  };
  out.write(JSON.stringify(row) + '\n');
  if (APPLY) kept.push(row);
}
await new Promise((r) => out.end(r));
console.log(JSON.stringify(stats));
console.log(`global table → ${OUT}; sqlite → ${DB_PATH}`);

if (APPLY) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const col = client.db('bookstore').collection('page_terms');
  await col.createIndex({ term_key: 1 }, { unique: true });
  await col.createIndex({ books: -1 });
  await col.createIndex({ 'glosses.gloss': 1 });
  let written = 0;
  for (let i = 0; i < kept.length; i += 1000) {
    const batch = kept.slice(i, i + 1000).map((r) => ({ replaceOne: { filter: { term_key: r.term_key }, replacement: r, upsert: true } }));
    const res = await col.bulkWrite(batch, { ordered: false });
    written += res.upsertedCount + res.modifiedCount + res.matchedCount;
  }
  await client.close();
  console.log(`page_terms: ${written} rows upserted`);
}
