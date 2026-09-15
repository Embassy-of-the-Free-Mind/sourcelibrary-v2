#!/usr/bin/env node
/**
 * Recount books.pages_count / pages_ocr / pages_translated from the `pages`
 * collection.
 *
 * Why this exists: those three fields are denormalised counters, written by
 * whichever worker last touched the book (collect-batch-results, batch-collector,
 * realtime-translate, batch-split-bph…). Any translation path that finishes
 * without running the recount leaves the counter frozen at its old value, and
 * every read-path gate that divides by it then misreads the book. The
 * user-visible symptom that surfaced this (2026-07-20): the sibling-edition
 * notice on /book/histoire-de-la-magie-avec-une-exposition-claire-et-precise-constant
 * said "This edition is not yet translated" (gate: translated/pages < 5%) while
 * the reader below it served English on 581 of its pages — the counter said 20.
 *
 * Counting rule: VISIBLE pages only — `page_number > 0`. A negative page_number
 * is a deliberate soft-hide (dropped duplicate spreads, junk scans), those pages
 * never render in the reader, and `books.pages_count` is what the book page
 * prints as "N scans" and divides by for every ratio it shows. Counting hidden
 * pages inflates the scan count and depresses the translated fraction.
 *
 * This is the corpus's dominant convention but NOT a universal one: sampling 400
 * visible books that have hidden pages, 387 store the positive-only count and 13
 * store the all-pages count. `collect-batch-results.mjs` (and the sibling writers
 * that copied it) count all pages — that writer is the source of the minority,
 * and of the bug above: it is what left Histoire de la magie claiming 929 scans
 * for 620 readable pages. Fixing those writers is issue-worthy follow-up; until
 * then this script is the corrective, so do not "align" it back to them.
 *
 * Usage:
 *   node scripts/maintenance/recount-page-stats.mjs --slug <slug> [...]
 *   node scripts/maintenance/recount-page-stats.mjs --stale      # scan all visible books
 *   node scripts/maintenance/recount-page-stats.mjs --stale --apply
 *
 * Dry-run by default; --apply writes.
 *
 * --estimate-band [--sample=500]   #4685 report-only mode: samples random books at
 *   90.00–99.99% translated and reports how many would see `pages_translatable`
 *   change, and how many would newly reach 100%, under the illustration/
 *   digitizer-insert guard. NEVER writes, independent of --apply. See the block
 *   below the main loop.
 */

import { MongoClient } from 'mongodb';
import { buildVisiblePageCountPipeline, isTextFreeIllustration, countVisiblePageStats } from '../lib/page-counts.mjs';

/**
 * The NEVER_TRANSLATED_PAGE_TYPES this repo shipped with before #4685 — a fixed
 * local snapshot for comparison, not re-exported anywhere, so the OLD/NEW split
 * in estimateBandChange() stays meaningful even after the live exported list
 * moves again.
 */
const PRE_4685_NEVER_TRANSLATED_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice'];

