/**
 * PRIOR ART: scripts/lib/finalize-decision.mjs — this module REUSES its predicate
 * (`decideFinalize`: requeue below 50%, bounded by OCR growth) rather than adding
 * a third coverage bar. It does not fit on its own because only Phase 9 calls it,
 * and the stubs are being written by the phases BEFORE Phase 9 (#4719). The
 * Phase 3.5 gate (`< 10%` and `> 50pp`) was rejected as the bar: it is the exact
 * floor #4661 removed from Phase 9, and a 25-page preview of any book of 250+
 * pages clears it. Also checked `scripts/lib/page-counts.mjs` (counts, decides
 * nothing) and `statusOutputViolation` in the orchestrator (asks "is there ANY
 * OCR", which a 25-page preview satisfies).
 *
 * Can this book be advanced to a post-OCR status, or is its OCR a preview sample?
 *
 * THE DEFECT THIS FIXES (#4719)
 * -----------------------------
 * Phase 1.5 OCRs the first 25 pages of a book. That sample is for metadata and
 * routing, and the book is supposed to sit at `archive_complete` until Phase 2
 * Pass 2 transcribes the rest. ~26K books from before that rule reached
 * `chapters_complete` on the sample alone. Once the dial opened, Phase 8 (image
 * extraction) advanced them to `images_complete`: 947 on 2026-10-01 before 10:30Z
 * and 429 in September. Each step pays for a stage run over 25 pages, and the
 * status runs further ahead of the work (pipeline-status-truth.md).
 *
 * Phase 9 already refuses to *finalize* such a book (`decideFinalize` → requeue).
 * Before this module, nothing stopped the earlier phases from advancing it.
 *
 * THE RULE
 * --------
 * A write of a post-OCR status goes through `decideFinalize`. If it says
 * 'requeue', the book goes back to `archive_complete`, the state Phase 2 Pass 2
 * reads, with a recorded reason. If OCR has stalled across requeues, it says
 * 'needs_attention' and the book is parked with the numbers. Otherwise the
 * write goes ahead.
 *
 * Denominator: `pages_count − pages_blank`. The page-count convention is
 * "whole book = pages_count − pages_blank" (`computeTranslationMetrics`). A blank
 * page carries OCR and so is already in `pages_ocr`, which means subtracting it
 * only makes the guard more lenient. Blank pages can never push a book back.
 *
 * WHICH STATUSES
 * --------------
 * Only the *completion* statuses after OCR. `*_submitted` and the in-progress
 * statuses are deliberately excluded. Writers set them once a job already
 * exists, and redirecting at that point would orphan a paid, in-flight job
 * (the #4839 re-dispatch loop). The completion write that follows the job is
 * guarded instead.
 *
 * The requeue counter is SHARED with Phase 9 (`finalize_ocr_requeues` /
 * `finalize_last_ocr`). It is the same loop asking the same question: is OCR
 * still growing? Two counters would double the laps a stalled book gets
 * before it is parked.
 */
import { decideFinalize } from './finalize-decision.mjs';
import { recountBook } from './page-counts.mjs';

/** Completion statuses that claim the book has been through OCR. */
export const POST_OCR_STATUSES = Object.freeze([
  'ocr_complete',
  'translate_partial',
  'translate_complete',
  'summary_indexed',
  'enriched',
  'chapters_complete',
  'images_complete',
  'cover_selected',
  'complete',
]);

const POST_OCR = new Set(POST_OCR_STATUSES);

/** Where a preview stub is sent: the only status Phase 2 Pass 2 reads. */
export const REQUEUE_STATUS = 'archive_complete';

/**
 * Fields the guard reads. The caller must fetch at least these. A projected-away
 * counter reads as 0, and a 0 here would push back every book (#4563/#4565).
 */
export const GUARD_PROJECTION = Object.freeze({
  pages_count: 1, pages_ocr: 1, pages_blank: 1, content_type: 1, resource_type: 1, pipeline_auto: 1,
});

