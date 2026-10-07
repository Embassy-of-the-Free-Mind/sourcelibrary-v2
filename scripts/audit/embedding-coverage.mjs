#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-texts-coverage.mjs — the same question for ONE
 * store and ONE language (`page_texts`, `--lang=es`), and it is the model this
 * follows. It cannot see the other five stores, which is where all three
 * September gaps were. Also checked: scripts/audit/semantic-language-filter-recall.mjs
 * (asks whether a language FILTER pre-filters, not whether rows exist),
 * scripts/maintenance/delete-stale-embeddings.mjs (orphans — rows with no book,
 * the opposite direction), scripts/audit/gemini-usage-perimeter.mjs (whether a
 * call site records spend, not whether it produced anything). Nothing existing
 * answers "is each embedding store still being written, and how much of its
 * denominator does it cover".
 *
 * embedding-coverage — is every embedding store still being written, and how
 * much of the thing it indexes does it actually hold? (#4868)
 *
 * WHY THIS EXISTS. On 2026-09-15 three separate gaps had been running for
 * weeks with nothing to show for them:
 *
 *   book_embeddings ............ 39.3% of live books
 *   page vectors, untranslated . 3% (23,200 books, 651,412 pages invisible)
 *   gallery_text_embeddings .... newest row 9 Aug; 10,051 images added since
 *
 * The cause was one line: both embedders consulted the UNSCOPED spend guard, so
 * every scheduled run was refused once the daily dial was spent, which is daily
 * (#4865). The crons were alive and the logs rotated nightly; they simply wrote
 * nothing.
 *
 * It is silent by construction: on every read path an unembedded book and a
 * book nothing matches return the SAME empty list, so no query can tell them
 * apart. Coverage has to be measured on the write side, which is this.
 *
 * TWO INSTRUMENT RULES, both learned by getting them wrong the same day:
 *
 *  1. ASSERT THE PROBE FIRES. The first pass at this measurement reported "0%
 *     of books have page vectors". It was wrong: `page_translations` has no
 *     `id` column, every request failed on the column name, and a missing
 *     Content-Range header was read as a count of zero. A positive control on
 *     a known-present row caught it. So every counter here goes through
 *     `count()`, which returns null — never 0 — when the response carries no
 *     count, and a null anywhere makes the run report UNKNOWN and exit 2. An
 *     audit that cannot tell "broken" from "nothing there" is not measuring
 *     anything (see measurement-instruments.md).
 *
 *  2. `page_translations.updated_at` IS NOT A WRITE TIMESTAMP. It mirrors the
 *     Mongo source's `updated_at` (that is what `--restale` compares), so a
 *     freshness check reading it reports the table as months stale while it is
 *     being written to right now — verified mid-backfill on 2026-08-07, when it
 *     read "42d ago". Freshness here comes from `created_at` where the table
 *     has one, and from row-count deltas otherwise.
 *
 * Report-only. It files nothing, writes nothing, and costs nothing: pure counts
 * over PostgREST and Mongo, no embedding calls.
 *
 * PER-BOOK GAP (#5869). Store totals hid a 910K-page hole: page_translations
 * held millions of rows, so the table looked healthy while 37% of live books
 * were under 90% embedded — the incremental watermark had skipped them. The
 * per-book line counts rows per book (one GROUP BY over direct PG, ~5 min) and
 * reports live books with rows < 90% of max(pages_translated, pages_ocr), plus
 * the translated pages they are missing (pages_translated − rows, floored at 0
 * — a lower bound, since a book's rows may include untranslated pages).
 * `--gap-list PATH` writes those books, most missing translated pages first,
 * as the input for a `--books-file` backfill. `--no-per-book` skips it.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/embedding-coverage.mjs
 *   node --env-file=.env.production.local scripts/audit/embedding-coverage.mjs --gap-list /tmp/gap.json
 *   node --env-file=.env.production.local scripts/audit/embedding-coverage.mjs --json
 *   node --env-file=.env.production.local scripts/audit/embedding-coverage.mjs --ci
 *
 * Exit codes: 0 = measured (findings are printed, not fatal), 2 = UNKNOWN
 * (a probe did not fire — the measurement is void), 1 = --ci and a store looks
 * dark (no rows added in 24h while its denominator grew).
 */

import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const CI = args.includes('--ci');
const PER_BOOK = !args.includes('--no-per-book');
const GAP_LIST = args.find((_, i, a) => a[i - 1] === '--gap-list');
const GAP_THRESHOLD = 0.9;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — cannot measure. UNKNOWN.');
  process.exit(2);
}

const HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  Prefer: 'count=exact',
  Range: '0-0',
};

/**
 * Exact row count for a table, optionally filtered.
 *
 * Returns null — NOT 0 — when the response carries no Content-Range. That is
 * the difference between "the table is empty" and "the request never ran", and
 * conflating them is how this measurement was wrong the first time.
 */
async function count(table, { select = '*', filter = '' } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter}&limit=1`;
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    console.error(`  probe failed: ${table} — ${err.message}`);
    return null;
  }
  if (!res.ok) {
    console.error(`  probe failed: ${table} — HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
    return null;
  }
  const range = res.headers.get('content-range');
  if (!range || !range.includes('/')) return null;
  const total = Number(range.split('/').pop());
  return Number.isFinite(total) ? total : null;
}

