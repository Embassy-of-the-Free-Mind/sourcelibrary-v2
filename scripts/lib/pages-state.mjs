/**
 * `books.pages_state` — the lazy-pages marker (#7343 step 2a). Pure constants and
 * predicates with NO imports, so page-counts.mjs (the counter writer) and the TS
 * side can read the marker without pulling in the materializer. The materializer
 * and the full rationale are in scripts/lib/lazy-pages.mjs.
 *
 * PRIOR ART: scripts/lib/lazy-pages.mjs is the materializer this belongs to; it
 * lives apart only to keep page-counts.mjs free of an import cycle.
 *
 *   { state: 'manifest_only' | 'materializing' | 'materialized', since, … }
 *
 * ABSENT means what every book before #7343 is: its pages exist.
 */

export const PAGES_STATES = Object.freeze(['manifest_only', 'materializing', 'materialized']);

/** States in which the book has no (complete) set of page docs. */
export const LAZY_STATES = Object.freeze(['manifest_only', 'materializing']);

/** Mongo filter: books whose pages do not exist yet. */
export const LAZY_PAGES_FILTER = Object.freeze({ 'pages_state.state': { $in: [...LAZY_STATES] } });

/**
 * Mongo filter: books whose pages exist (every legacy book, which has no
 * `pages_state`, matches). Spread it into a selector that is about to pay for
 * work over a book's pages and does not materialize first.
 */
export const PAGES_MATERIALIZED_FILTER = Object.freeze({ 'pages_state.state': { $nin: [...LAZY_STATES] } });

/** True when the book's pages have not been created yet. */
export function isLazyPagesBook(book) {
  return LAZY_STATES.includes(book?.pages_state?.state);
}

/** The `pages_state` a manifest-only importer writes at insert. */
export function initialPagesState({ now = new Date() } = {}) {
  return { state: 'manifest_only', since: now };
}
