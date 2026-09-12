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
 *     evidence: [{book_id, page_number, kind, gloss, context}] (≤5, distinct books; context = ≤120 chars of translation before a <term>/<note original>),
 *     type, type_source, type_confidence, type_id (with --types; scripts/lib/page-terms-type.mjs),
 *     field_provenance: {source, method, kept_because, rule, date} }
 *
 * Keep rules live in scripts/lib/page-terms-keep.mjs. `--rule pilot` (default) is the
 * original rule — any gloss, any non-Latin, <term> in ≥2 books, verified original in ≥2,
 * <vocab> in ≥3 — which kept 5.18M of 11.6M groups on the full corpus and grows linearly
 * with it. `--rule bridge` is the book-floored rule (1.21M rows measured 2026-09-11) and is
 * what --apply should use; the default stays `pilot` so the flag change is reviewable.
 *
 * Two input modes:
 *   shards (default)  --in-dir <dir>: load new shards into SQLite, group, emit. Hours on the
 *                     full corpus — the per-group detail re-query dominates.
 *   --from-global <global.jsonl>: re-read a table THIS script already wrote, re-apply the
 *                     keep rule, re-stamp provenance (+ types), emit. Minutes, no SQLite.
 *                     This is how a rule or typing change reaches Mongo without re-grouping.
 *
 *   node scripts/maintenance/aggregate-page-terms.mjs --in-dir <dir> [--db page-terms.sqlite] [--out global.jsonl]
 *   node scripts/maintenance/aggregate-page-terms.mjs --from-global global.jsonl --rule bridge --types types.jsonl --out kept.jsonl --apply
 *   pilot thresholds: --min-term-books 2 --min-orig-books 2 --min-vocab-books 3 --min-nonlatin-books 1
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { isLatinScript } from '../lib/page-terms-parse.mjs';
import { KEEP_RULES, RULE_NAMES } from '../lib/page-terms-keep.mjs';

const args = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const FROM_GLOBAL = getArg('--from-global');
const IN_DIR = getArg('--in-dir') || 'scripts/output/page-terms';
const DB_PATH = getArg('--db') || path.join(IN_DIR, '..', 'page-terms.sqlite');
const OUT = getArg('--out') || (FROM_GLOBAL ? FROM_GLOBAL.replace(/\.jsonl$/, '') + '-kept.jsonl' : path.join(IN_DIR, '..', 'page-terms-global.jsonl'));
const APPLY = args.includes('--apply');
const REBUILD = args.includes('--rebuild');
const RULE = getArg('--rule') || 'pilot';
const TYPES = getArg('--types');
const METHOD = 'aggregate-page-terms.mjs@3';
// Pilot-rule thresholds (distinct books per kind). Ignored by --rule bridge.
const PILOT_T = {
  minTermBooks: Number(getArg('--min-term-books') || 2),
  minOrigBooks: Number(getArg('--min-orig-books') || 2),
  minVocabBooks: Number(getArg('--min-vocab-books') || 3),
  minNonLatinBooks: Number(getArg('--min-nonlatin-books') || 1),
};

if (!RULE_NAMES.includes(RULE)) { console.error(`--rule must be one of ${RULE_NAMES.join('|')}`); process.exit(1); }
if (APPLY && !process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
if (FROM_GLOBAL && path.resolve(FROM_GLOBAL) === path.resolve(OUT)) { console.error('--out must differ from --from-global'); process.exit(1); }
const keep = (row) => KEEP_RULES[RULE](row, PILOT_T);

// ---- typing overlay (sparse: absent key = concept/unmatched) ----
const types = new Map();
if (TYPES) {
  const rl = readline.createInterface({ input: fs.createReadStream(TYPES), crlfDelay: Infinity });
  for await (const line of rl) { if (!line) continue; const t = JSON.parse(line); types.set(t.term_key, t); }
  console.log(`types: ${types.size} overlay rows from ${TYPES}`);
}
const stampType = (row) => {
  if (!TYPES) return row;
  const t = types.get(row.term_key);
  row.type = t?.type ?? 'concept';
  row.type_source = t?.type_source ?? 'unmatched';
  row.type_confidence = t?.type_confidence ?? null;
  row.type_id = t?.type_id ?? null;
  return row;
};

// ---- output: fs.writeSync, NOT a WriteStream ----
// The group loop outruns the disk and an un-awaited stream.write() buffers everything in
// memory — the first corpus run was OOM-killed at 9.8 GB RSS after 4 GiB of output; a
// WriteStream also fails at exactly 4 GiB (writev, Node 25). (2026-09-11)
const outFd = fs.openSync(OUT, 'w');
const stats = { groups: 0, kept: 0, why: {}, types: {} };
const now = new Date();
// --apply streams upserts in batches of 1,000 as rows are produced; nothing is retained.
let col = null, written = 0;
const batch = [];
async function flush() {
  if (!batch.length) return;
  if (!col) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    col = client.db('bookstore').collection('page_terms');
    await col.createIndex({ term_key: 1 }, { unique: true });
    await col.createIndex({ books: -1 });
    await col.createIndex({ 'glosses.gloss': 1 });
    await col.createIndex({ type: 1, books: -1 });
    process.on('exit', () => client.close());
  }
  const res = await col.bulkWrite(batch.splice(0), { ordered: false });
  written += res.upsertedCount + res.matchedCount;
}
async function emit(row, why) {
  stats.kept++;
  stats.why[why] = (stats.why[why] || 0) + 1;
  stampType(row);
  if (TYPES) stats.types[row.type] = (stats.types[row.type] || 0) + 1;
  row.field_provenance = { ...row.field_provenance, method: METHOD, kept_because: why, rule: RULE, date: now };
  fs.writeSync(outFd, JSON.stringify(row) + '\n');
  if (APPLY) {
    batch.push({ replaceOne: { filter: { term_key: row.term_key }, replacement: row, upsert: true } });
    if (batch.length >= 1000) await flush();
  }
}

