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
