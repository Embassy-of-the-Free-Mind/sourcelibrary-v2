/**
 * Tier plumbing types for first-translation resolution.
 *
 * Extracted from the deleted `resolve.ts` (#3881 passes 3–6, #4536): the
 * effort-cascade router itself was never wired into production (the live
 * escalation path is scripts/eval/ft-ladder.ts), but these types are the
 * shared contract between the Tier-0 catalog matcher and the scripts that
 * drive it.
 */

import type { FirstTranslation, FirstTranslationBook } from './types';
import type { FirstTranslationAttempt } from './attempt-log';
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
 * Book fields a tier needs to route (beyond what the derived rule reads).
 * `language_family` drives whether a catalog "none" answer is trustworthy.
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
  /** Force escalation to Tier 2 even when an earlier tier was terminal. */
  forceTier2?: boolean;
  /**
   * Durable evidence already on record for this book, so a tier doesn't
   * re-pay for work a prior approach already did (#2780).
   */
  priorEvidence?: PriorEvidenceSummary;
}
