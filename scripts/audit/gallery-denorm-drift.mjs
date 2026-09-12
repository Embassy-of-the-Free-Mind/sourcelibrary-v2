#!/usr/bin/env node
/**
 * Extracted illustrations that exist and cannot be seen.
 *
 * `gallery_images` denormalises four things from `books` — `book_visible`,
 * `book_title`, `book_author`, `book_rank` — and roughly fifteen read paths
 * filter on the first with an EXACT match:
 *
 *   /api/gallery (the gallery itself), book/[id]/page.tsx (a book's own
 *   illustration strip), hero-mosaic, collections, /artist/[name], timeline,
 *   /languages/[code], opengraph …  all `{ book_visible: true }`
 *
 * `{ book_visible: true }` does not match a document where the field is
 * ABSENT. So a row that never had the field written is invisible on every one
 * of those surfaces, including the book's own page — the extraction ran, the
 * images are in the database, and the reader is told the book has no
 * illustrations.
 *
 * The tell that this is a real inconsistency and not a design: ONE read path,
 * `/api/search/unified`, filters `{ book_visible: { $ne: false } }`, which does
 * match an absent field. The same row is findable in unified search and missing
 * from the gallery.
 *
 * This audit separates the two cases, because they have different causes and
 * only one of them is "stale":
 *
 *   ABSENT — the row predates the field, or a writer never set it. Backfillable
 *            from `books` with no judgement required.
 *   STALE  — the field is present as `false` and the book is live.
 *
 * **Only the first is safe to fix, and the reason is a trap worth naming.**
 * `book_visible` is OVERLOADED: `scripts/dedup-clean-gallery.mjs` sets it to
 * `false` to suppress an image it has judged a DUPLICATE of another page, using
 * the same field the visibility system uses to mirror `books.visible`. So a
 * blanket "set it true where the book is live" would un-suppress every
 * de-duplicated image and flood the gallery with exactly the duplicates that
 * pass was run to remove. Rows carrying `is_duplicate` or `dedup_hidden_at` are
 * therefore reported separately and never touched.
 *
 * Counts are reported in ROWS, not books: the impact is per image.
 *
 *   node --env-file=.env.production.local scripts/audit/gallery-denorm-drift.mjs [--fix]
 */
import { MongoClient } from 'mongodb';

const FIX = process.argv.includes('--fix');
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
await client.connect();
const db = client.db('bookstore');
const gi = db.collection('gallery_images');

const totalRows = await gi.estimatedDocumentCount();
const absentRows = await gi.countDocuments({ book_visible: { $exists: false } });
const falseRows = await gi.countDocuments({ book_visible: false });
console.log(`gallery_images: ~${totalRows} rows`);
console.log(`  book_visible ABSENT : ${absentRows}`);
console.log(`  book_visible false  : ${falseRows}`);

// Which of those belong to books that are actually live? Those are the ones a
// reader is being denied.
const liveIds = new Set((await db.collection('books').find({ visible: true }).project({ id: 1 }).toArray()).map((b) => b.id));
console.log(`  (${liveIds.size} live books in the corpus)`);

async function tally(filter, label) {
  const rows = await gi.aggregate([
    { $match: filter },
    { $group: { _id: '$book_id', n: { $sum: 1 }, title: { $first: '$book_title' } } },
  ], { allowDiskUse: true, maxTimeMS: 600000 }).toArray();
  const live = rows.filter((r) => liveIds.has(r._id));
  const rowCount = live.reduce((s, r) => s + r.n, 0);
  console.log(`\n${label}`);
  console.log(`  ${live.length} LIVE books, ${rowCount} images hidden from the gallery and from their own book page`);
  for (const r of live.sort((a, b) => b.n - a.n).slice(0, 12)) {
    console.log(`    ${String(r.n).padStart(4)} imgs  ${String(r.title || '(title not cached)').slice(0, 62)}  ${r._id}`);
  }
  return live;
}

const absentLive = await tally({ book_visible: { $exists: false } }, 'ABSENT and the book is live (SAFE to backfill):');
const falseLive = await tally(
  { book_visible: false, is_duplicate: { $ne: true }, dedup_hidden_at: { $exists: false } },
  'false, book is live, and NOT a dedup suppression:');
const dedupSuppressed = await gi.countDocuments({
  book_visible: false,
  $or: [{ is_duplicate: true }, { dedup_hidden_at: { $exists: true } }],
});
console.log(`\nfalse BECAUSE de-duplicated (left alone on purpose): ${dedupSuppressed} rows`);

if (!FIX) {
  console.log('\nRun with --fix to set book_visible from books.visible for these rows.');
} else {
  // Scoped so a dedup-suppressed row can never be swept up: the filter names
  // the exact rows the report counted, not "everything for this book".
  const ids = [...new Set([...absentLive, ...falseLive].map((r) => r._id))];
  console.log(`\nfixing ${ids.length} books…`);
  let done = 0;
  for (const id of ids) {
    const r = await gi.updateMany(
      {
        book_id: id,
        $or: [{ book_visible: { $exists: false } }, { book_visible: false }],
        is_duplicate: { $ne: true },
        dedup_hidden_at: { $exists: false },
      },
      { $set: { book_visible: true, updated_at: new Date() } },
    );
    done += r.modifiedCount;
  }
  console.log(`set book_visible:true on ${done} rows`);
}
await client.close();
