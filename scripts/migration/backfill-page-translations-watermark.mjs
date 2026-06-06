#!/usr/bin/env node
/**
 * Backfill mongo_updated_at on page_translations from the source Mongo page.
 *
 * Scale: ~3.9M rows. Batched by book_id (200-1000 pages per batch typically).
 * Resumable: tracks progress in scripts/migration/.backfill-watermark.state
 * Dry-run by default — pass --apply to write.
 *
 * Freshness chain (matches embed-gemini.mjs:435):
 *   pages.translation.updated_at  →  pages.ocr.updated_at  →  pages.updated_at
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-page-translations-watermark.mjs --dry-run
 *   node scripts/migration/backfill-page-translations-watermark.mjs --apply
 *   node scripts/migration/backfill-page-translations-watermark.mjs --apply --resume
 *   node scripts/migration/backfill-page-translations-watermark.mjs --apply --book <book_id>
 *
 * Env required: MONGODB_URI, SUPABASE_DB_URL (direct PG; the REST API can't
 * handle the per-row UPDATE rate efficiently).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '.backfill-watermark.state');

// ── Args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESUME = args.includes('--resume');
const BOOK_ID = args.find((_, i, a) => a[i - 1] === '--book');
const LIMIT_BOOKS = parseInt(args.find((_, i, a) => a[i - 1] === '--limit-books') || '0') || 0;

if (!APPLY) {
  console.log('DRY RUN — no writes. Pass --apply to commit.');
}

// ── Env ───────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
if (!MONGODB_URI || !SUPABASE_DB_URL) {
  console.error('Missing env: MONGODB_URI and SUPABASE_DB_URL required.');
  process.exit(1);
}

// ── Clients ──────────────────────────────────────────────────────────

const mongo = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongo.connect();
const db = mongo.db('bookstore');

const pgClient = new pg.Client({
  connectionString: SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();
await pgClient.query('SET statement_timeout = 60000');

// ── Resume state ─────────────────────────────────────────────────────

function loadState() {
  if (!RESUME) return { processedBookIds: [] };
  if (!fs.existsSync(STATE_FILE)) return { processedBookIds: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();
const doneSet = new Set(state.processedBookIds);
if (doneSet.size > 0) console.log(`Resuming — ${doneSet.size} books already processed`);

// ── Plan ─────────────────────────────────────────────────────────────

let bookIds;
if (BOOK_ID) {
  bookIds = [BOOK_ID];
} else {
  console.log('Listing distinct book_ids with NULL mongo_updated_at...');
  const res = await pgClient.query(`
    SELECT DISTINCT book_id
      FROM page_translations
     WHERE mongo_updated_at IS NULL
     ORDER BY book_id
  `);
  bookIds = res.rows.map(r => r.book_id).filter(id => !doneSet.has(id));
  console.log(`${bookIds.length.toLocaleString()} book_ids remaining to backfill`);
  if (LIMIT_BOOKS > 0) {
    bookIds = bookIds.slice(0, LIMIT_BOOKS);
    console.log(`(limited to first ${LIMIT_BOOKS} for this run)`);
  }
}

// ── Backfill loop ────────────────────────────────────────────────────

let totalRows = 0;
let totalUpdated = 0;
let totalSkipped = 0;
const start = Date.now();

for (let bookIdx = 0; bookIdx < bookIds.length; bookIdx++) {
  const bookId = bookIds[bookIdx];

  // Fetch Mongo pages for this book — only the freshness fields we need
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, {
      projection: {
        _id: 1,
        page_number: 1,
        'translation.updated_at': 1,
        'ocr.updated_at': 1,
        updated_at: 1,
      },
    })
    .toArray();
  if (pages.length === 0) {
    doneSet.add(bookId);
    continue;
  }

  // Build (page_id → freshness) map. page_id in Supabase is the Mongo
  // ObjectId hex string (per embed-gemini.mjs:426 → item.page.id).
  const freshness = new Map();
  for (const p of pages) {
    const ts = p.translation?.updated_at || p.ocr?.updated_at || p.updated_at;
    if (ts) freshness.set(String(p._id), ts);
  }
  if (freshness.size === 0) {
    doneSet.add(bookId);
    continue;
  }

  // Fetch the corresponding Supabase rows (page_id only)
  const { rows: ptRows } = await pgClient.query(
    `SELECT page_id FROM page_translations WHERE book_id = $1 AND mongo_updated_at IS NULL`,
    [bookId],
  );
  totalRows += ptRows.length;

  let updated = 0;
  let skipped = 0;
  if (APPLY) {
    // Group updates by timestamp to batch them (UPDATE ... WHERE page_id = ANY($2))
    const byTs = new Map();
    for (const r of ptRows) {
      const ts = freshness.get(r.page_id);
      if (!ts) { skipped++; continue; }
      const key = new Date(ts).toISOString();
      if (!byTs.has(key)) byTs.set(key, []);
      byTs.get(key).push(r.page_id);
    }
    for (const [tsIso, pageIds] of byTs) {
      const res = await pgClient.query(
        `UPDATE page_translations SET mongo_updated_at = $1 WHERE page_id = ANY($2::text[])`,
        [tsIso, pageIds],
      );
      updated += res.rowCount;
    }
  } else {
    for (const r of ptRows) {
      if (freshness.has(r.page_id)) updated++;
      else skipped++;
    }
  }

  totalUpdated += updated;
  totalSkipped += skipped;
  doneSet.add(bookId);

  if ((bookIdx + 1) % 25 === 0 || bookIdx === bookIds.length - 1) {
    const elapsed = (Date.now() - start) / 1000;
    const rate = Math.round(totalUpdated / Math.max(elapsed, 1));
    console.log(`  [${bookIdx + 1}/${bookIds.length}] ${bookId} → ${updated} updated, ${skipped} no-mongo-ts. Total ${totalUpdated.toLocaleString()} (${rate}/s)`);
    if (APPLY) saveState({ processedBookIds: [...doneSet] });
  }
}

if (APPLY) saveState({ processedBookIds: [...doneSet] });

console.log(`\nDone. ${totalRows.toLocaleString()} rows inspected, ${totalUpdated.toLocaleString()} updated, ${totalSkipped.toLocaleString()} skipped (no Mongo timestamp).`);

await pgClient.end();
await mongo.close();
