/** Stable production data used across tests. */

export const BOOK = {
  /** Slug-based URL — always use slugs, never hex IDs (see MEMORY.md) */
  slug: 'the-hermetic-museum-various-sendivogius',
  /** Hex ID kept for page URL construction */
  id: '695203a5ab34727b1f041c53',
  title: 'The Hermetic Museum, Restored and Enlarged',
  language: 'Latin',
  year: 1678,
  pageCount: 882,
} as const;

export const PAGE = {
  id: '695203a6ab34727b1f041c54',
  bookId: BOOK.id,
} as const;

export const SEARCH = {
  query: 'Ficino',
  minResults: 2,
} as const;
