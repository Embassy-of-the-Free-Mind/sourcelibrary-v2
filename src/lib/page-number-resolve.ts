import type { Db, Document } from 'mongodb';

/**
 * Resolve a book page from a printed page number (`pages.page_number`).
 *
 * The "Chapters & Sections" panel links each section to
 * /book/<slug>/page-number/<chapter.pageNumber>. The redirect route used to do
 * an exact `findOne({ book_id, page_number })` and hard-404 on any miss. That
 * breaks a section link whenever the chapter's `pageNumber` doesn't land on an
 * exact `pages.page_number` value — e.g. a chapter that starts on an
 * unnumbered/front-matter page, or whose printed number falls in a gap of the
 * scanned sequence.
 *
 * Production audit (bookstore, 2026-05-31): of ~18,800 chapters across ~1,200
 * books, ~1% of chapters (in ~36 books) had a `pageNumber` with no exact
 * `pages.page_number` match — every one of those section links 404'd.
 * Confirmed live, e.g. /book/the-divine-pymander-everard/page-number/6
 * (chapter at p.6, pages start at p.7) and
 * /book/add-ms-15268-histoire-universelle-add/page-number/179 (chapter at
 * p.179, pages run -2..177).
 *
 * Instead of 404ing on a near-miss, fall back to the closest page so the
 * section link always lands the reader somewhere sensible:
 *   1. exact page_number match (existing valid links are unchanged)
 *   2. nearest page at or after the requested number (chapter text starts here)
 *   3. nearest page before the requested number
 *   4. the book's first page (covers odd/negative page_number schemes)
 *
 * Returns null only when the book genuinely has no pages.
 */
export async function resolvePageByNumber(
  db: Db,
  bookId: string,
  pageNumber: number,
): Promise<Document | null> {
  const projection = { id: 1, page_number: 1 };

  // 1. Exact match — existing valid links keep their exact destination.
  const exact = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection },
  );
  if (exact) return exact;

  // 2. Nearest page at or after the requested number (chapter text starts here).
  const after = await db.collection('pages').findOne(
    { book_id: bookId, page_number: { $gte: pageNumber } },
    { projection, sort: { page_number: 1 } },
  );
  if (after) return after;

  // 3. Nearest page before the requested number.
  const before = await db.collection('pages').findOne(
    { book_id: bookId, page_number: { $lt: pageNumber } },
    { projection, sort: { page_number: -1 } },
  );
  if (before) return before;

  // 4. First page of the book.
  return db.collection('pages').findOne(
    { book_id: bookId },
    { projection, sort: { page_number: 1 } },
  );
}
