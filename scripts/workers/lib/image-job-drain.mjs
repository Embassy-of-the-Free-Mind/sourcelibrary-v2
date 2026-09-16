/**
 * Draining stalled image_extraction jobs (#4839).
 *
 * PRIOR ART: scripts/maintenance/force-complete-job.mjs — finalizes ONE job by hand from a page
 * recount, with no notion of "attempted during this run", and is never called by a worker.
 * src/lib/job-completion.ts is the Lambda-side finisher; it runs per write result and cannot see a
 * job whose remaining pages will never produce one. Neither fits a reaper that must decide, every
 * 30 minutes, what to do with a job that has stopped reporting.
 *
 * Why a job stops short of its total:
 *
 *   `jobs.progress.completed` is recounted by the writer as "target pages that have
 *   `detected_images`". A page the model looked at and found NO illustrations on gets
 *   `image_extraction_updated_at` but never `detected_images`, so it is paid for, finished, and
 *   permanently uncounted. Every book with at least one illustration-free candidate page therefore
 *   parks at `completed = total − k` forever, is reaped as a zombie, rolled back by the
 *   orchestrator's orphan detector, and re-dispatched WHOLE — 1,385 cancellations and 3,209
 *   re-paid pages in the week to 2026-09-14.
 *
 * The honest completion test is "was this page attempted during THIS run?", i.e.
 * `image_extraction_updated_at >= job.created_at` — which is exactly what the Lambda's own
 * skip-if-current guard uses. That is what this module counts.
 *
 * A job that drained but produced nothing at all is NOT finalized: zero results means the lane
 * itself is broken (queue lost, Lambda erroring before the write), and advancing the book would
 * claim work that never ran. Those are cancelled with a reason carrying NO_RESULTS_MARK so the
 * give-up bound in Phase 8 can count them.
 */

/** Cancel-reason marker for "the job drained without a single page reporting" (#4839). */
export const NO_RESULTS_MARK = 'no page reported a result (#4839)';

/** How many zero-result dispatches a book gets before it is parked for a human. */
export const MAX_NO_RESULT_DISPATCHES = 3;

/**
 * Decide what a stalled image job's outcome is, given which of its target pages were attempted.
 * Pure — the DB work lives in drainStalledImageJobs().
 *
 * @returns {{ outcome: 'completed'|'completed_with_errors'|'no_results', attempted: number,
 *             missingPageIds: string[] }}
 */
export function classifyImageJobDrain(targetPageIds, attemptedPageIds) {
  const attempted = new Set(attemptedPageIds);
  const missingPageIds = targetPageIds.filter(id => !attempted.has(id));
  const attemptedCount = targetPageIds.length - missingPageIds.length;

  if (targetPageIds.length === 0) return { outcome: 'completed', attempted: 0, missingPageIds: [] };
  if (attemptedCount === 0) return { outcome: 'no_results', attempted: 0, missingPageIds };
  return {
    outcome: missingPageIds.length === 0 ? 'completed' : 'completed_with_errors',
    attempted: attemptedCount,
    missingPageIds,
  };
}

/**
 * Finalize stalled image_extraction jobs on drain rather than on an exact count.
 *
 * Returns the ids of jobs it finalized (the caller must NOT also cancel those) and the jobs it
 * judged to have produced nothing, which the caller cancels as before.
 *
 * @param {import('mongodb').Db} db
 * @param {Array<{_id: any, id?: string, book_id?: string, config?: {page_ids?: string[]}, created_at?: Date, progress?: object}>} jobs
 * @param {{ dryRun?: boolean, source?: string }} opts
 */
export async function drainStalledImageJobs(db, jobs, { dryRun = false, source = 'reaper' } = {}) {
  const finalized = [];
  const noResults = [];

  for (const job of jobs) {
    const targetPageIds = job.config?.page_ids || [];
    const createdAt = job.created_at ? new Date(job.created_at) : null;

    // "Attempted during this run" — the same test the Lambda uses to skip a page it already did.
    const attemptedPageIds = createdAt
      ? (await db.collection('pages')
          .find({ id: { $in: targetPageIds }, image_extraction_updated_at: { $gte: createdAt } })
          .project({ id: 1 })
          .toArray()).map(p => p.id)
      : [];

    const { outcome, attempted, missingPageIds } = classifyImageJobDrain(targetPageIds, attemptedPageIds);

    if (outcome === 'no_results') {
      noResults.push(job);
      continue;
    }

    const status = outcome === 'completed' ? 'completed' : 'completed_with_errors';
    const note = `drained by ${source}: ${attempted}/${targetPageIds.length} target pages were extracted in this run`
      + (missingPageIds.length ? `; ${missingPageIds.length} never reported` : '')
      + ' (#4839)';

    if (!dryRun) {
      await db.collection('jobs').updateOne(
        { _id: job._id },
        {
          $set: {
            status,
            'progress.completed': attempted,
            'progress.failed': missingPageIds.length,
            completed_at: new Date(),
            updated_at: new Date(),
            drained_at: new Date(),
            drain_reason: note,
            // The give-up list, on a row someone can find — no silent skips.
            ...(missingPageIds.length ? { unreported_page_ids: missingPageIds.slice(0, 500) } : {}),
          },
        },
      );
      // The book keeps `pipeline_auto.image_extraction_job_id`; the orchestrator's Phase 8 check
      // reads THIS status and advances the book to images_complete with a real page count.
      if (job.book_id) {
        await db.collection('books').updateOne(
          { id: job.book_id, 'job.job_id': job.id },
          { $unset: { job: '' }, $set: { updated_at: new Date() } },
        );
      }
    }

    finalized.push({ jobId: job.id, _id: job._id, status, attempted, total: targetPageIds.length, missing: missingPageIds.length, note });
  }

  return { finalized, noResults };
}

/**
 * How many times this book has been dispatched and come back with nothing at all.
 * Counts only cancellations written by the drain path, so it starts at zero for every book when
 * this ships and can never be inflated by the pre-fix loop's history.
 */
export async function countNoResultDispatches(db, bookId) {
  return db.collection('jobs').countDocuments({
    type: 'image_extraction',
    book_id: bookId,
    cancel_reason: { $regex: NO_RESULTS_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
  });
}
