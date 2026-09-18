/**
 * PRIOR ART: `scripts/lib/ocr-loop-guard.mjs` judges the TEXT (periodic runs,
 * trigram share) and deliberately ignores bodies under `DEFAULT_MIN_BODY` = 300
 * chars, because a loop cannot be detected in a snippet — which is exactly the
 * window a truncated read lands in. `scripts/lib/blank-page-guard.mjs` judges a
 * page that should have no text. Neither reads the provider's own verdict on
 * whether it finished, which is what this file adds. `ocr-plausibility.mjs`
 * scores a finished read; it assumes the read finished.
 *
 * A truncated generation is the provider telling us the answer is incomplete.
 *
 * Gemini returns `finishReason: 'MAX_TOKENS'` with the partial text still in the
 * candidate. The collector branched on RECITATION (a refusal, no text) and on
 * missing text — a truncation is neither: there IS text, and the reason is not a
 * refusal. So it fell through and was stored as a finished page.
 *
 * Measured 2026-09-18 (#4890): 48 pages across 13 books stored a stub of 107-382
 * chars ending mid-word or mid-tag. Each page also carried
 * `fail_count: 1, fail_reason: 'error:13'` — the failure was recorded on the
 * document and nothing consumed it. `pages_ocr` counted them, so every
 * downstream check passed, and the translate lane then stored the model's
 * "Please provide the Latin text…" reply as the page's translation, live to
 * readers.
 *
 * The rule this encodes: a partial answer is a failed read, not a short one.
 */

/**
 * Finish reasons that mean "the text you are holding is incomplete".
 *
 * Deliberately a SHORT allow-list of known-truncating values rather than
 * "anything that is not STOP": new reasons appear in provider APIs, and an
 * unknown reason that actually completed must not be discarded as a failure —
 * that would throw away good reads, which is the more expensive mistake here.
 * Anything unrecognised is left to the existing branches.
 */
export const TRUNCATING_FINISH_REASONS = new Set([
  'MAX_TOKENS',        // Gemini / Vertex
  'LENGTH',            // OpenAI-shaped responses
  'FINISH_REASON_MAX_TOKENS',
]);

/**
 * True when a candidate carries text that the provider says was cut off.
 *
 * Takes the candidate, not the text, on purpose: the signal is the provider's,
 * and a length heuristic over the body would re-invent the blind spot this
 * exists to close. Callers that only have a reason string can pass
 * `{ finishReason }`.
 *
 * @param {{finishReason?: string}|null|undefined} candidate
 * @returns {boolean}
 */
export function isTruncatedCandidate(candidate) {
  const reason = candidate?.finishReason;
  if (typeof reason !== 'string' || !reason) return false;
  return TRUNCATING_FINISH_REASONS.has(reason.toUpperCase());
}

/** The `fail_reason` string to record, so the cause is legible later. */
export function truncationFailReason(candidate) {
  return `truncated:${String(candidate?.finishReason || 'unknown').toUpperCase()}`;
}
