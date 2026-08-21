/**
 * Read-side twin of the entity-book helpers in
 * `scripts/lib/entity-page-match.mjs` (the writer side). Parity is pinned by
 * `tests/unit/entity-page-attribution.test.ts` — change both together.
 *
 * Why the read path needs them at all: `entities.books[]` accumulated duplicate
 * entries per book for years (the writer used `$addToSet` on a whole
 * subdocument, so a re-run appended rather than replaced), and the stored
 * `book_count` / `total_mentions` were computed from those duplicates plus
 * smeared page arrays. Deriving both from the deduped array on render means the
 * page is self-consistent even where the repair sweep hasn't reached yet (#3361).
 */

export type EntityPagePrecision = 'page' | 'section';

export interface EntityBookRef {
  book_id: string;
  book_title: string;
  book_author: string;
  book_year?: number;
  pages: number[];
  /**
   * 'page' — every number in `pages` was verified against that page's text.
   * 'section' — we know only which stretch of the book discusses the entity;
   * `pages` is empty and `page_range` carries the span. Never synthesize page
   * numbers from a range: that is exactly the bug this field exists to prevent.
   */
  page_precision?: EntityPagePrecision;
  page_range?: { start: number; end: number };
}

/** One entry per book, with page lists merged. */
export function dedupeEntityBooks(books: EntityBookRef[]): EntityBookRef[] {
  const byBook = new Map<string, EntityBookRef>();
  for (const entry of books || []) {
    if (!entry?.book_id) continue;
    const prev = byBook.get(entry.book_id);
    if (!prev) {
      byBook.set(entry.book_id, { ...entry, pages: [...(entry.pages || [])] });
      continue;
    }
    const pages = [...new Set([...(prev.pages || []), ...(entry.pages || [])])].sort((a, b) => a - b);
    const precision: EntityPagePrecision =
      prev.page_precision === 'page' || entry.page_precision === 'page' || pages.length > 0
        ? 'page'
        : 'section';
    const merged: EntityBookRef = { ...prev, ...entry, pages, page_precision: precision };
    if (precision === 'page') delete merged.page_range;
    else merged.page_range = prev.page_range || entry.page_range;
    byBook.set(entry.book_id, merged);
  }
  return [...byBook.values()];
}

/**
 * Distinct books, and VERIFIED page references only. A section-precision entry
 * contributes a book but no page references — which is honest: we have not
 * established a single page for it.
 */
export function entityCounters(books: EntityBookRef[]): { book_count: number; total_mentions: number } {
  const deduped = dedupeEntityBooks(books);
  return {
    book_count: deduped.length,
    total_mentions: deduped.reduce((sum, b) => sum + (b.pages?.length || 0), 0),
  };
}

/**
 * Legacy rows carry neither `page_precision` nor a verified page list — their
 * `pages` array is the old smeared batch range. Treat anything unmarked as
 * section precision so the UI stops rendering those numbers as page citations,
 * and derive the span from the array we no longer trust page-by-page.
 */
export function normalizeEntityBook(entry: EntityBookRef): EntityBookRef {
  if (entry.page_precision) return entry;
  const pages = entry.pages || [];
  if (pages.length === 0) return { ...entry, page_precision: 'section' };
  return {
    ...entry,
    pages: [],
    page_precision: 'section',
    page_range: { start: Math.min(...pages), end: Math.max(...pages) },
  };
}
