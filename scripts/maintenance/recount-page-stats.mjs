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
 */

import { MongoClient } from 'mongodb';
import { buildVisiblePageCountPipeline } from '../lib/page-counts.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STALE = args.includes('--stale');
const slugs = args.filter((a, i) => args[i - 1] === '--slug');

if (!STALE && slugs.length === 0) {
  console.error('Usage: --slug <slug> [--slug <slug>...] | --stale   [--apply]');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

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