const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

/** ObjectId whose timestamp prefix is `ms` — `gallery_images` has no created_at. */
function objectIdAtTime(ms) {
  return ObjectId.createFromTime(Math.floor(ms / 1000));
}

/**
 * Each store, its id column (they differ — `page_translations` has no `id`,
 * which is the trap), and whether it carries a real write timestamp.
 */
const STORES = [
  { table: 'page_translations', select: 'page_id', createdAt: null },
  { table: 'book_embeddings', select: 'book_id', createdAt: 'created_at' },
  { table: 'artwork_embeddings', select: 'book_id', createdAt: 'created_at' },
  { table: 'gallery_text_embeddings', select: 'id', createdAt: 'created_at' },
  { table: 'clip_embeddings', select: 'id', createdAt: 'created_at' },
  // `page_texts` has no `created_at`. It carries `updated_at` AND a separate
  // `mongo_updated_at`, which suggests the former is the row's own write time —
  // unlike `page_translations`, where `updated_at` mirrors Mongo. "Suggests" is
  // not good enough for an instrument, so it is treated as having no verified
  // write timestamp until someone confirms the writer sets it. Promote it here
  // once that is checked.
  { table: 'page_texts', select: 'page_id', createdAt: null },
];

const out = { measured_at: new Date().toISOString(), stores: {}, denominators: {}, per_book: null, findings: [] };
let unknown = false;

for (const s of STORES) {
  const rows = await count(s.table, { select: s.select });
  let added24h = null;
  if (s.createdAt) {
    added24h = await count(s.table, { select: s.select, filter: `&${s.createdAt}=gte.${since24h}` });
  }
  if (rows === null || (s.createdAt && added24h === null)) unknown = true;
  out.stores[s.table] = { rows, added_24h: added24h, freshness_column: s.createdAt };
}

// Denominators from Mongo. `visible: true && pages_count > 0` is the canonical
// live filter (CLAUDE.md); artworks are counted separately because they carry
// pages_count: 0 by construction.
await withMongo(async (db) => {
  const books = db.collection('books');
  const live = { visible: true, pages_count: { $gt: 0 } };
  out.denominators.live_books = await books.countDocuments(live);
  out.denominators.live_books_translated = await books.countDocuments({ ...live, pages_translated: { $gt: 0 } });
  out.denominators.artworks_enriched = await books.countDocuments({
    content_type: 'artwork',
    'enrichment.description': { $exists: true, $ne: null },
  });
  out.denominators.gallery_images = await db.collection('gallery_images').countDocuments({});
  const agg = await books.aggregate([
    { $match: live },
    { $group: { _id: null, ocr: { $sum: '$pages_ocr' }, translated: { $sum: '$pages_translated' } } },
  ]).toArray();
  out.denominators.live_pages_ocr = agg[0]?.ocr ?? null;
  out.denominators.live_pages_translated = agg[0]?.translated ?? null;
  out.denominators.gallery_images_24h = await db.collection('gallery_images').countDocuments({
    _id: { $gt: objectIdAtTime(Date.now() - 24 * 3600 * 1000) },
  });

  if (PER_BOOK) out.per_book = await perBookGap(db, live);
});

/**
 * Per-book coverage of page_translations against each live book's own page
 * counts. Returns null (→ UNKNOWN) when the row counts cannot be read: a book
 * with no rows and a probe that never ran must not look the same.
 */