if (FROM_GLOBAL) {
  // ---- re-filter an existing global table ----
  const rl = readline.createInterface({ input: fs.createReadStream(FROM_GLOBAL), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const row = JSON.parse(line);
    stats.groups++;
    const why = keep(row);
    if (why) await emit(row, why);
    if (stats.groups % 1000000 === 0) console.log(`${stats.groups} rows · kept ${stats.kept}`);
  }
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const zlib = await import('node:zlib');
  if (REBUILD && fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const sql = new DatabaseSync(DB_PATH);
  sql.exec(`
    PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA temp_store = FILE;
    CREATE TABLE IF NOT EXISTS raw (term_key TEXT, term TEXT, kind TEXT, lang TEXT, gloss TEXT, book_id TEXT, page_number INTEGER, verified INTEGER, context TEXT);
    CREATE TABLE IF NOT EXISTS loaded (book_id TEXT PRIMARY KEY);
  `);

  // ---- load shards (skip books already loaded) ----
  const shards = fs.readdirSync(IN_DIR).filter((f) => f.endsWith('.jsonl') || f.endsWith('.jsonl.gz'));
  const isLoaded = sql.prepare('SELECT 1 FROM loaded WHERE book_id = ?');
  const markLoaded = sql.prepare('INSERT INTO loaded (book_id) VALUES (?)');
  const ins = sql.prepare('INSERT INTO raw VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  let loaded = 0, rows = 0;
  for (const f of shards) {
    const bookId = f.replace(/\.jsonl(\.gz)?$/, '');
    if (isLoaded.get(bookId)) continue;
    const buf = fs.readFileSync(path.join(IN_DIR, f));
    const text = f.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    sql.exec('BEGIN');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      ins.run(r.term_key, r.term, r.kind, r.lang ?? null, r.gloss ?? null, r.book_id, r.page_number, r.verified === true ? 1 : r.verified === false ? 0 : null, r.context ?? null);
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
           SUM(gloss IS NOT NULL) AS glossed, COUNT(DISTINCT gloss) AS glosses_distinct
    FROM raw GROUP BY term_key
  `);
  const detail = sql.prepare('SELECT term, kind, lang, gloss, book_id, page_number, verified, context FROM raw WHERE term_key = ? ORDER BY (gloss IS NULL), (context IS NULL)');
  const distinctBooksBy = sql.prepare("SELECT COUNT(DISTINCT book_id) AS b FROM raw WHERE term_key = ? AND kind = ? AND (? IS NULL OR verified = ?)");
  const distinctGlosses = sql.prepare('SELECT DISTINCT gloss FROM raw WHERE term_key = ? AND gloss IS NOT NULL LIMIT 20');

  /** The rule's view of a group, before the (slow) detail pass. Per-kind book counts and the
   *  gloss strings are fetched lazily — only the branch that needs them pays for the query. */
  const preRow = (g, nonLatin) => ({
    term_key: g.term_key, books: g.books, non_latin: nonLatin,
    kinds: { vocab: g.k_vocab, term: g.k_term, keyword: g.k_keyword, original: g.k_original },
    original_verified: g.ov,
    get glosses() { return g.glossed ? (nonLatin ? distinctGlosses.all(g.term_key) : Array.from({ length: g.glosses_distinct }, () => ({ gloss: null }))) : []; },
    get term_books() { return distinctBooksBy.get(g.term_key, 'term', null, null).b; },
    get orig_books() { return distinctBooksBy.get(g.term_key, 'original', 1, 1).b; },
    get vocab_books() { return distinctBooksBy.get(g.term_key, 'vocab', null, null).b; },
  });

  for (const g of groups.iterate()) {
    stats.groups++;
    const nonLatin = !isLatinScript(g.term_key);
    const why = keep(preRow(g, nonLatin));
    if (!why) continue;

    const surface = new Map(), langs = {}, glosses = new Map(), evidence = [], evBooks = new Set();
    for (const d of detail.iterate(g.term_key)) {
      surface.set(d.term, (surface.get(d.term) || 0) + 1);
      if (d.lang) langs[d.lang] = (langs[d.lang] || 0) + 1;
      if (d.gloss) glosses.set(d.gloss, (glosses.get(d.gloss) || 0) + 1);
      if (evidence.length < 5 && !evBooks.has(d.book_id) && (d.kind !== 'original' || d.verified === 1)) {
        evBooks.add(d.book_id);
        evidence.push({ book_id: d.book_id, page_number: d.page_number, kind: d.kind, gloss: d.gloss, context: d.context });
      }
    }
    await emit({
      term_key: g.term_key,
      term: [...surface.entries()].sort((a, b) => b[1] - a[1])[0][0],
      kinds: { vocab: g.k_vocab, term: g.k_term, keyword: g.k_keyword, original: g.k_original },
      langs,
      glosses: [...glosses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([gloss, n]) => ({ gloss, n })),
      books: g.books, pages: g.pages,
      original_verified: g.ov, original_unverified: g.ou,
      non_latin: nonLatin,
      evidence,
      field_provenance: { source: 'ocr.data <vocab> + translation.data <term>/<gloss>/<keywords>/<note original>' },
    }, why);
  }
  console.log(`sqlite → ${DB_PATH}`);
}

if (APPLY) await flush();
fs.closeSync(outFd);
console.log(JSON.stringify({ ...stats, rule: RULE, typed: !!TYPES }));
console.log(`global table → ${OUT}`);
if (APPLY) console.log(`page_terms: ${written} rows upserted`);
