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
 * Read before you spend. Return an existing attempt that already found a
 * TRUSTWORTHY prior English translation for this book, or null.
 *
 * The bar is deliberately high (precision over recall) because the consequence
 * is skipping a paid re-search: a prior counts only when it carries a concrete,
 * resolvable reference — a registry id (`found_refs`, e.g. our own
 * translation_catalogs match) or a `source_url` on the prior — AND its
 * evidence_strength is not 'weak'. A grounded model "found" with no resolvable
 * sighting does NOT qualify (that is exactly the ~63%-fabrication risk), so it
 * never short-circuits a search. This mirrors the First Principle: only a
 * confirmed sighting is trusted enough to stop looking.
 *
 * @returns {Promise<object|null>} the strongest qualifying attempt, or null.
 */
export async function findTrustworthyPrior(db, bookId) {
  const found = await db
    .collection(ATTEMPTS_COLLECTION)
    .find({ book_id: bookId, result: 'found' })
    .toArray();
  const qualifying = found.filter((a) => {
    if (a.evidence_strength === 'weak') return false;
    const hasRef = Array.isArray(a.found_refs) && a.found_refs.length > 0;
    const hasUrl = Array.isArray(a.priors) && a.priors.some((p) => p && p.source_url);
    return hasRef || hasUrl;
  });
  if (qualifying.length === 0) return null;
  // Prefer the strongest: a registry/structured ref over a bare URL, then strength.
  const rank = { strong: 2, moderate: 1, weak: 0 };
  qualifying.sort((a, b) => {
    const aRef = Array.isArray(a.found_refs) && a.found_refs.length > 0 ? 1 : 0;
    const bRef = Array.isArray(b.found_refs) && b.found_refs.length > 0 ? 1 : 0;
    if (aRef !== bRef) return bRef - aRef;
    return (rank[b.evidence_strength] ?? 0) - (rank[a.evidence_strength] ?? 0);
  });
  return qualifying[0];
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