/**
 * Pure decision. `book` must carry the GUARD_PROJECTION fields, freshly counted:
 * the orchestrator recounts before it acts on a hit, because stored counters can
 * lag the OCR that just landed by up to the 2-hour reconciler cycle.
 *
 * @param {object} book
 * @param {string} status  the status a writer is about to set
 * @returns {null | { action: 'requeue'|'needs_attention', status: string, reason: string, extra: object }}
 *   null means "let the write through unchanged".
 */
export function previewStubVerdict(book, status) {
  if (!book || !POST_OCR.has(status)) return null;
  // Artwork and other non-text records have no OCR to finish.
  if (book.resource_type || book.content_type === 'artwork') return null;

  const pagesCount = Math.max(0, book.pages_count || 0);
  const pagesOcr = Math.max(0, book.pages_ocr || 0);
  const pagesBlank = Math.max(0, book.pages_blank || 0);
  // No pages or no OCR is not a preview stub. The output guard (`statusOutputViolation`)
  // and Phase 9 own those cases, and they record their own reasons.
  if (pagesCount === 0 || pagesOcr === 0) return null;

  const pa = book.pipeline_auto || {};
  const requeues = pa.finalize_ocr_requeues || 0;
  const v = decideFinalize({
    totalPages: Math.max(1, pagesCount - pagesBlank),
    ocrCount: pagesOcr,
    contentType: book.content_type,
    requeues,
    lastOcrCount: pa.finalize_last_ocr ?? null,
  });
  if (v.action === 'complete') return null;

  const reason = `preview-stub guard (#4719): refused '${status}' — ${v.reason}`;
  if (v.action === 'needs_attention') {
    return { action: 'needs_attention', status: 'needs_attention', reason, extra: { error: reason } };
  }
  return {
    action: 'requeue',
    status: REQUEUE_STATUS,
    reason,
    extra: {
      retry_count: 0,
      reentered_reason: reason,
      reentered_at: new Date(),
      reentered_from: { attempted: status, from: pa.status ?? null },
      finalize_ocr_requeues: requeues + 1,
      finalize_last_ocr: pagesOcr,
    },
  };
}

/**
 * The guard as `setPipelineStatus` runs it. The stored counters act as a cheap
 * pre-filter. Only a book that looks like a stub is recounted (via `recountBook`,
 * THE counter writer), and the verdict is then taken on the fresh counts. So a
 * book whose full OCR landed minutes ago, with `pages_ocr` still reading 25, is
 * let through instead of being sent back.
 *
 * @returns {Promise<null | ReturnType<typeof previewStubVerdict>>}
 */
export async function resolvePreviewStub(db, bookId, book, status, { recount = recountBook } = {}) {
  if (!previewStubVerdict(book, status)) return null;
  const r = await recount(db, bookId, { reason: 'preview-stub-guard' });
  return previewStubVerdict({ ...book, ...(r?.after || {}) }, status);
}

/** PREVIEW_STUB_GUARD=observe records hits and lets the write through. Default: enforce. */
export function previewStubGuardEnforced(env = process.env) {
  return env.PREVIEW_STUB_GUARD !== 'observe';
}

/**
 * Record a refusal so it can be found again: an `audit_log` row, plus (when enforced)
 * the refused status on the book's `pipeline_auto.reentry_history`. Shared by every
 * writer the guard sits in front of, so they all record it the same way.
 */
export async function recordPreviewStubRefusal(db, bookId, { stub, attempted, prevStatus, title, source, enforced }) {
  db.collection('audit_log').insertOne({
    action: 'pipeline_status_preview_stub',
    book_id: bookId,
    book_title: title,
    metadata: { attempted, from: prevStatus || 'none', redirected_to: stub.status, reason: stub.reason, enforced, source },
    timestamp: new Date(),
  }).catch(() => {});
  if (!enforced) return;
  await db.collection('books').updateOne(
    { id: bookId },
    { $push: { 'pipeline_auto.reentry_history': { $each: [{
      at: new Date(), attempted, from: prevStatus ?? null, to: stub.status, reason: stub.reason, source,
    }], $slice: -20 } } }
  );
}
