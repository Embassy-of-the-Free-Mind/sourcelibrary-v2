#!/usr/bin/env node
/**
 * Sync `books.pages_translated_es` — the per-book count of pages carrying a
 * Spanish edition (`pages.translations.es.data` or legacy `pages.translation_es.data`).
 *
 * Why a counter exists: the per-page Spanish fields are NOT indexed, so nothing
 * on a request path (the /es homepage band, the "Español" card tag, the
 * `en-espanol` collection) may scan `pages` for them. This script does the scan
 * once, offline, and writes the book-level number the app reads — the same
 * pattern as `pages_translated` / `pages_ocr`.
 *
 * Modes:
 *   --all                 full scan of `pages` (18.9M docs; minutes, run from Hetzner or detached)
 *   --book-ids a,b,c      recount only these books (indexed by book_id; seconds)
 *   --from-scan <file>    recount the books named in a prior scan's JSON `{counts:{book_id:n}}`
 *   --dry-run             print what would change, write nothing
 *
 * Books that previously had a count but now have no Spanish pages are reset to 0
 * in --all mode only (a partial mode cannot know who lost pages).
 *
 * Usage: node --env-file=.env.production.local scripts/maintenance/sync-pages-translated-es.mjs --all
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = has('--dry-run');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required'); process.exit(2); }

const ES_PAGE_FILTER = {
  $or: [
    { 'translations.es.data': { $exists: true, $nin: [null, ''] } },
    { 'translation_es.data': { $exists: true, $nin: [null, ''] } },
  ],
};

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

/** @returns {Map<string, number>} book_id → Spanish page count */
async function countAll() {
  const counts = new Map();
  let seen = 0;
  const cur = pages.find(ES_PAGE_FILTER, { projection: { book_id: 1 }, batchSize: 2000 });
  for await (const p of cur) {
    counts.set(p.book_id, (counts.get(p.book_id) || 0) + 1);
    if (++seen % 5000 === 0) process.stderr.write(`  scanned ${seen} Spanish pages across ${counts.size} books\r`);
  }
  process.stderr.write('\n');
  return counts;
}

async function countBooks(ids) {
  const counts = new Map();
  for (const id of ids) {
    counts.set(id, await pages.countDocuments({ book_id: id, ...ES_PAGE_FILTER }));
  }
  return counts;
}

let counts;
let fullMode = false;
if (has('--all')) {
  fullMode = true;
  counts = await countAll();
} else if (val('--book-ids')) {
  counts = await countBooks(val('--book-ids').split(',').map((s) => s.trim()).filter(Boolean));
} else if (val('--from-scan')) {
  const scan = JSON.parse(readFileSync(val('--from-scan'), 'utf8'));
  counts = await countBooks(Object.keys(scan.counts || {}));
} else {
  console.error('one of --all | --book-ids a,b | --from-scan file is required');
  process.exit(2);
}

// Books whose stored counter disagrees with the fresh count.
const ids = [...counts.keys()];
const existing = await books.find(
  fullMode ? { $or: [{ id: { $in: ids } }, { pages_translated_es: { $gt: 0 } }] } : { id: { $in: ids } },
  { projection: { _id: 0, id: 1, title: 1, pages_translated_es: 1, pages_count: 1 } },
).toArray();
const byId = new Map(existing.map((b) => [b.id, b]));
for (const id of ids) if (!byId.has(id)) console.warn(`  ! pages reference unknown book ${id} (${counts.get(id)} es pages) — skipped`);

let changed = 0;
for (const b of existing) {
  const next = counts.get(b.id) ?? 0; // in full mode an absent id means "lost all Spanish pages"
  const prev = b.pages_translated_es ?? 0;
  if (next === prev) continue;
  changed++;
  console.log(`${dryRun ? '[dry] ' : ''}${b.id}  ${prev} → ${next} / ${b.pages_count ?? '?'}  ${(b.title || '').slice(0, 60)}`);
  if (dryRun) continue;
  // `updated_at` is load-bearing, not cosmetic: the Supabase catalog sync is
  // incremental on `updated_at`, and books_catalog now mirrors this counter
  // (#4166). A counter changed here without the bump would never reach the
  // mirror, so a /es card would keep linking to the English page (#3445).
  const r = await books.updateOne({ id: b.id }, { $set: { pages_translated_es: next, updated_at: new Date() } });
  if (r.modifiedCount !== 1) console.warn(`  ! updateOne for ${b.id} modified ${r.modifiedCount}`);
  await recordSweepAction(db, {
    sweep: 'sync-pages-translated-es',
    book_id: b.id,
    action: 'set-pages-translated-es',
    detail: { from: prev, to: next },
  });
}

const total = [...counts.values()].reduce((a, n) => a + n, 0);
console.log(`\n${ids.length} books with Spanish pages (${total} pages); ${changed} counters ${dryRun ? 'would change' : 'updated'}.`);
await client.close();