function oldIsTranslatable(page) {
  if ((page?.page_number ?? 0) <= 0) return false;
  if (PRE_4685_NEVER_TRANSLATED_PAGE_TYPES.includes(page?.page_type ?? '')) return false;
  if (page?.translation?.recitation_blocked === true) return false;
  if (page?.translation?.safety_blocked === true) return false;
  if (page?.ocr?.recitation_blocked === true) return false;
  return true;
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STALE = args.includes('--stale');
const ESTIMATE_BAND = args.includes('--estimate-band');
const SAMPLE_SIZE = (() => {
  const idx = args.indexOf('--sample');
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 500;
})();
const slugs = args.filter((a, i) => args[i - 1] === '--slug');

if (!STALE && !ESTIMATE_BAND && slugs.length === 0) {
  console.error('Usage: --slug <slug> [--slug <slug>...] | --stale | --estimate-band [--sample=N]   [--apply]');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

if (ESTIMATE_BAND) {
  await estimateBandChange(SAMPLE_SIZE);
  await client.close();
  process.exit(0);
}

const query = STALE
  ? { visible: true, pages_count: { $gt: 0 } }
  : { slug: { $in: slugs } };

const candidates = await books
  .find(query)
  .project({ _id: 1, id: 1, slug: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_translatable: 1 })
  .toArray();

console.log(`Scanning ${candidates.length} book(s)…`);

let drifted = 0;
let written = 0;

for (const book of candidates) {
  const bookId = book.id || String(book._id);

  // Stamp `ocr.text_free` on any illustration page that hasn't been judged yet
  // (#4685). buildVisiblePageCountPipeline's illustration guard reads this field
  // and cannot derive it itself — Mongo has no exact regex-strip-and-measure — so
  // the recount that is about to READ pages_translatable is also the one that
  // keeps the stamp current, satisfying "the same recount writes both."
  const unstamped = await pages
    .find({ book_id: bookId, page_type: 'illustration', 'ocr.text_free': { $exists: false } })
    .project({ _id: 1, page_type: 1, ocr: 1 })
    .toArray();
  if (unstamped.length > 0 && APPLY) {
    const bulk = pages.initializeUnorderedBulkOp();
    for (const p of unstamped) {
      bulk.find({ _id: p._id }).updateOne({ $set: { 'ocr.text_free': isTextFreeIllustration(p) } });
    }
    await bulk.execute();
  }

  const [counts] = await pages.aggregate(buildVisiblePageCountPipeline(bookId)).toArray();
  if (!counts) continue;

  const same =
    (book.pages_count ?? 0) === counts.total &&
    (book.pages_ocr ?? 0) === counts.with_ocr &&
    (book.pages_translated ?? 0) === counts.with_translation &&
    (book.pages_translatable ?? null) === counts.translatable;
  if (same) continue;

  drifted++;
  console.log(
    `${book.slug}\n  pages       ${book.pages_count ?? 0} → ${counts.total}` +
      `\n  ocr         ${book.pages_ocr ?? 0} → ${counts.with_ocr}` +
      `\n  translated  ${book.pages_translated ?? 0} → ${counts.with_translation}` +
      `\n  translatable ${book.pages_translatable ?? '—'} → ${counts.translatable}` +
      (counts.translatable > 0
        ? `   (${((100 * counts.translated_translatable) / counts.translatable).toFixed(1)}% of translatable` +
          `, vs ${((100 * counts.with_translation) / Math.max(counts.total, 1)).toFixed(1)}% of all pages)`
        : ''),
  );

  if (APPLY) {
    const res = await books.updateOne(
      { _id: book._id },
      {
        $set: {
          pages_count: counts.total,
          pages_ocr: counts.with_ocr,
          pages_translated: counts.with_translation,
          pages_translatable: counts.translatable,
          updated_at: new Date(),
        },
      },
    );
    written += res.modifiedCount;
  }
}

console.log(`\nDrifted: ${drifted}${APPLY ? ` · written: ${written}` : ' (dry run — pass --apply to write)'}`);
if (APPLY && written > 0) {
  console.log(
    'Next: re-sync the Supabase catalog (scripts/maintenance/sync-books-catalog.mjs), ' +
      'revalidate the affected /book pages, and purge Cloudflare.',
  );
}

await client.close();

/**
 * #4685 item 4: report-only estimate of how the illustration+digitizer-insert guard
 * moves `pages_translatable` for the 90.00–99.99%-translated band, without running a
 * corpus-wide recount against production. Fetches each sampled book's pages and
 * computes both the OLD rule and the NEW rule (via countVisiblePageStats, the exact
 * JS twin — this reads `ocr.data` directly, so it does NOT depend on `ocr.text_free`
 * having been stamped yet). Never writes.
 */
async function estimateBandChange(sampleSize) {
  console.log(`\n#4685 estimate: sampling up to ${sampleSize} books at 90.00–99.99% translated…`);

  const band = await books.aggregate([
    {
      $match: {
        visible: true,
        pages_translated: { $gt: 0 },
        pages_translatable: { $gt: 0 },
        $expr: {
          // $expr never short-circuits: $divide throws on pages_translatable === 0
          // even though the sibling $gt filter above excludes those docs — Mongo
          // evaluates every $expr operand, it does not filter-then-evaluate. Guard
          // with $cond so a zero denominator reads as "out of band" instead of
          // erroring the whole aggregation.
          $let: {
            vars: { ratio: { $cond: [{ $gt: ['$pages_translatable', 0] }, { $divide: ['$pages_translated', '$pages_translatable'] }, -1] } },
            in: { $and: [{ $gte: ['$$ratio', 0.9] }, { $lt: ['$$ratio', 0.9999] }] },
          },
        },
      },
    },
    { $sample: { size: sampleSize } },
    { $project: { _id: 1, id: 1, slug: 1, pages_translated: 1, pages_translatable: 1 } },
  ]).toArray();

  console.log(`Band books sampled: ${band.length}`);

  let scanned = 0;
  let changed = 0;
  let reaches100 = 0;

  for (const book of band) {
    const bookId = book.id || String(book._id);
    const bookPages = await pages
      .find({ book_id: bookId, page_number: { $gt: 0 } })
      .project({
        page_number: 1, page_type: 1,
        'ocr.data': 1, 'ocr.unreadable': 1, 'ocr.recitation_blocked': 1,
        'translation.data': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1,
      })
      .toArray();
    if (bookPages.length === 0) continue;
    scanned++;

    const oldTranslatable = bookPages.filter(oldIsTranslatable).length;
    const newStats = countVisiblePageStats(bookPages);

    if (newStats.translatable !== oldTranslatable) changed++;
    if (newStats.translatable > 0 && newStats.translated_translatable >= newStats.translatable) reaches100++;
  }

  console.log(`\nScanned ${scanned} of ${band.length} sampled band books (some had 0 visible pages).`);
  console.log(`pages_translatable would CHANGE: ${changed} (${((100 * changed) / Math.max(scanned, 1)).toFixed(1)}%)`);
  console.log(`would newly reach 100%:          ${reaches100} (${((100 * reaches100) / Math.max(scanned, 1)).toFixed(1)}%)`);
  console.log(
    `Extrapolated to the full #4685 band (5,397 books): ` +
      `~${Math.round((5397 * changed) / Math.max(scanned, 1))} change, ` +
      `~${Math.round((5397 * reaches100) / Math.max(scanned, 1))} reach 100%.`,
  );
}
