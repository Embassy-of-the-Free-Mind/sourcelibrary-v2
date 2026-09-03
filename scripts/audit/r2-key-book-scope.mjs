#!/usr/bin/env node
/**
 * Audit: every page's stored image URL must be scoped to its own book (#3362).
 *
 * THE INVARIANT
 *   pages.archived_photo / display_photo / thumbnail_blob, when they point at our
 *   own R2 under an `archived/`, `pages/`, `cropped/` or `uploads/` prefix, must
 *   contain that page's `book_id`. A URL that doesn't is shared between books.
 *
 *   The same is true of a BOOK's four cover fields, and that lane was missing
 *   until #4376. Every page of a book could be perfectly scoped while the book
 *   document's own `image_display` pointed at `archived/undefined/1.jpg` or at
 *   another book's `pages/<id>/0007-full.jpg` — this audit looked only at pages
 *   and reported PASS. Five books were in that state when the lane was added,
 *   three of them visible; one was serving a different book's title page as its
 *   cover. Covers are checked by default now (`--no-covers` to skip).
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
 *   node scripts/audit/r2-key-book-scope.mjs              # covers (all books) + sampled pages
 *   node scripts/audit/r2-key-book-scope.mjs --full       # covers + every page (slow)
 *   node scripts/audit/r2-key-book-scope.mjs --covers     # cover fields only (~1 min, all books)
 *   node scripts/audit/r2-key-book-scope.mjs --no-covers  # pages only (the pre-#4376 behaviour)
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
const COVERS_ONLY = args.includes('--covers');
const COVERS = COVERS_ONLY || !args.includes('--no-covers');
const PAGES = !COVERS_ONLY;
const BOOK = args[args.indexOf('--book') + 1] && args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
const JSON_OUT = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const SAMPLE_BOOKS = 1500;

const FIELDS = ['archived_photo', 'display_photo', 'thumbnail_blob', 'cropped_photo', 'enhanced_photo'];

/** The four canonical cover fields plus the two legacy ones they mirror. */
const COVER_FIELDS = ['image_display', 'image_thumb', 'image_card', 'image_full', 'thumbnail', 'thumbnail_blob'];

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const pages = db.collection('pages');

const violations = [];

// ---------------------------------------------------------------- cover lane
// Cheap enough to run over EVERY book (~113k docs, well under a minute), and it
// has to be: a cover is the one image a reader sees before they open anything,
// and it is written from the book document, not from the page series the loop
// below walks. The scoping id is `id`, not `_id` — 16,424 books carry a
// re-minted `_id` and every R2 key convention here embeds `id`.
if (COVERS) {
  const q = BOOK ? { $or: [{ id: BOOK }, { _id: BOOK }] } : {};
  const cur = db.collection('books').find(q, {
    projection: { id: 1, title: 1, visible: 1, ...Object.fromEntries(COVER_FIELDS.map(f => [f, 1])) },
  });
  let n = 0;
  for await (const b of cur) {
    n++;
    const bid = b.id || String(b._id);
    for (const f of COVER_FIELDS) {
      const url = b[f];
      if (!url) continue;
      if (!isBookScopedUrl(url, bid)) {
        violations.push({ book_id: bid, lane: 'cover', field: f, url, title: b.title, visible: b.visible });
      }
    }
  }
  console.log(`Checked cover fields on ${n} book(s) — ${violations.length} violation(s).`);
}

// `reportAndExit` never returns — it exits the process — but it must still be
// awaited, or the page lane below would start running underneath it.
if (!PAGES) await reportAndExit();

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
        violations.push({ book_id: p.book_id, lane: 'page', page_id: p.id, page_number: p.page_number, field: f, url });
      }
    }
  }
  if (++checkedBooks % 250 === 0) console.log(`  ...${checkedBooks}/${bookIds.length} books, ${violations.length} violations so far`);
}

console.log(`\nChecked ${checkedPages} pages across ${checkedBooks} books.`);

await reportAndExit();

/**
 * Print the grouped report and exit — 0 when clean, 1 when anything was found,
 * so this can gate CI or a cron. Shared by both lanes; a `--covers` run reaches
 * it before the page sweep ever starts.
 */
async function reportAndExit() {
  if (!violations.length) {
    console.log(`PASS — every stored ${[COVERS && 'cover', PAGES && 'page-image'].filter(Boolean).join(' and ')} URL is scoped to its own book.`);
    await client.close();
    process.exit(0);
  }

  // Group for a readable report: the failure mode is always many fields of one shape.
  const byBook = new Map();
  for (const v of violations) {
    if (!byBook.has(v.book_id)) byBook.set(v.book_id, []);
    byBook.get(v.book_id).push(v);
  }
  console.log(`\nFAIL — ${violations.length} violation(s) across ${byBook.size} book(s):\n`);
  for (const [bid, vs] of [...byBook.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
    const book = await db.collection('books').findOne({ id: bid }, { projection: { title: 1, visible: 1 } });
    const covers = vs.filter(v => v.lane === 'cover');
    const pageVs = vs.filter(v => v.lane !== 'cover');
    console.log(`  ${bid} "${(book?.title || '?').slice(0, 50)}" ${book?.visible ? '[VISIBLE]' : '[hidden]'} — ${vs.length} field(s)`);
    // Covers first and never truncated: there are only ever six of them, and a
    // wrong cover is the one image a reader meets before opening anything.
    for (const v of covers) console.log(`      COVER ${v.field}: ${v.url}`);
    for (const v of pageVs.slice(0, 3)) console.log(`      p${v.page_number} ${v.field}: ${v.url}`);
    if (pageVs.length > 3) console.log(`      ... and ${pageVs.length - 3} more page-field(s)`);
  }
  if (byBook.size > 40) console.log(`  ... and ${byBook.size - 40} more books`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(violations, null, 2));
    console.log(`\nFull violation list written to ${JSON_OUT}`);
  }

  if (violations.some(v => v.lane === 'cover')) {
    console.log('\nA COVER line means the book document itself names another book\'s image (or a');
    console.log('shared `undefined` key). Repair it through buildCoverUpdate() so all four cover');
    console.log('fields move together — see scripts/maintenance/fix-cross-book-covers-4376.mjs.');
  }
  if (violations.some(v => v.lane !== 'cover')) {
    console.log('\nAny page listed above may have been OCR\'d against another book\'s image.');
    console.log('Verify the OCR text against the current image before trusting it (see #3362).');
  }

  await client.close();
  process.exit(1);
}
