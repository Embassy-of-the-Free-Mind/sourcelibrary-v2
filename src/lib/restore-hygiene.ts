/**
 * Field hygiene for restoring an archived book back into `books` (issue #3997).
 *
 * `deleted_books` is NOT a subset of `books`. It has drifted into its own
 * 260-field shape, because the dedup/purge sweeps that archive books write
 * their own bookkeeping onto the archived copy. Spreading an archived document
 * back into `books` wholesale therefore carries fields that:
 *
 *   1. are meaningless on a live book (archive bookkeeping), and
 *   2. RESURRECT RETIRED FIELDS — the tenant and hide_reason consolidations
 *      (#3983, #3986) cleaned `books` but not `deleted_books`, so every
 *      archived copy still carries them and each restore re-pollutes the
 *      collection. See `.claude/docs/invariants/field-sprawl.md`.
 *
 * It also matters for the `books` $jsonSchema validator (#3969 Track A): under
 * `validationAction: 'error'` these unblessed fields would make every restore
 * fail, turning a documented recovery path (CLAUDE.md, Data Protection) into a
 * 500.
 *
 * Nothing is discarded silently — the caller logs what was stripped.
 */

/** Fields that must never travel from `deleted_books` back into `books`. */
export const ARCHIVE_ONLY_FIELDS = [
  // dedup/purge sweep bookkeeping, written onto the archived copy
  '_original_id',
  'dedup_batch',
  'dedup_sim',
  'delete_reason',
  'kept_version_id',
  'needs_reimport',
  'reason',
  'materials',
  // retired — restoring these re-pollutes the collection
  'hide_reason',
  'tenant_id',
] as const;

/**
 * Split an archived book document into the part that may be written back to
 * `books` and the archive-only fields that must not be.
 *
 * Does not mutate the input.
 */
export function stripArchiveOnlyFields(
  bookData: Record<string, unknown>
): { clean: Record<string, unknown>; stripped: Record<string, unknown> } {
  const clean: Record<string, unknown> = {};
  const stripped: Record<string, unknown> = {};
  const archiveOnly = new Set<string>(ARCHIVE_ONLY_FIELDS);

  for (const [k, v] of Object.entries(bookData)) {
    if (archiveOnly.has(k)) stripped[k] = v;
    else clean[k] = v;
  }

  return { clean, stripped };
}
