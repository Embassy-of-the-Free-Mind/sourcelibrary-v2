/**
 * Page-lane roll-up for `/api/search` (#5905): which BOOKS print the query,
 * counted across all their pages, rather than which 25 pages score best.
 *
 * PRIOR ART: src/lib/atlas-search.ts (`buildPageSearchStage`) — ranks PAGES.
 * The 25 best-scoring pages for a name sit in a handful of books ("Drebbel":
 * 732 pages in 232 books, the top 25 pages in 3), so the page lane named 6
 * books and the route reported total=9. src/lib/search/work-grouping.ts
 * collapses a ranked list after the fact; it cannot add a book the lane never
 * fetched. Neither counts.
 *
 * Two queries, both bounded by the result window and not by the corpus
 * (request-path-queries.md):
 *
 *  1. `countMatchingPagesByBook` — one `$searchMeta` facet on `book_id`. It
 *     reads the index only, no page documents. Measured on 30 queries:
 *     median 141 ms, max 443 ms ("Paracelsus", 42,953 pages).
 *  2. `bestPagePerBook` — one `$search … $limit 1` per added book, so each
 *     book the count surfaces arrives with a passage a reader can open. A
 *     single query cannot do this: its top pages go back to the same few books.
 *
 * A page counts only if it prints EVERY query word (each as a phrase, so
 * `self-regulating` means the two tokens side by side). The page lane itself
 * matches ANY word; counting that way ranks "Basil Valentine" by pages that
 * mention St Basil.
 */
import type { Db, Document } from 'mongodb';
import { PAGE_SEARCH_INDEX, NON_CONTENT_PAGE_TYPES } from '@/lib/atlas-search';

/** Function words the book lane already ignores (src/lib/books-catalog.ts). */
const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with']);

/** More words than this is a sentence, and no page prints all of a sentence's words. */
const MAX_TERMS = 8;

/** How many books the facet returns. Also bounds the evidence map the ranker reads. */
export const ROLLUP_BUCKETS = 200;

/**
 * The words a page must all print to count. Splits on whitespace only and
 * leaves tokenizing to the index's own analyzer, so no script is folded away
 * here (non-latin-text-operations.md). Returns `null` when it cannot say —
 * nothing left after stopwords, or too many words — and the caller then adds
 * no books; it never reads `null` as "no book matches".
 */
export function rollupTerms(query: string): string[] | null {
  const trimmed = query.trim();
  const isPhrase = /^".*"$/.test(trimmed);
  if (isPhrase) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? [inner] : null;
  }
  const terms = trimmed.split(/\s+/)
    // A token with no letter or digit in any script is punctuation.
    .filter(w => /[\p{L}\p{N}]/u.test(w))
    .filter(w => !STOPWORDS.has(w.toLowerCase()));
  if (terms.length === 0 || terms.length > MAX_TERMS) return null;
  return [...new Set(terms)];
}

function allTermsClauses(terms: string[]): Document[] {
  return terms.map(term => ({
    compound: {
      should: [
        { phrase: { query: term, path: 'translation.data', score: { boost: { value: 2 } } } },
        { phrase: { query: term, path: 'ocr.data' } },
      ],
      minimumShouldMatch: 1,
    },
  }));
}

function bookFilter(bookIds: string | string[] | undefined): Document[] {
  if (bookIds === undefined) return [];
  if (typeof bookIds === 'string') return [{ equals: { path: 'book_id', value: bookIds } }];
  // An empty allow-list matches nothing; it must not fall open to the corpus (#2760).
  if (bookIds.length === 0) return [{ equals: { path: 'book_id', value: ' __no_match__' } }];
  return [{ in: { path: 'book_id', value: bookIds } }];
}

