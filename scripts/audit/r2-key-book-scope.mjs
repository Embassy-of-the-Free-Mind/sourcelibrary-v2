#!/usr/bin/env node
/**
 * Audit: every page's stored image URL must be scoped to its own book (#3362).
 *
 * THE INVARIANT
 *   pages.archived_photo / display_photo / thumbnail_blob, when they point at our
 *   own R2 under an `archived/` or `pages/` prefix, must contain that page's
 *   `book_id`. A URL that doesn't is shared between books.
 *
 * WHY IT MATTERS
 *   In Mar–Apr 2026 a missing `book_id` in an archiver's projection sent every
 *   page to `archived/undefined/<page_number>.jpg` — one object per page number,
 *   shared by every book archiving at the time. OCR then read those URLs and
 *   transcribed other books' pages into hundreds of books, which propagated into
 *   translations. Nothing errored: R2 served a real 200-OK JPEG.
 *
 *   This audit is the cheap standing check that turns that six-day silent
 *   window into a one-query alarm.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/r2-key-book-scope.mjs              # sampled sweep (fast)
 *   node scripts/audit/r2-key-book-scope.mjs --full       # every page (slow)
 *   node scripts/audit/r2-key-book-scope.mjs --book <id>  # one book
 *   node scripts/audit/r2-key-book-scope.mjs --json out.json
 *
 * Exits non-zero when any violation is found, so it can gate CI or a cron.
 * READ-ONLY — it never writes.
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { isBookScopedUrl } from '../lib/r2-key.mjs';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const BOOK = args[args.indexOf('--book') + 1] && args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const SAMPLE_BOOKS = 1500;

const FIELDS = ['archived_photo', 'display_photo', 'thumbnail_blob', 'cropped_photo', 'enhanced_photo'];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');

let bookIds;
if (BOOK) {
  bookIds = [BOOK];
} else if (FULL) {
  bookIds = await db.collection('books').distinct('id');
} else {
  // Sampled sweep: books most likely to have been touched by an archiver recently.
  bookIds = (await db.collection('books')
    .find({ pages_count: { $gt: 0 } }, { projection: { id: 1 } })
    .sort({ _id: -1 }).limit(SAMPLE_BOOKS).toArray()).map(b => b.id);
}
console.log(`Auditing ${bookIds.length} book(s)${FULL ? ' (full sweep)' : ' (sample — use --full for all)'}`);

const violations = [];
let checkedPages = 0, checkedBooks = 0;

for (const bid of bookIds) {
  const cur = pages.find({ book_id: bid }, {
    projection: { id: 1, book_id: 1, page_number: 1, ...Object.fromEntries(FIELDS.map(f => [f, 1])) },
  });
  for await (const p of cur) {
    checkedPages++;
    for (const f of FIELDS) {
      const url = p[f];
      if (!url) continue;
      if (!isBookScopedUrl(url, p.book_id)) {
        violations.push({ book_id: p.book_id, page_id: p.id, page_number: p.page_number, field: f, url });
      }
    }
  }
  if (++checkedBooks % 250 === 0) console.log(`  ...${checkedBooks}/${bookIds.length} books, ${violations.length} violations so far`);
}

console.log(`\nChecked ${checkedPages} pages across ${checkedBooks} books.`);

if (!violations.length) {
  console.log('PASS — every stored page-image URL is scoped to its own book.');
  await client.close();
  process.exit(0);
}

// Group for a readable report: the failure mode is always many pages of one shape.
const byBook = new Map();
for (const v of violations) {
  if (!byBook.has(v.book_id)) byBook.set(v.book_id, []);
  byBook.get(v.book_id).push(v);
}
console.log(`\nFAIL — ${violations.length} violation(s) across ${byBook.size} book(s):\n`);
for (const [bid, vs] of [...byBook.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
  const book = await db.collection('books').findOne({ id: bid }, { projection: { title: 1, visible: 1 } });
  console.log(`  ${bid} "${(book?.title || '?').slice(0, 50)}" ${book?.visible ? '[VISIBLE]' : '[hidden]'} — ${vs.length} page-field(s)`);
  for (const v of vs.slice(0, 3)) console.log(`      p${v.page_number} ${v.field}: ${v.url}`);
  if (vs.length > 3) console.log(`      ... and ${vs.length - 3} more`);
}
if (byBook.size > 40) console.log(`  ... and ${byBook.size - 40} more books`);

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify(violations, null, 2));
  console.log(`\nFull violation list written to ${JSON_OUT}`);
}

console.log('\nAny page listed above may have been OCR\'d against another book\'s image.');
console.log('Verify the OCR text against the current image before trusting it (see #3362).');

await client.close();
process.exit(1);
