import type { Document } from 'mongodb';

export const BOOK_SEARCH_INDEX = 'books_search';
export const PAGE_SEARCH_INDEX = 'pages_search';

export interface BookSearchFilters {
  tenantId?: string;
  language?: string;
  languages?: string[];
  excludeLanguages?: string[];
  category?: string;
  yearExact?: number;
  yearFrom?: number;
  yearTo?: number;
  isFirstTranslation?: boolean;
  hasTranslation?: boolean;
}

interface SearchOptions {
  /** Use autocomplete for prefix matching (dropdown) vs text for full-word matching (search page) */
  autocomplete?: boolean;
  /** Enable fuzzy matching for typo tolerance */
  fuzzy?: boolean;
}

/**
 * Build a $search aggregation stage for the books collection.
 * Searches title, display_title, english_title, author, name_forms, reading_summary.overview with boosting.
 * Callers that document this to a model (MCP list_books `search`) must name the overview lane (#4388).
 * Filters on indexed fields (hidden, language, categories, year, is_first_translation, pages_translated).
 *
 * Options:
 * - autocomplete: use prefix matching (for dropdown typeahead)
 * - fuzzy: tolerate typos (maxEdits: 1)
 */
export function buildBookSearchStage(query: string, filters: BookSearchFilters = {}, options: SearchOptions = {}): Document {
  const fuzzyOpt = options.fuzzy ? { fuzzy: { maxEdits: 1, prefixLength: 2 } } : {};

  const should: Document[] = options.autocomplete
    ? [
        // Autocomplete for prefix matching on title/author
        { autocomplete: { query, path: 'title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { autocomplete: { query, path: 'display_title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { autocomplete: { query, path: 'english_title', score: { boost: { value: 8 } }, ...fuzzyOpt } },
        { autocomplete: { query, path: 'author', score: { boost: { value: 5 } }, ...fuzzyOpt } },
        // Original-script author names (Greek). Mapped with icuFolding, NOT the
        // standard_diacritic used above — asciiFolding leaves Greek untouched,
        // so πλατων would never match Πλάτων. No autocomplete mapping on this
        // field, so it stays a text clause even in autocomplete mode.
        { text: { query, path: 'name_forms', score: { boost: { value: 5 } } } },
        // Also include text match on overview (no autocomplete index on this field)
        { text: { query, path: 'reading_summary.overview' } },
      ]
    : [
        { text: { query, path: 'title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { text: { query, path: 'display_title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { text: { query, path: 'english_title', score: { boost: { value: 8 } }, ...fuzzyOpt } },
        { text: { query, path: 'author', score: { boost: { value: 5 } }, ...fuzzyOpt } },
        // See the note above. Boosted like `author` because that is what it is:
        // 1,151 Greek-language books carry no Greek anywhere in their metadata,
        // so `Πλάτων` returned nothing while `Platonis` returned 63.
        // NO fuzzy: edit-distance on a folded Greek string collides wildly
        // between unrelated names, and the folding already does the work.
        { text: { query, path: 'name_forms', score: { boost: { value: 5 } } } },
        { text: { query, path: 'reading_summary.overview', ...fuzzyOpt } },
      ];

  const filter: Document[] = [];
  const mustNot: Document[] = [
    { equals: { path: 'hidden', value: true } },
  ];

  // Exclude empty shell books (0 pages from failed imports)
  filter.push({ range: { path: 'pages_count', gt: 0 } });

  // Tenant scoping is NOT in the Atlas Search index (see .claude/docs/search.md).
  // Callers must post-filter results through the books collection — see
  // applyTenantVisibility() consumers in src/lib/embassy/librarian.ts.

  if (filters.languages && filters.languages.length > 0) {
    filter.push({ in: { path: 'language', value: filters.languages } });
  } else if (filters.language) {
    filter.push({ equals: { path: 'language', value: filters.language } });
  }
  if (filters.excludeLanguages && filters.excludeLanguages.length > 0) {
    mustNot.push({ in: { path: 'language', value: filters.excludeLanguages } });
  }
  if (filters.category) {
    filter.push({ equals: { path: 'categories', value: filters.category } });
  }
  if (filters.isFirstTranslation) {
    filter.push({ equals: { path: 'is_first_translation', value: true } });
  }
  if (filters.hasTranslation) {
    filter.push({ range: { path: 'pages_translated', gt: 0 } });
  }
  if (filters.yearExact !== undefined) {
    filter.push({ equals: { path: 'year', value: filters.yearExact } });
  } else if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    const yearRange: Document = { path: 'year' };
    if (filters.yearFrom !== undefined) yearRange.gte = filters.yearFrom;
    if (filters.yearTo !== undefined) yearRange.lte = filters.yearTo;
    filter.push({ range: yearRange });
  }

  return {
    $search: {
      index: BOOK_SEARCH_INDEX,
      compound: {
        should,
        minimumShouldMatch: 1,
        ...(filter.length > 0 && { filter }),
        mustNot,
      },
    },
  };
}

/**
 * Build a $search aggregation stage for the pages collection.
 * Searches translation.data (boosted 2x) and ocr.data.
 * Optionally filters by book_id (single or array via $in).
 *
 * `opts.nameVariants` (from `expandPersonNames`, src/lib/search/name-variants.ts) are other
 * spellings of a person the query names — Drebbel → Drebelius, Drebelii. They are OR'd in as
 * their own clauses. Ignored for a quoted phrase. Absent or empty, the stage is exactly what
 * it was before (#5888).
 */
export interface PageSearchOptions {
  nameVariants?: string[];
  /**
   * Match ONLY pages that print one of `nameVariants`; the query's own words still score, so
   * "Paracelsus plague" ranks a Paracelsi page about plague above one that is not. For a lane
   * that wants the other spellings on their own (the Librarian's). No effect without variants.
   */
  requireNameVariant?: boolean;
  /** With `requireNameVariant`: the page must also print at least one of these words. */
  requireWords?: string[];
}

/**
 * Boost on the variant clauses (ocr; translation gets twice this, as the original clauses do).
 * It is this small on purpose. A variant is a rarer word than the name it varies, so BM25
 * scores it HIGHER: at a quarter of the original boost, "Plato" came back with 0 of its 48 top
 * pages unchanged — all displaced by "Platone"/"Platon" (measured 2026-10-05). At 1/40 the
 * pages printing the reader's own spelling keep their order and the variant pages follow,
 * ranked among themselves.
 */
export const NAME_VARIANT_BOOST = 0.025;

/**
 * Scripts written without spaces between words, or with a syllable mark instead (Tibetan tsheg).
 * `lucene.standard` makes every Han/kana character, and every Tibetan syllable, a token of its own, so
 * an unquoted `text` query of five characters matches any page printing ANY one of them — 司射遂適階
 * returned pages printing 射, and the page the reader copied it from was never in the top 10 (#6877).
 */
export const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Tibetan}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Boost on the phrase clauses an unquoted unspaced-script query adds (#6877). Large on purpose: the pages
 * printing the run as typed come first, ranked by their phrase score, and the any-character pages follow
 * as the fallback (measured 2026-10-18: Han and Tibetan Hit@10 0.00 → see the #6877 experiment file).
 */
export const PHRASE_FIRST_BOOST = 100;

export function buildPageSearchStage(query: string, bookIds?: string | string[], opts: PageSearchOptions = {}): Document {
  // Detect quoted phrase: "venus humanitas" → exact phrase match
  const isPhrase = /^".*"$/.test(query.trim());
  const searchQuery = isPhrase ? query.trim().slice(1, -1) : query;
  const phraseFirst = !isPhrase && UNSPACED_SCRIPT.test(searchQuery);

  // Use fuzzy matching for single long words to catch morphological variants
  // (e.g. "masturbation" matches "masturbator", "extraterrestrial" matches "extraterrestrials").
  // Not for an unspaced script: a run of characters is not one long word.
  const words = searchQuery.trim().split(/\s+/);
  const fuzzy = !isPhrase && !phraseFirst && words.length === 1 && words[0].length >= 6
    ? { maxEdits: 1, prefixLength: 4 }
    : undefined;

  const should: Document[] = isPhrase
    ? [
        { phrase: { query: searchQuery, path: 'translation.data', score: { boost: { value: 2 } } } },
        { phrase: { query: searchQuery, path: 'ocr.data' } },
      ]
    : [
        ...(phraseFirst ? [
          { phrase: { query: searchQuery, path: 'translation.data', score: { boost: { value: 2 * PHRASE_FIRST_BOOST } } } },
          { phrase: { query: searchQuery, path: 'ocr.data', score: { boost: { value: PHRASE_FIRST_BOOST } } } },
        ] : []),
        { text: { query: searchQuery, path: 'translation.data', score: { boost: { value: 2 } }, ...(fuzzy && { fuzzy }) } },
        { text: { query: searchQuery, path: 'ocr.data', ...(fuzzy && { fuzzy }) } },
      ];

  const nameVariants = isPhrase ? [] : (opts.nameVariants ?? []).filter(Boolean);
  if (nameVariants.length > 0) {
    should.push(
      { text: { query: nameVariants, path: 'translation.data', score: { boost: { value: NAME_VARIANT_BOOST * 2 } } } },
      { text: { query: nameVariants, path: 'ocr.data', score: { boost: { value: NAME_VARIANT_BOOST } } } },
    );
  }

  const filter: Document[] = [];
  // Hidden / deduped pages live at page_number ≤ 0. Exclude them from search.
  filter.push({ range: { path: 'page_number', gt: 0 } });
  if (bookIds !== undefined) {
    if (typeof bookIds === 'string') {
      filter.push({ equals: { path: 'book_id', value: bookIds } });
    } else if (bookIds.length > 0) {
      filter.push({ in: { path: 'book_id', value: bookIds } });
    } else {
      // Empty allow-list ⇒ match nothing. `undefined` means "no book filter";
      // an empty *array* is a computed allow-list that resolved to zero books
      // (e.g. a language with no matching titles) and must NOT fail open to the
      // whole corpus. Atlas `in` rejects an empty value array, so use an
      // impossible equals sentinel. (#2760)
      filter.push({ equals: { path: 'book_id', value: ' __no_match__' } });
    }
  }

  if (opts.requireNameVariant && nameVariants.length > 0) {
    const [original, variant] = [should.slice(0, -2), should.slice(-2)];
    const requireWords = (opts.requireWords ?? []).filter(Boolean);
    for (const clause of variant) delete clause.text.score; // their own lane: no discount
    variant[0].text.score = { boost: { value: 2 } };
    return {
      $search: {
        index: PAGE_SEARCH_INDEX,
        compound: {
          must: [
            { compound: { should: variant, minimumShouldMatch: 1 } },
            ...(requireWords.length > 0 ? [{ text: { query: requireWords, path: ['translation.data', 'ocr.data'] } }] : []),
          ],
          should: original,
          filter,
        },
        highlight: {
          path: ['translation.data', 'ocr.data'],
          maxCharsToExamine: 100000,
          maxNumPassages: 2,
        },
      },
    };
  }

  return {
    $search: {
      index: PAGE_SEARCH_INDEX,
      compound: {
        should,
        minimumShouldMatch: 1,
        filter,
      },
      highlight: {
        path: ['translation.data', 'ocr.data'],
        maxCharsToExamine: 100000,
        maxNumPassages: 2,
      },
    },
  };
}

/**
 * Non-content `page_type` values that should never surface in search results.
 * These pages typically carry library-scanner boilerplate (e.g. "Für weitere
 * Informationen siehe auch [Link]"), title-page metadata, or are blank — they
 * have OCR + embeddings but aren't part of the work itself, and pollute
 * conceptual search results.
 *
 * Use as a `$match` filter after `$search` (cheaper than re-indexing page_type
 * into the Atlas Search schema) or as a JS-side post-filter on semantic
 * results.
 */
export const NON_CONTENT_PAGE_TYPES = [
  'blank',
  'illustration',
  'title-page',
  'colophon',
  'frontispiece',
  'digitizer-insert',
] as const;
