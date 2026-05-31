/**
 * Backfill stale `chapters[].pageId` on books.
 *
 * Background: `chapters[].pageId` is written at extraction time by mapping the
 * chapter's printed `pageNumber` to a `pages.id`. On ~716 books those pageIds
 * are now stale — pages were re-imported / re-IDed, so a stored pageId no longer
 * matches any current page. The chapter dropdown links use the page-number route
 * (resilient), but `src/app/book/[id]/page.tsx` and any other reader of
 * `chapters[0].pageId` get a dead id.
 *
 * This script re-resolves each chapter's correct current pageId from its
 * `pageNumber` using the SAME resolution order as
 * `src/lib/page-number-resolve.ts`:
 *   1. exact page_number match
 *   2. nearest page at or after the requested number
 *   3. nearest page before the requested number
 *   4. the book's first page
 * If the resolved id differs from the stored `pageId`, it updates it.
 *
 * Default = DRY RUN. Pass `--apply` to write.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-chapter-page-ids.mjs            # dry run
 *   node scripts/maintenance/backfill-chapter-page-ids.mjs --apply    # write
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set. Did you `set -a; source .env.production.local; set +a`?');
  process.exit(1);
}
const dbName = process.env.MONGODB_DB || 'bookstore';

/**
 * Resolve the current pageId for a printed page number, mirroring
 * resolvePageByNumber() in src/lib/page-number-resolve.ts.
 * Returns the page id (string) or null if the book has no pages.
 */
async function resolvePageId(db, bookId, pageNumber) {
  const projection = { id: 1, page_number: 1 };
  const pages = db.collection('pages');

  if (typeof pageNumber === 'number' && !Number.isNaN(pageNumber)) {
    // 1. Exact match.
    const exact = await pages.findOne({ book_id: bookId, page_number: pageNumber }, { projection });
    if (exact) return exact.id ?? null;

    // 2. Nearest page at or after the requested number.
    const after = await pages.findOne(
      { book_id: bookId, page_number: { $gte: pageNumber } },
      { projection, sort: { page_number: 1 } },
    );
    if (after) return after.id ?? null;

    // 3. Nearest page before the requested number.
    const before = await pages.findOne(
      { book_id: bookId, page_number: { $lt: pageNumber } },
      { projection, sort: { page_number: -1 } },
    );
    if (before) return before.id ?? null;
  }

  // 4. First page of the book.
  const first = await pages.findOne({ book_id: bookId }, { projection, sort: { page_number: 1 } });
  return first?.id ?? null;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const books = db.collection('books');

    const cursor = books.find(
      { chapters: { $exists: true, $ne: [] } },
      { projection: { id: 1, slug: 1, chapters: 1 } },
    );

    let booksScanned = 0;
    let chaptersTotal = 0;
    let chaptersChanged = 0;
    let booksAffected = 0;
    let chaptersUnresolved = 0;
    const examples = [];
    const ops = [];

    for await (const book of cursor) {
      if (!Array.isArray(book.chapters) || book.chapters.length === 0) continue;
      booksScanned += 1;

      // book.id is the canonical foreign key used by pages.book_id.
      const bookId = book.id ?? String(book._id);

      let bookChanged = false;
      const newChapters = [];

      for (const ch of book.chapters) {
        chaptersTotal += 1;
        const pageNumber = typeof ch.pageNumber === 'number' ? ch.pageNumber : Number(ch.pageNumber);
        const resolvedId = await resolvePageId(db, bookId, pageNumber);

        if (resolvedId == null) {
          chaptersUnresolved += 1;
          newChapters.push(ch); // leave untouched — book has no pages
          continue;
        }

        if (resolvedId !== ch.pageId) {
          chaptersChanged += 1;
          bookChanged = true;
          if (examples.length < 8) {
            examples.push({
              book: book.slug || bookId,
              chapter: ch.titleEn || ch.title,
              pageNumber: ch.pageNumber,
              oldPageId: ch.pageId ?? null,
              newPageId: resolvedId,
            });
          }
          newChapters.push({ ...ch, pageId: resolvedId });
        } else {
          newChapters.push(ch);
        }
      }

      if (bookChanged) {
        booksAffected += 1;
        ops.push({
          updateOne: {
            filter: { _id: book._id },
            update: { $set: { chapters: newChapters } },
          },
        });
      }
    }

    console.log('--- backfill-chapter-page-ids ---');
    console.log(`mode:                 ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}`);
    console.log(`books scanned:        ${booksScanned}`);
    console.log(`chapters total:       ${chaptersTotal}`);
    console.log(`chapters to change:   ${chaptersChanged}`);
    console.log(`books affected:       ${booksAffected}`);
    console.log(`chapters unresolved:  ${chaptersUnresolved} (book has no pages — left as-is)`);
    if (examples.length) {
      console.log('\nexamples:');
      for (const e of examples) {
        console.log(
          `  ${e.book} | "${e.chapter}" p.${e.pageNumber} | ${e.oldPageId} -> ${e.newPageId}`,
        );
      }
    }

    if (!APPLY) {
      console.log('\nDRY RUN — no writes. Re-run with --apply to persist.');
      return;
    }

    if (ops.length === 0) {
      console.log('\nNothing to write.');
      return;
    }

    const res = await books.bulkWrite(ops, { ordered: false });
    console.log(`\nmodifiedCount: ${res.modifiedCount}`);
    console.log(`matchedCount:  ${res.matchedCount}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
