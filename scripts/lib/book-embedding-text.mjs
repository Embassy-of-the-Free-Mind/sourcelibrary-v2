/**
 * Compose the text that gets embedded into Supabase `book_embeddings` — the
 * vector behind the book-level semantic lane in /api/search and
 * /api/search/unified.
 *
 * This lived in three near-identical copies (enrich-worker.mjs Phase 6, the
 * backfill migration, and a search eval spike) and all three carried the same
 * two field-name bugs, so every copy silently discarded the entity and topic
 * signal the index extractor had just produced:
 *
 *   1. people/places/concepts carry `term`, not `name` — buildConceptIndexFromBatches
 *      emits { term, pages, page_precision }. Reading `.name` yielded undefined
 *      for every element, writing a literal "People: , , , ," line into 14,237
 *      live rows.
 *   2. topic terms were keyed on `entries`, a rare legacy shape present on only
 *      ~1k of 18k book_indexes docs. The extractor writes `vocabulary` and
 *      `keywords`. 35k of 36k rows therefore had no topic line at all.
 *
 * Net effect: book-level semantic search was matching on title, author, summary
 * and section headings only. Keep this the single implementation — a fix that
 * lands in one copy and not the others is how it got here.
 *
 * Pinned by tests/unit/book-embedding-text.test.ts.
 */

/** Max characters handed to the embedding model. */
export const MAX_EMBEDDING_CHARS = 8000;

const TOPIC_LIMIT = 50;
const PEOPLE_LIMIT = 30;
const PLACES_LIMIT = 20;
const CONCEPTS_LIMIT = 30;

/** `term` is the shape the extractor emits. Never `name`. */
function termsOf(entries, limit) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, limit).map(e => e?.term).filter(Boolean);
}

/**
 * Topic terms, most-cited first, deduped across the three sources that can
 * carry them. `entries` first so legacy docs keep their existing ordering.
 */
function topicTerms(indexData) {
  const sources = [
    ...(indexData?.entries || []),
    ...(indexData?.keywords || []),
    ...(indexData?.vocabulary || []),
  ];
  if (sources.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const entry of [...sources].sort((a, b) => (b?.pages?.length || 0) - (a?.pages?.length || 0))) {
    const term = entry?.term;
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= TOPIC_LIMIT) break;
  }
  return out;
}

/**
 * @param {object} book       books doc (title, author, language, published, categories, artwork fields)
 * @param {object} indexData  book_indexes doc, or the in-memory index a writer just built
 * @returns {string} embedding source text, capped at MAX_EMBEDDING_CHARS
 */
export function composeBookEmbeddingText(book, indexData) {
  const parts = [];
  parts.push(`${book.display_title || book.title || 'Untitled'} by ${book.author || 'Unknown'}`);
  if (book.language) parts.push(`Language: ${book.language}`);
  if (book.published) parts.push(`Published: ${book.published}`);

  if (indexData?.bookSummary?.detailed) {
    parts.push(indexData.bookSummary.detailed);
  } else if (indexData?.bookSummary?.brief) {
    parts.push(indexData.bookSummary.brief);
  }

  if (indexData?.sectionSummaries?.length > 0) {
    const sections = indexData.sectionSummaries.map(s => s.title || s.summary).filter(Boolean).slice(0, 15);
    if (sections.length > 0) parts.push(`Chapters: ${sections.join('; ')}`);
  }

  const topics = topicTerms(indexData);
  if (topics.length > 0) parts.push(`Topics: ${topics.join(', ')}`);

  const people = termsOf(indexData?.people, PEOPLE_LIMIT);
  const places = termsOf(indexData?.places, PLACES_LIMIT);
  const concepts = termsOf(indexData?.concepts, CONCEPTS_LIMIT);
  if (people.length > 0) parts.push(`People: ${people.join(', ')}`);
  if (places.length > 0) parts.push(`Places: ${places.join(', ')}`);
  if (concepts.length > 0) parts.push(`Concepts: ${concepts.join(', ')}`);

  // Fallbacks for books with no index doc at all (the backfill sees these; a
  // writer that just built an index never reaches them).
  if (!indexData?.bookSummary) {
    if (book.description) parts.push(book.description);
    if (book.summary) parts.push(typeof book.summary === 'string' ? book.summary : book.summary.data || '');
    if (book.reading_summary?.overview) parts.push(book.reading_summary.overview);
  }

  if (book.categories?.length > 0) parts.push(`Categories: ${book.categories.join(', ')}`);

  // Artwork-specific metadata — artworks are single objects, not paginated
  // books, so their descriptive signal lives in Commons fields instead.
  if (book.content_type === 'artwork') {
    if (book.commons_description) parts.push(book.commons_description.slice(0, 500));
    if (book.commons_categories) {
      const cats = typeof book.commons_categories === 'string'
        ? book.commons_categories.split('|').map(c => c.trim()).filter(Boolean).slice(0, 20)
        : Array.isArray(book.commons_categories) ? book.commons_categories.slice(0, 20) : [];
      if (cats.length > 0) parts.push(`Subjects: ${cats.join(', ')}`);
    }
    if (book.resource_type) parts.push(`Medium: ${book.resource_type}`);
    if (book.medium) parts.push(`Material: ${book.medium}`);
    if (book.collections?.length > 0) {
      const collNames = book.collections.filter(c => c !== 'visual-art').map(c => c.replace(/-/g, ' '));
      if (collNames.length > 0) parts.push(`Collections: ${collNames.join(', ')}`);
    }
  }

  return parts.join('\n').slice(0, MAX_EMBEDDING_CHARS);
}

/**
 * Fields a book_indexes projection must include for the composer to see
 * everything. Slice the arrays generously — they are already sorted by page
 * frequency descending, and pageSummaries (huge) is deliberately absent.
 */
export const BOOK_INDEX_EMBEDDING_PROJECTION = {
  book_id: 1,
  bookSummary: 1,
  sectionSummaries: { $slice: 15 },
  'entries.term': 1, 'entries.pages': 1,
  vocabulary: { $slice: TOPIC_LIMIT },
  keywords: { $slice: TOPIC_LIMIT },
  people: { $slice: PEOPLE_LIMIT },
  places: { $slice: PLACES_LIMIT },
  concepts: { $slice: CONCEPTS_LIMIT },
};
