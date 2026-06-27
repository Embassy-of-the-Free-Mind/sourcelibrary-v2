/**
 * Durable, approach-agnostic evidence reuse (issue #2564 / #2780).
 *
 * The verification *approach* keeps changing (heuristic → Gemini → Claude → …),
 * but the evidence each run leaves in `first_translation_attempts` is a set of
 * atemporal facts: "on date D, approach A ran queries Q against sources S and
 * found / didn't find prior P". Those facts stay true regardless of who produced
 * them or who reads them later.
 *
 * This module lets ANY future approach READ that accumulated pile before it
 * spends — so absence accumulates monotonically (the systematic-review model)
 * instead of every run starting cold. It is pure over an injected attempts array
 * (mirrors resolve.ts's injected-tier pattern) so it's unit-testable without a DB;
 * `loadPriorEvidence` is the thin Mongo fetch wrapper.
 *
 * It writes nothing. The verdict is still produced by the resolver/derive layer;
 * this only surfaces what's already known so the resolver can short-circuit,
 * skip already-covered ground, and weight absence by cross-approach independence.
 */

import type { Db } from 'mongodb';
import {
  ATTEMPTS_COLLECTION,
  strongestAttempt,
  type FirstTranslationAttempt,
  type PriorTranslation,
} from './attempt-log';

/** What the accumulated evidence pile says about a book, before any new work. */
export interface PriorEvidenceSummary {
  /** Total prior attempts on record (any approach). */
  attemptCount: number;
  /** A trustworthy prior was already found (presence is decisive, checkable). */
  priorFound: boolean;
  /** The strongest found prior with a real URL, if any — ready to reuse. */
  foundPrior: PriorTranslation | null;
  /** Union of every source any approach has already consulted (don't re-run). */
  searchedSources: string[];
  /** Union of every query already issued (don't re-run verbatim). */
  searchedQueries: string[];
  /**
   * Distinct approaches (methods) that independently returned "none". Absence
   * from N *independent* approaches is far stronger than N correlated misses —
   * this is the number that should raise an absence claim's evidence_strength.
   */
  independentAbsenceMethods: number;
  /**
   * What a new approach should do given the pile:
   *  - 'reuse_prior'      a trustworthy prior already exists → don't re-search; demote.
   *  - 'absence_strong'   ≥2 independent approaches found nothing → a fresh pass adds little.
   *  - 'absence_weak'     some absence evidence, but not yet independent/bounded.
   *  - 'unverified'       nothing on record → full verification warranted.
   */
  recommendation: 'reuse_prior' | 'absence_strong' | 'absence_weak' | 'unverified';
}

const hasUrl = (p?: PriorTranslation): boolean => !!p?.source_url && /^https?:\/\//.test(p.source_url);

/** Pure: summarize what the accumulated attempts already establish. */
export function summarizePriorEvidence(
  attempts: FirstTranslationAttempt[],
): PriorEvidenceSummary {
  const searchedSources = [...new Set(attempts.flatMap((a) => a.sources_checked ?? []).filter(Boolean))];
  const searchedQueries = [...new Set(attempts.flatMap((a) => a.queries ?? []).filter(Boolean))];

  // A reusable found-prior: the strongest attempt that actually found one, with a
  // real grounding URL (presence claims must be checkable, never bare prose).
  const found = attempts.filter((a) => a.result === 'found');
  const strongestFound = strongestAttempt(found);
  const foundPrior =
    strongestFound?.priors?.find((p) => hasUrl(p)) ?? strongestFound?.priors?.[0] ?? null;
  const priorFound = !!strongestFound && hasUrl(foundPrior ?? undefined);

  // Cross-approach independence of the absence: distinct methods returning none.
  const independentAbsenceMethods = new Set(
    attempts.filter((a) => a.result === 'none').map((a) => a.method),
  ).size;

  let recommendation: PriorEvidenceSummary['recommendation'];
  if (priorFound) recommendation = 'reuse_prior';
  else if (independentAbsenceMethods >= 2) recommendation = 'absence_strong';
  else if (independentAbsenceMethods === 1) recommendation = 'absence_weak';
  else recommendation = 'unverified';

  return {
    attemptCount: attempts.length,
    priorFound,
    foundPrior,
    searchedSources,
    searchedQueries,
    independentAbsenceMethods,
    recommendation,
  };
}

/** Thin Mongo fetch + summarize. Reads only; writes nothing. */
export async function loadPriorEvidence(
  db: Db,
  bookId: string,
): Promise<PriorEvidenceSummary> {
  const attempts = await db
    .collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION)
    .find({ book_id: bookId })
    .toArray();
  return summarizePriorEvidence(attempts);
}