async function perBookGap(db, live) {
  if (!process.env.SUPABASE_DB_URL) {
    console.error('  per-book: SUPABASE_DB_URL not set — cannot count rows per book.');
    return null;
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  let rowsByBook;
  try {
    await client.connect();
    await client.query('SET statement_timeout = 900000');
    const { rows } = await client.query('SELECT book_id, count(*)::int AS n FROM page_translations GROUP BY book_id');
    rowsByBook = new Map(rows.map((r) => [r.book_id, r.n]));
  } catch (err) {
    console.error(`  per-book: row count failed — ${err.message}`);
    return null;
  } finally {
    await client.end().catch(() => {});
  }
  // Positive control: an empty map means the probe misfired, not a dark store.
  if (rowsByBook.size === 0) return null;

  const books = await db.collection('books')
    .find(live, { projection: { id: 1, pages_translated: 1, pages_ocr: 1 } })
    .toArray();
  let measured = 0;
  let zeroRows = 0;
  let missingTranslated = 0;
  const gap = [];
  for (const b of books) {
    const target = Math.max(b.pages_translated || 0, b.pages_ocr || 0);
    if (!target) continue;
    measured++;
    const rows = rowsByBook.get(b.id) || 0;
    if (rows >= GAP_THRESHOLD * target) continue;
    if (rows === 0) zeroRows++;
    const missT = Math.max(0, (b.pages_translated || 0) - rows);
    missingTranslated += missT;
    gap.push({ id: b.id, rows, pages_translated: b.pages_translated || 0, pages_ocr: b.pages_ocr || 0, missing_translated: missT });
  }
  gap.sort((a, b) => b.missing_translated - a.missing_translated || (b.pages_ocr - b.rows) - (a.pages_ocr - a.rows));
  return {
    live_books_with_text: measured,
    under_90pct: gap.length,
    zero_rows: zeroRows,
    missing_translated_pages: missingTranslated,
    worst: gap.slice(0, 5),
    gap,
  };
}

if (PER_BOOK && !out.per_book) unknown = true;

if (unknown) {
  console.error('\nUNKNOWN — at least one probe did not fire. Nothing here is a measurement.');
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  process.exit(2);
}

// A store is "dark" when it gained nothing in 24h while its denominator moved.
// Only stores with a real write timestamp can be judged this way; the others
// need a stored watermark, which is a follow-up rather than a silent guess.
const darkChecks = [
  { table: 'gallery_text_embeddings', grew: out.denominators.gallery_images_24h },
  { table: 'clip_embeddings', grew: out.denominators.gallery_images_24h },
];
for (const c of darkChecks) {
  const st = out.stores[c.table];
  if (st.added_24h === 0 && c.grew > 0) {
    out.findings.push(`${c.table}: 0 rows added in 24h while ${c.grew} gallery images were created — writer may be refused or failing (check the cron log for "CEILING REACHED" and for a phase exiting non-zero).`);
  }
}
const bookCoverage = out.stores.book_embeddings.rows / (out.denominators.live_books || 1);
if (bookCoverage < 0.95) {
  out.findings.push(`book_embeddings: ${out.stores.book_embeddings.rows} rows against ${out.denominators.live_books} live books — book-level retrieval is partial.`);
}

const pb = out.per_book;
if (pb && pb.under_90pct > 0) {
  out.findings.push(`page_translations per book: ${pb.under_90pct.toLocaleString()} / ${pb.live_books_with_text.toLocaleString()} live books under ${GAP_THRESHOLD * 100}% embedded (${pb.zero_rows.toLocaleString()} with zero rows), ≥${pb.missing_translated_pages.toLocaleString()} translated pages with no vector — the store total does not show this (#5869).`);
}
if (pb && GAP_LIST) {
  const fs = await import('node:fs');
  fs.writeFileSync(GAP_LIST, JSON.stringify(pb.gap, null, 1));
  console.error(`per-book gap list (${pb.gap.length} books) → ${GAP_LIST}`);
}
// The full list is for --gap-list; keep JSON output readable.
if (pb) delete pb.gap;

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('EMBEDDING COVERAGE\n');
  for (const [t, v] of Object.entries(out.stores)) {
    const fresh = v.freshness_column ? `${v.added_24h?.toLocaleString()} in 24h` : 'no write timestamp (see header)';
    console.log(`  ${t.padEnd(24)} ${String(v.rows?.toLocaleString()).padStart(12)} rows   ${fresh}`);
  }
  if (pb) {
    console.log(`\n  per-book (live, rows < ${GAP_THRESHOLD * 100}% of max(pages_translated, pages_ocr)):`);
    console.log(`    under ${GAP_THRESHOLD * 100}%: ${pb.under_90pct.toLocaleString()} / ${pb.live_books_with_text.toLocaleString()} books   zero rows: ${pb.zero_rows.toLocaleString()}   translated pages missing: ≥${pb.missing_translated_pages.toLocaleString()}`);
    for (const w of pb.worst) console.log(`      ${w.id}  ${w.rows} rows / ${w.pages_translated} translated / ${w.pages_ocr} ocr`);
  }
  console.log('\n  denominators:');
  for (const [k, v] of Object.entries(out.denominators)) {
    console.log(`    ${k.padEnd(26)} ${v?.toLocaleString()}`);
  }
  if (out.findings.length) {
    console.log('\n  findings:');
    for (const f of out.findings) console.log(`    - ${f}`);
  } else {
    console.log('\n  ✔ no findings.');
  }
}

process.exit(CI && out.findings.length ? 1 : 0);
