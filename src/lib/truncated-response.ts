/**
 * PRIOR ART: `src/lib/ocr-loop-guard.ts` (and its `scripts/lib/*.mjs` twin) is the
 * sibling guard on this write path; it judges the TEXT and deliberately ignores
 * bodies under 300 characters, which is the window a truncated read lands in. This
 * file is its missing half: the provider's own verdict on whether it finished.
 *
 * TS twin of `scripts/lib/truncated-response.mjs` — same contract, kept in step by
 * `tests/unit/truncated-response.test.ts`. The .mjs copy carries the full incident
 * note; the short version:
 *
 * Gemini returns `finishReason: 'MAX_TOKENS'` with the partial text still attached.
 * Collectors branched on RECITATION (a refusal, no text) and on missing text. A
 * truncation is neither — there IS text and it is not a refusal — so it fell through
 * and was stored as a finished page. 48 pages of Stefan's Forum of Conscience books
 * held a 107-382 character stub ending mid-word, counted in `pages_ocr`, and the
 * translate lane then stored the model's "Please provide the Latin text…" reply as
 * the page's translation, live to readers (#4890).
 *
 * A partial answer is a failed read, not a short one.
 */

/**
 * Finish reasons that mean "the text you are holding is incomplete".
 *
 * A short allow-list of known-truncating values rather than "anything that is not
 * STOP": providers add reasons, and discarding a good read because its reason is
 * merely unfamiliar is the more expensive mistake.
 */
export const TRUNCATING_FINISH_REASONS = new Set([
  'MAX_TOKENS', // Gemini / Vertex
  'LENGTH', // OpenAI-shaped responses
  'FINISH_REASON_MAX_TOKENS',
]);

/** True when a candidate carries text the provider says was cut off. */
export function isTruncatedCandidate(candidate: { finishReason?: string | null } | null | undefined): boolean {
  const reason = candidate?.finishReason;
  if (typeof reason !== 'string' || !reason) return false;
  return TRUNCATING_FINISH_REASONS.has(reason.toUpperCase());
}

/** The reason string to record, so the cause is legible later. */
export function truncationFailReason(candidate: { finishReason?: string | null } | null | undefined): string {
  return `truncated:${String(candidate?.finishReason || 'unknown').toUpperCase()}`;
}
