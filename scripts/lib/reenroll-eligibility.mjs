/**
 * Eligibility predicate for re-enrolling loop-quarantined books (#3750).
 *
 * Books at `pipeline_auto.status: 'loop_quarantine_hold'` had recitation-loop
 * translation garbage cleared by fix-translation-loops.mjs (translations
 * $unset, pages_translated decremented) and were then parked in a status the
 * orchestrator never picks up. Re-enrollment resets them to 'ocr_complete' so
 * Phase 4 dispatches translation again.
 *
 * Pure function over the book document so the exclusion rules — above all the
 * takedown rule — can be unit-tested without a database
 * (tests/unit/reenroll-eligibility.test.ts).
 *
 * Rules, in order:
 *  1. hidden_reason set (any truthy value) → NEVER re-enter. Takedowns and
 *     copyright holds must not be resurrected by bulk sweeps — repo lesson
 *     #3099 (bulk flips must respect hidden_reason). This also covers the
 *     visible:false + hidden_reason case by construction.
 *  2. status must still be 'loop_quarantine_hold' (guards races with other
 *     sessions between the candidate query and the write).
 *  3. pages_ocr > 0 — 'ocr_complete' is only a truthful re-entry point for a
 *     book that actually has OCR for Phase 4 to translate.
 *  4. pages_translated < pages_ocr — the earlier clear decremented the
 *     counter, so a "fully translated" quarantined book means either the
 *     garbage was never cleared or the counters are wrong; skip and report
 *     rather than re-enroll on bad premises.
 */

export const QUARANTINE_STATUS = 'loop_quarantine_hold';
export const REENTRY_STATUS = 'ocr_complete';

/**
 * @param {object} book — needs hidden_reason, pipeline_auto.status,
 *                        pages_ocr, pages_translated
 * @returns {{ eligible: boolean, reason: string }}
 *   reason is 'ok' when eligible, else the exclusion:
 *   'missing_book' | 'hidden_reason' | 'wrong_status' | 'no_ocr' | 'fully_translated'
 */
export function evaluateReenrollment(book) {
  if (!book) return { eligible: false, reason: 'missing_book' };

  // Rule 1: takedowns never re-enter (#3099). ANY truthy hidden_reason —
  // including a whitespace-only string or an unexpected shape — excludes.
  // Fail closed: only absent / null / '' (no takedown recorded) passes.
  if (book.hidden_reason) {
    return { eligible: false, reason: 'hidden_reason' };
  }

  // Rule 2: still quarantined.
  if (book.pipeline_auto?.status !== QUARANTINE_STATUS) {
    return { eligible: false, reason: 'wrong_status' };
  }

  // Rules 3–4: there must be OCR'd pages left untranslated.
  const ocr = Number(book.pages_ocr) || 0;
  if (ocr <= 0) return { eligible: false, reason: 'no_ocr' };
  const translated = Number(book.pages_translated) || 0;
  if (translated >= ocr) return { eligible: false, reason: 'fully_translated' };

  return { eligible: true, reason: 'ok' };
}
