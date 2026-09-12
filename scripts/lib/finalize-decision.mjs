/**
 * PRIOR ART: none — checked `scripts/lib/` (stage-coverage.mjs measures coverage
 * but decides nothing) and `.claude/docs/invariants/pipeline-status-truth.md`,
 * which states the rule this file enforces but had no executable form. The logic
 * lived inline in `pipeline-orchestrator.mjs` Phase 9, where it could not be tested.
 *
 * Should this book be called finished?
 *
 * THE DEFECT THIS FIXES
 * ---------------------
 * Phase 9 asked "is there ENOUGH OCR to look real?" — anything above 10% coverage
 * was stamped `complete`. The preview pass transcribes the first 25 pages, so a
 * 250-page book sat at exactly 10% and finalized as done. It then became
 * invisible to every later pass, because the OCR queue only looks at
 * `archive_complete`.
 *
 * Measured 2026-09-04: **13,329 books** (13,318 of them visible to readers) are
 * stamped `complete` with <=30 of >50 pages transcribed. They hold 1,870,238
 * pages, of which 322,861 are transcribed — **1.55 million pages never read**,
 * in books the pipeline believes it has finished. Control: 11,387 `complete`
 * books have >=90% OCR, so the status is normally honest; this is a distinct
 * failure, not how the field is always written.
 *
 * The reader-facing cost is worse than the number: those books look like a
 * deliberate curatorial choice ("we hold it, we didn't translate it") rather
 * than a queue the pipeline dropped.
 *
 * THE RULE
 * --------
 * "Finished" means the OCR is finished, not that some of it exists. Below the
 * completion bar a book goes BACK to `archive_complete` — the state the OCR
 * queue reads — instead of being finalized.
 *
 * Two thresholds, deliberately not one:
 *   - >= COMPLETE_AT   → complete. Matches the canonical readable bar used by
 *                        homepage_stats, so we do not invent a second one.
 *   - <  REQUEUE_BELOW → unfinished; send it back to the OCR queue.
 *   - in between       → complete. A book stuck at 60-90% has usually hit pages
 *                        that will never transcribe (damage, blanks, RECITATION
 *                        blocks). Requeuing those forever would churn the queue
 *                        and park thousands of books that are genuinely as done
 *                        as they will ever be. The gap is deliberate.
 *
 * BOUNDED, because a requeue that never progresses is an infinite loop: a book
 * is requeued only while its OCR count is still GROWING. When a cycle adds no
 * pages, it is parked for a human with the numbers in the message.
 */

export const COMPLETE_AT = 0.9;    // >= 90% transcribed → finished
export const REQUEUE_BELOW = 0.5;  // < 50% transcribed → unfinished, requeue
export const MAX_STALLED_REQUEUES = 2;

/**
 * @param {object} o
 * @param {number} o.totalPages
 * @param {number} o.ocrCount            pages with OCR text right now
 * @param {string} [o.contentType]       'artwork' finalizes at 0 pages by design
 * @param {number} [o.requeues]          how many times finalize has sent it back
 * @param {number} [o.lastOcrCount]      OCR count at the previous requeue
 * @returns {{action: 'complete'|'requeue'|'needs_attention', reason: string}}
 */
export function decideFinalize({ totalPages, ocrCount, contentType, requeues = 0, lastOcrCount = null }) {
  if (!totalPages) {
    // Single-object artworks legitimately have no pages.
    return contentType === 'artwork'
      ? { action: 'complete', reason: 'artwork: no pages by design' }
      : { action: 'needs_attention', reason: 'Empty book: 0 pages. Likely a failed import.' };
  }

  if (!ocrCount) {
    return { action: 'needs_attention', reason: `Finalize blocked: 0/${totalPages} OCR pages. Needs manual investigation.` };
  }

  const coverage = ocrCount / totalPages;
  if (coverage >= COMPLETE_AT) {
    return { action: 'complete', reason: `${ocrCount}/${totalPages} OCR (${(coverage * 100).toFixed(1)}%)` };
  }

  if (coverage < REQUEUE_BELOW) {
    // Only keep requeuing while the count is actually growing. No progress twice
    // running means something is wrong that another lap will not fix.
    const progressed = lastOcrCount === null || ocrCount > lastOcrCount;
    if (!progressed && requeues >= MAX_STALLED_REQUEUES) {
      return {
        action: 'needs_attention',
        reason: `OCR stalled at ${ocrCount}/${totalPages} (${(coverage * 100).toFixed(1)}%) after ${requeues} requeues with no new pages.`,
      };
    }
    return {
      action: 'requeue',
      reason: `OCR unfinished: ${ocrCount}/${totalPages} (${(coverage * 100).toFixed(1)}%) — back to the OCR queue.`,
    };
  }

  return { action: 'complete', reason: `${ocrCount}/${totalPages} OCR (${(coverage * 100).toFixed(1)}%) — partial but substantially transcribed` };
}
