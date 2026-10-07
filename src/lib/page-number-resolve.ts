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

/**
 * Batch-resolve printed page numbers to page ids for ONE book, so server-rendered
 * pages can link the canonical reader URL (`/book/<slug>/page/<id>`) directly
 * instead of the `/page-number/<n>` redirect.
 *
 * Why: robots.txt disallows `/book/*\/page-number/` (crawl budget, #2002), but
 * our own HTML linked to it, so Google discovered ~10K such URLs and reported
 * them "Blocked by robots.txt". Linking the canonical URL removes the
 * discovery path; `/page-number/` stays only as the fallback for numbers this
 * map doesn't cover (it still resolves near-misses, see resolvePageByNumber).
 *
 * One indexed query ({book_id, page_number} compound index). Exact matches
 * only; a miss simply isn't in the map. Never throws: on any failure the
 * caller falls back to the redirect URL, which still works.
 */
export async function resolvePageIdsByNumber(
  db: Db,
  bookId: string,
  pageNumbers: Iterable<number>,
  limit = 3000,
): Promise<Record<number, string>> {
  const wanted = [...new Set([...pageNumbers].filter(n => Number.isInteger(n) && n >= 0))].slice(0, limit);
  if (wanted.length === 0) return {};
  try {
    const rows = await db.collection('pages')
      .find({ book_id: bookId, page_number: { $in: wanted } }, { projection: { _id: 0, id: 1, page_number: 1, page_type: 1 }, maxTimeMS: 3000 })
      .toArray();
    const out: Record<number, string> = {};
    for (const r of rows) {
      if (r.page_type === 'digitizer-insert' || r.page_type === 'archived-spread') continue;
      if (typeof r.id === 'string' && typeof r.page_number === 'number' && !(r.page_number in out)) out[r.page_number] = r.id;
    }
    return out;
  } catch {
    return {};
  }
}

/** Canonical reader href for a printed page number, falling back to the redirect. */
export function pageNumberHref(bookSlug: string, n: number, idByNumber?: Record<number, string>): string {
  const id = idByNumber?.[n];
  return id ? `/book/${bookSlug}/page/${id}` : `/book/${bookSlug}/page-number/${n}`;
}
