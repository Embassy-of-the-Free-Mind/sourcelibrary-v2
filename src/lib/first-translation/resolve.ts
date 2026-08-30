/**
 * Effort-tier router for first-translation resolution (issue #2564).
 *
 * STATUS (#3785 drift 7, 2026-08-09): `resolve()` is NOT wired into
 * production — the live escalation router is scripts/eval/ft-ladder.ts, which
 * implements its own cascade. Production imports from this module only the
 * `ResolvableBook` type (ft-ladder.ts, ft-tier0-resolve.ts). The routing logic
 * is kept as the unit-tested design reference
 * (tests/unit/first-translation-resolve-reuse.test.ts); wire it or delete it
 * deliberately, but do not assume it runs.
 *
 * Match effort to difficulty. Cost rises tier by tier; every tier appends an
 * attempt to the provenance log.
 *
 *   Tier 0 — registry lookup by work_id (free, deterministic).
 *            A complete prior of THIS text → not_first, strong. DONE.
 *   Tier 1 — multi-catalog sweep (existing 7-catalog matcher). Confidence
 *            weighted by match_key (work_id >> fuzzy author+title).
 *   Tier 2 — per-book agent (the demonstrated adjudicator) for non-Western,
 *            needs_review, high-value, work-identity ambiguity, or sampled books.
 *
 * The tiers themselves (Mongo registry, the Gemini 7-catalog agent, the Tier-2
 * Claude agent) are injected — this module owns the ROUTING, not the I/O. That
 * keeps the decision logic pure and unit-testable, and keeps paid calls behind
 * an explicit dependency the caller wires up (and gates on a cost sign-off).
 */

import type { FirstTranslation, FirstTranslationBook } from './types';
import type { FirstTranslationAttempt } from './attempt-log';
import { strongestAttempt } from './attempt-log';
import type { PriorEvidenceSummary } from './prior-evidence';

/** Result of running a single tier: a candidate verdict + its attempt record. */
export interface TierOutcome {
  /** Null when the tier could not decide and wants to escalate. */
  verdict: FirstTranslation | null;
  attempt: FirstTranslationAttempt;
  /** True when the tier is confident enough to stop the cascade here. */
  terminal: boolean;
}

/** A tier implementation: given a book, run the tier and produce an outcome. */
export type Tier = (book: ResolvableBook, ctx: ResolveContext) => Promise<TierOutcome>;

/**
 * Book fields the router needs to route (beyond what the derived rule reads).
 * `language_family` and `catalogue_density` drive whether Tier 1's "none"
 * answer is trustworthy or must escalate to Tier 2.
 */
export interface ResolvableBook extends FirstTranslationBook {
  _id?: unknown;
  id?: string;
  language?: string | null;
  /** Coarse family for routing: 'western' catalogs are reliable; others escalate. */
  language_family?: 'western' | 'cjk' | 'indic' | 'tibetan' | 'semitic' | 'other' | null;
  work_id?: string | null;
}

export interface ResolveContext {
  /** ISO timestamp stamped by the caller (Date.now() may be unavailable). */
  now: string;
  /**
   * Force escalation to Tier 2 even if an earlier tier was terminal — used by
   * the stratified sampler to ground-truth a random sample regardless of how
   * cheap tiers would have resolved it.
   */
  forceTier2?: boolean;
  /**
   * Durable evidence already on record for this book (loaded by the caller via
   * `loadPriorEvidence`), so the resolver doesn't re-pay for work a prior
   * approach already did (#2780). When it shows a trustworthy, URL-backed prior
   * (`recommendation === 'reuse_prior'`), the cascade short-circuits with a
   * not_first verdict and runs NO tiers. `forceTier2` overrides this (the
   * sampler still wants a fresh ground-truth pass).
   */
  priorEvidence?: PriorEvidenceSummary;
}

export interface Tiers {
  tier0: Tier;
  tier1: Tier;
  tier2?: Tier; // optional: omitted in cheap/automated runs (no paid agent)
}

export interface ResolveResult {
  resolved: FirstTranslation;
  attempts: FirstTranslationAttempt[];
}

/**
 * Run the effort cascade for one book.
 *
 * Stops at the first terminal tier (unless `forceTier2` is set and tier2 is
 * available). Accumulates an attempt from every tier it runs. The resolved
 * verdict points `best_attempt_id` at the strongest accumulated attempt.
 *
 * If no tier produces a verdict, resolves to `needs_review` so the book is
 * escalated rather than silently badged.
 */
export async function resolve(
  book: ResolvableBook,
  tiers: Tiers,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const attempts: FirstTranslationAttempt[] = [];
  let resolved: FirstTranslation | null = null;

  // Read-before-verify (#2780): if the accumulated evidence already holds a
  // trustworthy, URL-backed prior, reuse it — run NO tiers, spend nothing. The
  // sampler's forceTier2 still gets its fresh ground-truth pass.
  const pe = ctx.priorEvidence;
  if (pe?.recommendation === 'reuse_prior' && pe.foundPrior && !ctx.forceTier2) {
    return {
      resolved: {
        verdict: 'not_first',
        evidence_strength: 'strong',
        our_completeness: 'unknown',
        match_key: 'author_title',
        prior_relationship: 'same_text',
        resolver: 'tier0_linked',
        best_attempt_id: pe.foundAttemptId ?? undefined,
        resolved_at: ctx.now,
      },
      attempts: [],
    };
  }

  const cascade: Tier[] = [tiers.tier0, tiers.tier1];
  if (tiers.tier2) cascade.push(tiers.tier2);

  for (let i = 0; i < cascade.length; i++) {
    const isTier2 = tiers.tier2 != null && i === cascade.length - 1;
    const outcome = await cascade[i](book, ctx);
    attempts.push(outcome.attempt);
    if (outcome.verdict) resolved = outcome.verdict;

    // A terminal, decided tier stops the cascade — unless the sampler is
    // forcing a Tier-2 ground-truth pass and we haven't run it yet.
    if (outcome.terminal && outcome.verdict) {
      if (ctx.forceTier2 && tiers.tier2 && !isTier2) continue;
      break;
    }
  }

  if (!resolved) {
    resolved = {
      verdict: 'needs_review',
      evidence_strength: 'weak',
      our_completeness: 'unknown',
      match_key: 'none',
      resolver: 'tier1_catalog',
      resolved_at: ctx.now,
    };
  }

  const best = strongestAttempt(attempts);
  if (best) {
    resolved = { ...resolved, best_attempt_id: best.attempt_id, resolved_at: ctx.now };
  }

  return { resolved, attempts };
}