/** `$searchMeta` stage: pages printing every term, bucketed by book. */
export function buildRollupCountStage(terms: string[], bookIds?: string[], numBuckets = ROLLUP_BUCKETS): Document {
  return {
    $searchMeta: {
      index: PAGE_SEARCH_INDEX,
      facet: {
        operator: {
          compound: {
            must: allTermsClauses(terms),
            filter: [{ range: { path: 'page_number', gt: 0 } }, ...bookFilter(bookIds)],
          },
        },
        facets: { book: { type: 'string', path: 'book_id', numBuckets } },
      },
    },
  };
}

/** `$search` stage: the best page of ONE book that prints every term. */
export function buildBestPageStage(terms: string[], bookId: string): Document {
  return {
    $search: {
      index: PAGE_SEARCH_INDEX,
      compound: {
        must: allTermsClauses(terms),
        filter: [{ range: { path: 'page_number', gt: 0 } }, ...bookFilter(bookId)],
      },
      highlight: {
        path: ['translation.data', 'ocr.data'],
        maxCharsToExamine: 100000,
        maxNumPassages: 2,
      },
    },
  };
}

export interface BookPageCount {
  book_id: string;
  /** Pages of this book that print every query term. */
  pages: number;
}

/**
 * Books ranked by how many of their pages print every term, most first.
 * Counts hidden and non-content pages' books too — the caller filters to live
 * books, exactly as it does for the page lane's own hits.
 */
export async function countMatchingPagesByBook(
  db: Db,
  terms: string[],
  bookIds?: string[],
): Promise<BookPageCount[]> {
  const [meta] = await db.collection('pages')
    .aggregate([buildRollupCountStage(terms, bookIds)])
    .toArray();
  const buckets = (meta?.facet?.book?.buckets ?? []) as Array<{ _id: string; count: number }>;
  return buckets.map(b => ({ book_id: b._id, pages: b.count }));
}

/**
 * One page per book, in the order of `bookIds`; a book with no content page
 * that prints every term is simply absent. Runs `concurrency` single-book
 * searches at a time — each reads one document.
 */
export async function bestPagePerBook(
  db: Db,
  terms: string[],
  bookIds: string[],
  concurrency = 10,
): Promise<Document[]> {
  const out: Document[] = [];
  for (let i = 0; i < bookIds.length; i += concurrency) {
    const batch = await Promise.all(bookIds.slice(i, i + concurrency).map(async id => {
      const [page] = await db.collection('pages').aggregate([
        buildBestPageStage(terms, id),
        { $match: { page_type: { $nin: NON_CONTENT_PAGE_TYPES } } },
        { $limit: 1 },
        {
          $project: {
            id: 1,
            page_number: 1,
            book_id: 1,
            highlights: { $meta: 'searchHighlights' },
            'translation.data': 1,
            'ocr.data': 1,
          },
        },
      ]).toArray();
      return page;
    }));
    for (const page of batch) if (page) out.push(page);
  }
  return out;
}

/**
 * Coarse evidence tier: 1 page → 0, 2–3 → 1, 4–7 → 2, 8–15 → 3 …
 * Coarse on purpose. A book with 51 pages on a person outranks one with a
 * passing mention, but 12 pages against 9 is not a difference worth
 * overriding closeness to the source for (the ladder's later rungs, #2395).
 * No count (a semantic-only hit, a book past the facet's bucket limit, or no
 * roll-up at all) is -1.
 */
export function evidenceTier(pages: number | undefined | null): number {
  if (!pages || pages < 1) return -1;
  return Math.floor(Math.log2(pages));
}

/**
 * Ladder rung: of two results, the one whose book prints the query on more
 * pages. Negative puts `a` first; 0 defers to the next rung.
 *
 * The route applies it only between two rows of the same type whose title and
 * author do not contain a query word — passages, and books that only the
 * semantic lane proposed. It never reorders title/author matches: there the
 * count would put an English translation that prints "Basil Valentine" above
 * the Latin original that prints "Basilius Valentinus".
 */
export function compareEvidence(aPages: number | undefined | null, bPages: number | undefined | null): number {
  return evidenceTier(bPages) - evidenceTier(aPages);
}
