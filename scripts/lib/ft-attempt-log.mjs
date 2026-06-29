#!/usr/bin/env node
/**
 * ft-attempt-log.mjs — node/.mjs twin of src/lib/first-translation/attempt-log.ts.
 *
 * The live first-translation producers (the nightly grounded-Gemini crons) run
 * real catalog/web searches every night and, until now, threw the search away —
 * writing only a transient verdict to a side field. A "first translation" claim
 * is a claim of ABSENCE, and an absence claim is only ever as strong as the
 * documented search behind it. So the search itself is the durable asset: keep
 * it append-only in `first_translation_attempts`, and any future approach
 * inherits it instead of re-paying for it.
 *
 * This helper lets the .mjs cron scripts append an attempt without importing the
 * TS module (node can't load .ts directly). It mirrors the schema in
 * attempt-log.ts — keep the two in sync. Logging is best-effort: a failure here
 * must never break the producer's primary job.
 */

export const ATTEMPTS_COLLECTION = 'first_translation_attempts';

/** Deterministic id so a re-run of the same book in the same instant is idempotent. */
export function makeAttemptId(bookId, method, isoDate) {
  return `${bookId}:${method}:${isoDate}`;
}

/** Host domains from grounding URLs — the durable record of what was consulted. */
export function domainsFromEvidence(evidence) {
  return [
    ...new Set(
      (evidence || [])
        .map((e) => {
          try {
            return new URL(e.url).hostname.replace(/^www\./, '');
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ];
}

/**
 * Append one attempt. Idempotent on attempt_id (upsert + $setOnInsert), so a
 * cron retry won't duplicate. Never throws into the caller.
 * @returns {Promise<boolean>} true if a new attempt was written.
 */
export async function appendAttempt(db, attempt) {
  try {
    const res = await db.collection(ATTEMPTS_COLLECTION).updateOne(
      { attempt_id: attempt.attempt_id },
      { $setOnInsert: attempt },
      { upsert: true },
    );
    return res.upsertedCount > 0;
  } catch (e) {
    console.warn(`  [attempt-log] skip ${attempt.book_id}: ${e.message}`);
    return false;
  }
}
