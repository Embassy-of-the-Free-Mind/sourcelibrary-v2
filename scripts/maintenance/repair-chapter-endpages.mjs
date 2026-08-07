#!/usr/bin/env node
/**
 * Recompute `books.chapters[].endPage` with the level-aware rule.
 *
 * WHY THIS IS SAFE TO RE-RUN: endPage is a DERIVED field. Nothing in the model
 * output carries it — it is computed from `pageNumber` + `level` + the page
 * count, all of which are already stored. So this sweep makes no AI calls,
 * costs nothing, and is idempotent. It rewrites ONLY endPage; every other
 * chapter field (title, titleEn, pageId, pageNumber, level, confidence) is
 * passed through untouched.
 *
 * WHAT WAS WRONG: the old rule looked at `chapters[i + 1]` flatly. A "Book I"
 * heading is immediately followed by its own "Chapter I", usually on the SAME
 * page, so the book got `endPage = pageNumber - 1` — an inverted span. Measured
 * 2026-08-07 before the fix: 29,037 entries across 6,901 books, 6,045 visible.
 * Reported from an MCP session (#3653 follow-up) that asked for Book I of
 * Taylor's Nicomachean Ethics and was told it spans pp. 12–11.
 *
 *   node scripts/maintenance/repair-chapter-endpages.mjs            # dry run
 *   node scripts/maintenance/repair-chapter-endpages.mjs --apply
 *   node scripts/maintenance/repair-chapter-endpages.mjs --book-id <id> --apply
 *
 * Writes are batched and paced. This touches `books`, not `entities`, so it
 * does not collide with the /explore prerender interlock in CLAUDE.md — but it
 * is still a bulk writer, so it yields between batches.
 */
import { MongoClient } from 'mongodb';
import { computeEndPages } from '../lib/chapter-endpages.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Source .env.production.local first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const bookId = args.includes('--book-id') ? args[args.indexOf('--book-id') + 1] : null;
const BATCH = 500;

const client = new MongoClient(MONGODB_URI);

/** Deep-enough copy to compare before/after without aliasing the stored docs. */
const spans = (chapters) => chapters.map((c) => c.endPage ?? null);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const filter = bookId
    ? { id: bookId }
    : { chapters: { $exists: true, $ne: [] } };

  const cursor = books.find(filter, {
    projection: { id: 1, title: 1, visible: 1, chapters: 1, pages_count: 1 },
  });

  let scanned = 0;
  let changedBooks = 0;
  let changedEntries = 0;
  let invertedBefore = 0;
  let skippedNoPageCount = 0;
  let ops = [];
  const samples = [];

  for await (const book of cursor) {
    scanned++;
    const chapters = book.chapters || [];
    if (!chapters.length) continue;

    // pages_count is the volume's last page. Without it the tail entry has no
    // defensible end, and guessing one would write a WRONG value over a merely
    // stale one — so leave those books alone and report the count.
    const totalPages = book.pages_count || 0;
    if (!totalPages) {
      skippedNoPageCount++;
      continue;
    }

    const before = spans(chapters);
    invertedBefore += chapters.filter(
      (c) => typeof c.endPage === 'number' && typeof c.pageNumber === 'number' && c.endPage < c.pageNumber,
    ).length;

    // computeEndPages assumes pageNumber order, and a stored array is not
    // guaranteed to have stayed sorted. Sort a COPY — it holds the same object
    // references, so computeEndPages mutates the very objects `chapters` still
    // holds, and the original ORDER survives.
    //
    // That order is load-bearing: `chapter_texts.chapter_index` is this array's
    // positional index. Writing the sorted array back would silently repoint
    // every materialized chunk of any book whose chapters were not already in
    // page order — turning a derived-field repair into a data corruption.
    computeEndPages([...chapters].sort((a, b) => a.pageNumber - b.pageNumber), totalPages);
    const after = spans(chapters);

    const diff = after.filter((v, i) => v !== before[i]).length;
    if (!diff) continue;

    changedBooks++;
    changedEntries += diff;
    if (samples.length < 10) {
      const at = after.findIndex((v, i) => v !== before[i]);
      const first = chapters[at];
      samples.push(
        `${book.id} ${(book.title || '').slice(0, 48)} — ${diff}/${chapters.length} entries; e.g. "${first.title}" p.${first.pageNumber}: ${before[at]} → ${first.endPage}`,
      );
    }

    if (apply) {
      ops.push({
        updateOne: { filter: { _id: book._id }, update: { $set: { chapters } } },
      });
      if (ops.length >= BATCH) {
        const res = await books.bulkWrite(ops, { ordered: false });
        console.log(`  wrote ${res.modifiedCount} books (scanned ${scanned})`);
        ops = [];
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  if (apply && ops.length) {
    const res = await books.bulkWrite(ops, { ordered: false });
    console.log(`  wrote ${res.modifiedCount} books (final batch)`);
  }

  console.log('\n' + (apply ? 'APPLIED' : 'DRY RUN — nothing written'));
  console.log(`  books scanned:            ${scanned}`);
  console.log(`  books needing change:     ${changedBooks}`);
  console.log(`  chapter entries changed:  ${changedEntries}`);
  console.log(`  inverted spans (before):  ${invertedBefore}`);
  console.log(`  skipped (no pages_count): ${skippedNoPageCount}`);
  if (samples.length) {
    console.log('\n  samples:');
    for (const s of samples) console.log('   ' + s);
  }
  if (!apply) console.log('\n  Re-run with --apply to write.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
