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
  /** attempt_id behind the reusable prior, for best_attempt_id on a reuse verdict. */
  foundAttemptId: string | null;
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
   * Distinct evidence FAMILIES that independently returned "none" (see
   * {@link attemptFamily}). This is the honest independence signal — it collapses
   * correlated same-model-family checks to one vote. Use THIS (not
   * independentAbsenceMethods) to weight an absence claim's strength.
   */
  independentAbsenceFamilies: number;
  /** Distinct families that returned "found" — cross-family agreement on a prior. */
  foundFamilies: number;
  /**
   * What a new approach should do given the pile:
   *  - 'reuse_prior'      a trustworthy prior already exists → don't re-search; demote.
   *  - 'absence_strong'   ≥2 independent approaches found nothing → a fresh pass adds little.
   *  - 'absence_weak'     some absence evidence, but not yet independent/bounded.
   *  - 'unverified'       nothing on record → full verification warranted.
   */
  recommendation: 'reuse_prior' | 'absence_strong' | 'absence_weak' | 'unverified';
}

/**
 * Evidence *family* — for cross-family independence (#2805). Independence must be
 * by family, NOT raw `method`: `method='gemini_verifier'` is overloaded (it tags
 * the real grounded adjudicator AND every backfilled legacy store), and two
 * outputs of the same model family are correlated, not independent votes.
 *
 *  - 'model_knowledge'  unverified model belief: ai_metadata (legacy_ai),
 *                       llm guesses (legacy_llm), Gemini classification (legacy_tc).
 *                       All Gemini-family → ONE vote however many tags.
 *  - 'catalog'          catalog/registry lookup: translation_verification tool
 *                       sweep (legacy_tv), ft_reverify_proposal catalog_counts
 *                       (legacy_rp — queries the SAME OL/GB/IA catalogs, so it is
 *                       correlated WITH this family, not its own), the real
 *                       grounded gemini adjudicator (gemini_verifier w/ queries[]),
 *                       and the deterministic translation_catalogs matchers
 *                       (tier0_linked, tier1_catalog, constituent_catalog_match —
 *                       all reading the same registry, so one correlated vote).
 *  - 'agent'            independent cross-model agent (Claude Tier-2 = tier2_agent).
 *  - 'human'            human specialist.
 *  - 'unknown'          unclassifiable.
 */
export type AttemptFamily = 'model_knowledge' | 'catalog' | 'agent' | 'human' | 'unknown';

export function attemptFamily(a: FirstTranslationAttempt): AttemptFamily {
  if (a.method === 'tier2_agent' || a.method === 'claude_subagent_verify') return 'agent';
  if (a.method === 'human') return 'human';
  // Gemini prior-adjudicator reasons over cited priors from model knowledge.
  if (a.method === 'llm_prior_adjudicate') return 'model_knowledge';
  // Google-Search-grounded Gemini enumeration — catalog-grounded, same model
  // family as the grounded gemini_verifier (correlated, NOT independent of it).
  if (a.method === 'gemini_grounded_search') return 'catalog';
  const notes = a.notes ?? '';
  if (/^\[legacy_(ai|llm|tc)\]/.test(notes)) return 'model_knowledge';
  if (/^\[legacy_(tv|rp)\]/.test(notes)) return 'catalog';
  if (a.method === 'gemini_verifier') {
    // Real grounded adjudicator (has queries) → catalog; bare/legacy → model_knowledge.
    return (a.queries?.length ?? 0) > 0 ? 'catalog' : 'model_knowledge';
  }
  if (
    a.method === 'tier0_linked'
    || a.method === 'tier1_catalog'
    || a.method === 'constituent_catalog_match' // deterministic registry match, constituent-scoped (#3785)
  ) return 'catalog';
  return 'unknown';
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
  // The honest version: distinct FAMILIES (correlated same-model checks collapse).
  const independentAbsenceFamilies = new Set(
    attempts.filter((a) => a.result === 'none').map((a) => attemptFamily(a)),
  ).size;
  const foundFamilies = new Set(
    attempts.filter((a) => a.result === 'found').map((a) => attemptFamily(a)),
  ).size;

  // Gate on FAMILIES, not raw methods (#3785 drift 7): two same-family "none"s
  // (e.g. gemini_verifier + gemini_grounded_search, both 'catalog') are one
  // correlated vote, not independent absence.
  let recommendation: PriorEvidenceSummary['recommendation'];
  if (priorFound) recommendation = 'reuse_prior';
  else if (independentAbsenceFamilies >= 2) recommendation = 'absence_strong';
  else if (independentAbsenceFamilies >= 1) recommendation = 'absence_weak';
  else recommendation = 'unverified';

  return {
    attemptCount: attempts.length,
    priorFound,
    foundPrior,
    foundAttemptId: priorFound ? (strongestFound?.attempt_id ?? null) : null,
    independentAbsenceFamilies,
    foundFamilies,
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
