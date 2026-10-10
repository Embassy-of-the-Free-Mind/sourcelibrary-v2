/**
 * Which `batch_jobs` rows are PAID WORK, and which a stop may cancel (#5492).
 *
 * PRIOR ART: scripts/workers/batch-collector.mjs — its main selection held these
 * clauses inline; they move here so the emergency-stop route and the collector
 * share ONE definition of "submitted" and cannot drift apart.
 *
 * A `batch_jobs` row is inserted AFTER its job reached Gemini, carrying the
 * job's name in `job_name` or `gemini_job_name`. A row with a name is paid work:
 * the collector must keep selecting it until it is collected, or Phase 8.5 rolls
 * the book back after 48 h into a second paid dispatch (#4839). A stop that marks
 * such a row `cancelled` abandons it — the collector never selects `cancelled`,
 * and `?resume=true` does not restore it.
 *
 * Only rows with NO Gemini name were never submitted, so only those are safe for
 * a stop to cancel. Parent rows of multi-job submissions (`child_job_ids`) never
 * carry a name of their own; their children do, so a stop leaves parents alone.
 */

/** Statuses the collector treats as "still at Gemini, collect me". */
export const COLLECTABLE_BATCH_STATUSES = Object.freeze([
  'pending',
  'processing',
  'JOB_STATE_PENDING',
  'JOB_STATE_RUNNING',
]);

const NAMED = { $exists: true, $nin: [null, ''] };

/** The row has a Gemini job name: it was submitted, so it is paid work. */
export function hasGeminiJobNameClause() {
  return { $or: [{ job_name: { ...NAMED } }, { gemini_job_name: { ...NAMED } }] };
}

/** Rows the collector must keep collecting: in flight at Gemini, with a name. */
export function collectableBatchJobsFilter() {
  return {
    status: { $in: [...COLLECTABLE_BATCH_STATUSES] },
    ...hasGeminiJobNameClause(),
  };
}

/**
 * Rows an emergency stop may cancel: active in the DB but never submitted to
 * Gemini (no job name), and not a parent of submitted children.
 */
export function unsubmittedBatchJobsFilter() {
  return {
    status: { $in: ['pending', 'processing'] },
    child_job_ids: { $exists: false },
    $and: [
      { $or: [{ job_name: { $exists: false } }, { job_name: { $in: [null, ''] } }] },
      { $or: [{ gemini_job_name: { $exists: false } }, { gemini_job_name: { $in: [null, ''] } }] },
    ],
  };
}
