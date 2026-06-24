// Selective-unpause scope helpers.
//
// The pipeline pause (system_config.processing_control.paused) is a global
// stop on the paid OCR/translation path. Selective unpause lets a chosen set
// of books run *while the rest stay paused*. The scope is the UNION of:
//   processing_control.allow_scopes: { '<tag>': { book_ids:[], collections:[] } }
//       ← additive, namespaced per task/session — USE THIS (see below)
//   processing_control.allow_book_ids: string[]      // legacy, still honored
//   processing_control.allow_collections: string[]   // legacy, still honored
//
// When a scope is set, the global pause is bypassed but every pipeline phase
// is confined to the allowlisted books. An empty scope means the pause is a
// full stop (unchanged).
//
// WHY allow_scopes (namespaced): the legacy top-level arrays are a SINGLE shared
// field. With ~10 concurrent Claude sessions on this DB, one session setting its
// own books clobbers another's (this really happened 2026-06-20: a session
// narrowed the scope to 3 books and silently knocked a 60-book collection out of
// the allowlist for ~21h). allow_scopes fixes that: each task owns one key and
// edits ONLY that key (`$set: {'allow_scopes.<tag>': {...}}` / `$unset`), so
// scopes accumulate instead of overwriting. Manage it via
// scripts/maintenance/unpause-scope.mjs, never by hand-overwriting the arrays.
//
// These helpers are intentionally pure (no DB) so the pause/bypass invariant
// is unit-testable; collection-slug → book-id resolution is done by the caller.

export function getScopeConfig(control) {
  // filter falsy BEFORE coercing, so null/'' don't become the string "null"/"";
  // dedupe via Set since legacy + namespaced scopes can overlap.
  const bookIds = new Set();
  const collections = new Set();
  const add = (arr, set) => { if (Array.isArray(arr)) for (const x of arr) if (x) set.add(String(x)); };
  add(control?.allow_book_ids, bookIds);          // legacy
  add(control?.allow_collections, collections);   // legacy
  const scopes = control?.allow_scopes;           // namespaced additive map
  if (scopes && typeof scopes === 'object') {
    for (const key of Object.keys(scopes)) {
      add(scopes[key]?.book_ids, bookIds);
      add(scopes[key]?.collections, collections);
    }
  }
  return { bookIds: [...bookIds], collections: [...collections] };
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
