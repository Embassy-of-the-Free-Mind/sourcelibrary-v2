export type SortOption = 'recent-translation' | 'recent' | 'title-asc' | 'title-desc' | 'date_asc' | 'date_desc';

/**
 * When a search term is present, Atlas Search returns matches in relevance
 * order — and this route used to throw that away, re-sorting every result set
 * by `is_bph_translated / quality_score / last_translation_at`. The scoring in
 * `buildBookSearchStage` (title boosted 10×, author 5×) was therefore doing
 * nothing at all: it decided *which* books matched, never which came first.
 *
 * The effect was that `search=Aristotle` returned "The Alchemical Seven Stars"
 * by Anonymous at #1, and 10 of the top 15 results contained no "Aristotle" in
 * title or author — because `reading_summary.overview` is in the searched
 * fields, and Aristotle is mentioned in the summary of half the corpus. A book
 * that merely *cites* Aristotle outranked a book *by* Aristotle. Reported
 * through MCP as "this looks like a straightforward bug rather than a ranking
 * preference" (#3653 item 7); `list_books` reads this route.
 *
 * So: relevance wins when the caller searched and did not ask for a specific
 * order. An explicit sort is still honoured — someone who asked for
 * title-ascending wants title-ascending. Unsearched browsing is untouched.
 */
export function buildSortStage(
  sort: SortOption,
  collection?: string,
  hasSearch = false,
): { $sort: Record<string, 1 | -1> } {
  const isDefaultSort = sort === 'recent-translation';
  if (hasSearch && isDefaultSort && !collection) {
    // `search_score` is projected from { $meta: 'searchScore' } below. The
    // trailing keys only break exact ties, so they cannot override relevance.
    return { $sort: { search_score: -1, has_translations: -1, title: 1 } as Record<string, 1 | -1> };
  }
  switch (sort) {
    case 'recent':
      return { $sort: { last_processed: -1, title: 1 } as Record<string, 1 | -1> };
    case 'title-asc':
      return { $sort: { sort_title: 1 } as Record<string, 1 | -1> };
    case 'title-desc':
      return { $sort: { sort_title: -1 } as Record<string, 1 | -1> };
    case 'date_asc':
      return { $sort: { year: 1, title: 1 } as Record<string, 1 | -1> };
    case 'date_desc':
      return { $sort: { year: -1, title: 1 } as Record<string, 1 | -1> };
    case 'recent-translation':
    default:
      // When viewing a collection, sort by relevance score first
      if (collection) {
        return { $sort: { _collection_relevance: -1, has_translations: -1, title: 1 } as Record<string, 1 | -1> };
      }
      return { $sort: { is_bph_translated: -1, quality_score: -1, has_translations: -1, last_translation_at: -1, last_processed: -1, title: 1 } as Record<string, 1 | -1> };
  }
}
