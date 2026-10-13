// PRIOR ART: scripts/lib/pre-translation-gate.mjs — stamps/releases its own block reason but does not
// count a job's skips; scripts/lib/end-batch-job.mjs — Batch-lane job terminal states, not the realtime
// translate-worker's `jobs` rows; scripts/audit/scope-progress.mjs — detects the drift after the fact.
/**
 * What a realtime translation job did, counted honestly (#5108).
 *
 * A page stamped `translation.health_blocked` (collapse/runaway refusal, loop or illegible source,
 * the pre-translation gate, stray script…) is excluded by every translate selector. A job created
 * for exactly those pages used to end `completed`, progress `{ total: 2, completed: 0, failed: 0 }`:
 * a job that did nothing reported success. Here the skip is a third counter, and a job whose
 * pages were ALL skipped ends `blocked`, naming them.
 *
 * Measured from the pages (state), not accumulated in the run (events): a job resumed across
 * runs, and a page refused before the call or after it, are counted the same way.
 */

/** Terminal status for a job whose every page was health-blocked: nothing failed, nothing was written. */
export const BLOCKED_JOB_STATUS = 'blocked';

/** How many blocked pages a job/log line names before it says "…and N more". */
const NAME_CAP = 25;

/** A health-blocked page that still has no translation. */
export const HEALTH_BLOCKED_RESIDUE = Object.freeze({
  'translation.health_blocked': { $exists: true },
  $or: [
    { 'translation.data': { $exists: false } },
    { 'translation.data': null },
    { 'translation.data': '' },
  ],
});

/**
 * Health-blocked, untranslated pages in a job's scope: its `config.page_ids` when it names
 * them, else the whole book. Returns `[{ id, page_number, reason }]` sorted by page.
 */
export async function healthBlockedResidue(db, { bookId, pageIds }) {
  const scope = Array.isArray(pageIds) && pageIds.length > 0 ? { id: { $in: pageIds } } : { book_id: bookId, page_number: { $gt: 0 } };
  const rows = await db.collection('pages')
    .find({ ...scope, ...HEALTH_BLOCKED_RESIDUE }, { projection: { id: 1, page_number: 1, 'translation.health_blocked': 1 } })
    .sort({ page_number: 1 })
    .toArray();
  return rows.map((p) => ({ id: p.id, page_number: p.page_number, reason: String(p.translation?.health_blocked) }));
}

/** "p19 (collapsed), p98 (collapsed)" — capped, for a log line or a job note. */
export function nameBlockedPages(blocked) {
  const named = blocked.slice(0, NAME_CAP).map((b) => `p${b.page_number} (${b.reason})`).join(', ');
  return blocked.length > NAME_CAP ? `${named} …and ${blocked.length - NAME_CAP} more` : named;
}

/**
 * The job's terminal state. `completed`/`failed` are the job's running counters; `skipped` is
 * the health-blocked residue in its scope. A job is done when every page is accounted for by
 * one of the three; it is `blocked` when nothing was written and nothing failed, only skipped.
 */
export function translateJobOutcome({ total, completed = 0, failed = 0, skipped = 0 }) {
  const isComplete = completed + failed + skipped >= (total || 0);
  if (!isComplete) return { isComplete, status: 'processing' };
  if (skipped > 0 && completed === 0 && failed === 0) return { isComplete, status: BLOCKED_JOB_STATUS };
  return { isComplete, status: failed > 0 ? 'completed_with_errors' : 'completed' };
}

/** The `$set` recording the skip on the job (progress counter + the named pages). */
export function blockedJobFields(blocked) {
  if (blocked.length === 0) return { 'progress.skipped_health_blocked': 0 };
  return {
    'progress.skipped_health_blocked': blocked.length,
    health_blocked_pages: blocked.slice(0, NAME_CAP).map(({ page_number, reason }) => ({ page_number, reason })),
    note: `health-blocked, not translated: ${nameBlockedPages(blocked)} (#5108)`,
  };
}
