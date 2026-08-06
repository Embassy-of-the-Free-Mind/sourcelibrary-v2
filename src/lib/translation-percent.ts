/**
 * How much of a book is translated, as a percentage — one definition.
 *
 * Reported through the MCP connector 2026-08-05: `translation_percent` and
 * `pages_translated` contradict each other, so an API caller "could not use
 * translation_percent to decide whether a book was worth opening, which pushed
 * me toward trial-and-error fetching." (#3652 B.)
 *
 * Measured against production the same day, on 19,419 live books:
 *
 *   - **8,928 (46%) have no `translation_percent` field at all.** Not zero —
 *     absent. The job that wrote it, `sync-page-counts`, now sits in
 *     `src/app/api/cron/_archived/`, so every book imported since then has
 *     never had one. `/api/books/library` projects the stored field straight
 *     through to MCP `list_books`, which is why the reporter saw nothing
 *     usable.
 *   - 4,595 more have translated pages but a stored 0.
 *   - 14 already store a value above 100.
 *
 * And the formula had forked three ways, two of them unbounded:
 *
 *   | Site | Formula | Problem |
 *   |---|---|---|
 *   | `/api/books/browse` | `translated / count` | none — this is the one kept |
 *   | archived cron (wrote the field) | `translated / (ocr − blank)` | **>100% on 5,835 books** |
 *   | `/author/[name]`, `/api/categories/[id]` | `translated / max(ocr − blank, 1)` | same overflow |
 *
 * Subtracting blank pages from the denominator assumes blank pages are never
 * translated. They frequently are — a "blank" leaf still carries a stamp, a
 * plate caption, an inscription — so the numerator outruns the denominator and
 * the book reports 101%.
 *
 * ## The definition
 *
 * `pages_translated / pages_count`, clamped to 0–100. It is **bounded by
 * construction**, needs no blank-page bookkeeping (the thing that broke the
 * others), and answers the question a caller is actually asking: what fraction
 * of this book can I read in translation?
 *
 * ## Why this is computed, not backfilled
 *
 * The obvious fix — recount and write 19,419 documents — is the shape that
 * caused #3288/#3293: a batch correction of a denormalized counter, derived
 * from a sibling writer rather than validated against the read path, which
 * wrote 13,274 phantom pages before anyone noticed. A derived value with three
 * disagreeing definitions and a dead writer does not want a better backfill; it
 * wants to stop being stored. So this is a read-path function, the stored field
 * is left untouched and treated as vestigial, and no batch write happens at all.
 */

export interface TranslationCountable {
  pages_count?: number | null;
  pages_translated?: number | null;
}

/**
 * Percentage of the book available in translation, 0–100.
 * Returns 0 when the book has no pages — never NaN, never above 100.
 */
export function translationPercent(book: TranslationCountable | null | undefined): number {
  const total = book?.pages_count ?? 0;
  const translated = book?.pages_translated ?? 0;
  if (!(total > 0) || !(translated > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((translated / total) * 100)));
}
