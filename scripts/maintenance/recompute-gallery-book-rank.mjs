#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/sync-worker.mjs recomputes `book_rank` for the books it
 * just synced (sort by gallery_quality desc, rank = index + 1) after inserting every
 * image with `book_rank: 0`. When that follow-up loop does not run for a book, the
 * zeros stay; other gallery_images writers (scripts/lib/gallery-doc.mjs callers that
 * pass no bookRank) leave the field missing. Nothing repaired either state, so this
 * applies the SAME rule to exactly those books. Looked in scripts/maintenance/ and
 * scripts/workers/ for an existing rank backfill (`git grep book_rank`): none.
 *
 * Recompute gallery_images.book_rank for books whose images carry rank 0 or none.
 *
 * WHY: the gallery's "at most 3 images per book" cap is `book_rank <= 3`. Rank 0 passes
 * that test for EVERY image of the book, so one deck or codex filled the first rows of
 * https://sourcelibrary.org/gallery (17 Visconti-Sforza tarot cards all at rank 0).
 * Measured 2026-09-24 over visible images: 932 books / 10,103 images at rank 0,
 * 2,681 books / 17,778 images with no rank.
 *
 * Rule (matches sync-worker): per book, all its gallery_images sorted by
 * gallery_quality desc, then page_number, then detection_index; rank = position + 1.
 * Writes only `book_rank` on gallery_images. One sweep_log row per book on --apply.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/recompute-gallery-book-rank.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/recompute-gallery-book-rank.mjs --apply
 *   … --limit=N   only the first N affected books
 *   … --book=ID   only this book (smoke test)
 */
import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const ONLY_BOOK = process.argv.find((a) => a.startsWith('--book='))?.split('=')[1] ?? null;
const SWEEP = 'recompute-gallery-book-rank';

async function main() {
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const gallery = db.collection('gallery_images');

  const bookIds = (await gallery.distinct('book_id', {
    $or: [{ book_rank: 0 }, { book_rank: { $exists: false } }],
  })).filter((id) => typeof id === 'string' && id.length > 0);
  const todo = ONLY_BOOK ? [ONLY_BOOK] : bookIds.slice(0, LIMIT);
  console.log(`${bookIds.length} books have images at rank 0 or unranked; processing ${todo.length} (${APPLY ? 'APPLY' : 'dry run'})`);

  let images = 0, modified = 0, books = 0;
  for (const bookId of todo) {
    const docs = await gallery.find({ book_id: bookId }, { projection: { _id: 1, gallery_quality: 1, page_number: 1, detection_index: 1, book_rank: 1 } }).toArray();
    docs.sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0)
      || (a.page_number ?? 0) - (b.page_number ?? 0)
      || (a.detection_index ?? 0) - (b.detection_index ?? 0));
    const ops = [];
    docs.forEach((d, i) => {
      if (d.book_rank !== i + 1) ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { book_rank: i + 1 } } } });
    });
    images += ops.length;
    if (APPLY && ops.length) {
      const res = await gallery.bulkWrite(ops, { ordered: false });
      modified += res.modifiedCount;
      await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'recomputed-book-rank', detail: { images: docs.length, changed: res.modifiedCount } });
    }
    if (++books % 250 === 0) console.log(`  ${books}/${todo.length} books, ${images} image ranks to change, ${modified} modified`);
  }
  console.log(`done: ${books} books, ${images} image ranks ${APPLY ? `to change; modified ${modified}` : 'would change'}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
