/**
 * Derive a graded verdict from the accumulated attempt ledger (issue #2564 / #2805).
 *
 * The attempt log (`first_translation_attempts`) is the durable, approach-agnostic
 * record of every search ever run for a book. This module turns that pile into a
 * single `book.first_translation` verdict — "verdict = f(accumulated evidence)",
 * the consequence the durability principle has been building toward. It does NOT
 * write the public `is_first_translation` boolean; that stays a derived read of
 * the verdict (see derive.ts) materialized only by the sign-off-gated reconcile.
 *
 * Pure over an injected attempts array (mirrors prior-evidence.ts / resolve.ts) so
 * it is unit-testable without a DB.
 *
 * The mapping is deliberately conservative — it is the input to a public claim:
 *  - reuse_prior (a URL-checkable prior found) → not_first.
 *      strength = strong only on CROSS-FAMILY agreement (≥2 families found it),
 *      else moderate.
 *  - absence (nobody found a prior) → first_no_prior.
 *      strength weighed by INDEPENDENT FAMILIES, not raw method count (two
 *      correlated catalog checks are one vote): ≥2 families → moderate, else weak.
 *      Never 'strong' from absence here — a strong absence needs an independent
 *      agent/human family this deriver doesn't manufacture.
 *  - unverified (no usable evidence) → null (write nothing).
 *
 * Why weak vs moderate matters: canPromoteToFirst() (derive.ts) only lets a
 * currently-unbadged book be PROMOTED on a non-weak verdict from a real
 * adjudicator. So a single-family (e.g. catalog-only) absence stays weak →
 * badges but never auto-promotes and never enters the public headline. Promotion
 * requires genuinely independent corroboration.
 */

import {
  summarizePriorEvidence,
  attemptFamily,
} from './prior-evidence';
import {
  strongestAttempt,
  type FirstTranslationAttempt,
} from './attempt-log';
import type {
  FirstTranslation,
  MatchKey,
  Resolver,
} from './types';

/** Map an attempt's method to the resolver tier that should own the verdict. */
function methodToResolver(method: FirstTranslationAttempt['method']): Resolver {
  switch (method) {
    case 'tier2_agent':
      return 'tier2_agent';
    case 'human':
      return 'human';
    case 'tier0_linked':
      return 'tier0_linked';
    // tier1_catalog and gemini_verifier are both catalog-grounded searches.
    default:
      return 'tier1_catalog';
  }
}

const MATCH_RANK: Record<MatchKey, number> = {
  work_id: 3,
  transliteration: 2,
  author_title: 1,
  none: 0,
};

/** Best (most specific) match_key across a set of attempts. */
function bestMatchKey(attempts: FirstTranslationAttempt[]): MatchKey {
  let best: MatchKey = 'none';
  for (const a of attempts) {
    if (MATCH_RANK[a.match_key] > MATCH_RANK[best]) best = a.match_key;
  }
  return best;
}

/**
 * Resolve the accumulated attempts for ONE book into a graded verdict, or null
 * when the pile doesn't yet justify any verdict. Pure — no DB, no clock.
 */
export function deriveVerdictFromAttempts(
  attempts: FirstTranslationAttempt[],
): FirstTranslation | null {
  if (attempts.length === 0) return null;
  const s = summarizePriorEvidence(attempts);

  if (s.recommendation === 'reuse_prior') {
    const found = attempts.filter((a) => a.result === 'found');
    const strongest = strongestAttempt(found);
    return {
      verdict: 'not_first',
      // Cross-family agreement on a prior is the strong signal; one family = moderate.
      evidence_strength: s.foundFamilies >= 2 ? 'strong' : 'moderate',
      our_completeness: 'unknown',
      match_key: bestMatchKey(found),
      prior_relationship: 'same_text',
      prior_refs: strongest?.found_refs && strongest.found_refs.length > 0
        ? strongest.found_refs
        : undefined,
      resolver: methodToResolver(strongest?.method ?? 'tier1_catalog'),
      best_attempt_id: s.foundAttemptId ?? strongest?.attempt_id,
    };
  }

  if (s.recommendation === 'absence_strong' || s.recommendation === 'absence_weak') {
    const absences = attempts.filter((a) => a.result === 'none');
    const strongest = strongestAttempt(absences);
    // Prefer the most independent family as the verdict's owner (agent > human > catalog).
    const ownerMethod =
      absences.find((a) => attemptFamily(a) === 'agent')?.method ??
      absences.find((a) => attemptFamily(a) === 'human')?.method ??
      strongest?.method ??
      'tier1_catalog';
    return {
      verdict: 'first_no_prior',
      // Independence by FAMILY, not raw count. Never strong from absence here.
      evidence_strength: s.independentAbsenceFamilies >= 2 ? 'moderate' : 'weak',
      our_completeness: 'unknown',
      match_key: bestMatchKey(absences),
      resolver: methodToResolver(ownerMethod),
      best_attempt_id: strongest?.attempt_id,
    };
  }

  // 'unverified' — usable evidence isn't on record yet. Write nothing.
  return null;
}
