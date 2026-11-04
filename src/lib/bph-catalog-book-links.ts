/**
 * Which books a catalogue row may offer to a reader.
 *
 * PRIOR ART: src/lib/tenant-catalog-books.ts answers the opposite question (may this book be read
 * on this tenant, because a row names it) and does not ask whether the book is readable.
 * src/lib/tenant-library-loaders.ts fetchTenantBphDigitizedMap() is readable-only but keyed by UBN,
 * so it misses rows matched by sl_book_id and every sl_external_book_id. bph_works is not edited:
 * a rights hold can lift, and the row should link again when it does (#8047).
 */
type Row = Record<string, unknown>;

const idOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

export function bookIdsNamedBy(rows: Row[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const value of [row.sl_book_id, row.sl_external_book_id]) {
      const id = idOf(value);
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

/** `readable` holds the books a visitor can open, with their covers. */
export function withReadableBookLinks(row: Row, readable: Map<string, string | null>): Row {
  const out: Row = { ...row };
  const bookId = idOf(row.sl_book_id);
  if (bookId && readable.has(bookId)) {
    out.sl_cover = readable.get(bookId) ?? null;
  } else if (bookId) {
    out.sl_book_id = null;
    out.sl_book_slug = null;
  }
  const externalId = idOf(row.sl_external_book_id);
  if (externalId && !readable.has(externalId)) {
    out.sl_external_book_id = null;
    out.sl_external_slug = null;
    out.sl_external_source = null;
  }
  return out;
}
