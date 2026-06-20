// Selective-unpause scope helpers.
//
// The pipeline pause (system_config.processing_control.paused) is a global
// stop on the paid OCR/translation path. Selective unpause lets a chosen set
// of books run *while the rest stay paused*, via:
//   processing_control.allow_book_ids: string[]      // explicit book ids
//   processing_control.allow_collections: string[]   // collection slugs
//
// When a scope is set, the global pause is bypassed but every pipeline phase
// is confined to the allowlisted books. An empty scope means the pause is a
// full stop (unchanged). Mirrors the per-book bypass the free archiving
// workers already have (archive-bulk --book-id, archive-iiif-local --ignore-pause).
//
// These helpers are intentionally pure (no DB) so the pause/bypass invariant
// is unit-testable; collection-slug → book-id resolution is done by the caller.

export function getScopeConfig(control) {
  // filter falsy BEFORE coercing, so null/'' don't become the string "null"/""
  const bookIds = Array.isArray(control?.allow_book_ids)
    ? control.allow_book_ids.filter(Boolean).map(String)
    : [];
  const collections = Array.isArray(control?.allow_collections)
    ? control.allow_collections.filter(Boolean).map(String)
    : [];
  return { bookIds, collections };
}

/** Is a selective-unpause scope configured at all? */
export function hasScope(control) {
  const { bookIds, collections } = getScopeConfig(control);
  return bookIds.length > 0 || collections.length > 0;
}

/**
 * Should a paid worker proceed despite the global pause?
 * - Not paused → always proceed.
 * - Paused → only if a scope is configured, or a single --book override is active.
 * The critical invariant: paused + no scope + no override === do NOT proceed.
 */
export function shouldBypassPause(control, { bookOverride = false } = {}) {
  if (!control?.paused) return true;
  return Boolean(bookOverride) || hasScope(control);
}

/**
 * Resolve the full set of book ids a selective-unpause scope covers:
 * allow_book_ids[] ∪ (book ids in allow_collections[]). DB-backed, so it lives
 * here rather than in the pure helpers above — callers confine their candidate
 * queries to this set while the global pause is active. Mirrors the inline
 * resolution the pipeline-orchestrator already does for the paid path (#2616);
 * the archive workers reuse it so the FREE archiving step honors the same scope
 * (otherwise scoped books never get their images to R2 and nothing downstream
 * can run — the gap this closes).
 *
 * Returns a Set<string> of book ids (empty if no scope configured).
 */
export async function resolveScopeBookIds(db, control) {
  const { bookIds, collections } = getScopeConfig(control);
  const ids = new Set(bookIds);
  if (collections.length) {
    const scoped = await db.collection('books')
      .find({ collections: { $in: collections } }, { projection: { id: 1 } })
      .toArray();
    for (const b of scoped) ids.add(String(b.id));
  }
  return ids;
}
