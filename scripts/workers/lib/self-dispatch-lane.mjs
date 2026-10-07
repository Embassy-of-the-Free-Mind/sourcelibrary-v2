/**
 * translate-worker selfDispatch(): never take a book that has an open translate_batch_runs run
 * (#5429). Its pages are already on their way; realtime taking the book anyway translated 369
 * pages the chained runs then dropped as already done (2026-09-30 22:36Z). The priority floor that
 * leaves the backlog to the chained lane is #5430's LANE_FILTER in the worker itself.
 *
 * PRIOR ART: scripts/lib/translate-batch-chained.mjs — enrolChainedRun's open-run check and
 * phase4ExcludedBookIds use the same "not terminal" definition; neither is exported in a form that
 * takes both lanes' terminals alone, and that file is not edited here (the chained lane is being
 * changed in parallel, #5427/#5428).
 */
import { TERMINAL_PHASES as CHAINED_TERMINAL } from '../../lib/translate-batch-chained.mjs';
import { RUNS_COLLECTION, TERMINAL_PHASES as SEAM_TERMINAL } from '../../lib/translate-batch-seam.mjs';

/** A run in any of these phases no longer owns its book's pages (both lanes' terminals). */
const RUN_DONE_PHASES = [...new Set([...CHAINED_TERMINAL, ...SEAM_TERMINAL])];

/** Book ids with an open translate_batch_runs run of any lane. */
export async function openRunBookIds(db) {
  return db.collection(RUNS_COLLECTION).distinct('book_id', { phase: { $nin: RUN_DONE_PHASES } });
}

/**
 * The $match clause that excludes those books. Wrapped in $and so it spreads beside a selective-
 * unpause SCOPE_FILTER ({ id: { $in } }) without overwriting its `id` key.
 */
export function notInOpenRun(openRunIds) {
  return { $and: [{ id: { $nin: openRunIds } }] };
}
