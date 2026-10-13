/**
 * Phase 2 Pass 1 (25-page preview OCR): may this book take the preview path? (#4624)
 *
 * PRIOR ART: scripts/workers/pipeline-orchestrator.mjs Pass 1 `$match` — the same
 * two conditions inside the aggregate. They hold for the normal run, but
 * `applyBookOverride()` REPLACES the candidate list with the `--book` target after
 * the query, so with `--book` the preview ran every time. Pass 2 then found that
 * fresh preview batch active and skipped, so a 398-page book took ~16 invocations
 * of 25 pages instead of one full pass. This re-applies the conditions after the
 * override.
 *
 * A book takes the preview only when it has no OCR yet and is not a RECITATION
 * retry (those go to Pass 2 with a fallback model). Everything else is Pass 2's.
 */

/** @returns {string|null} why the book is NOT a preview candidate, or null if it is. */
export function previewIneligibleReason(book) {
  if (!book) return 'not found';
  const ocr = Number(book.pages_ocr) || 0;
  if (ocr > 0) return `already has ${ocr} OCR'd page(s) — full pass`;
  if (book.pipeline_auto?.recitation_retry) return 'RECITATION retry — full pass with fallback model';
  return null;
}

/** Split candidates into preview-eligible books and the ones dropped (with reasons). */
export function partitionPreviewCandidates(books) {
  const eligible = [];
  const dropped = [];
  for (const b of books) {
    const reason = previewIneligibleReason(b);
    if (reason) dropped.push({ book: b, reason });
    else eligible.push(b);
  }
  return { eligible, dropped };
}
