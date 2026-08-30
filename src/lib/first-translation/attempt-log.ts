/**
 * Append-only provenance log for first-translation resolution (issue #2564).
 *
 * Every tier (registry lookup, catalog sweep, per-book agent, human) appends
 * ONE attempt per run. The log is the *evidence of absence*: a "first" claim is
 * only as strong as the best documented attempt behind it. Absence accumulates
 * monotonically and auditably — the systematic-review model.
 *
 * Collection: `first_translation_attempts` (NEVER updated in place, only
 * inserted). The book's resolved `first_translation.best_attempt_id` points at
 * the strongest attempt; the rest remain as history.
 */

import type { Db } from 'mongodb';
import type {
  EvidenceStrength,
  MatchKey,
  Resolver,
} from './types';

export const ATTEMPTS_COLLECTION = 'first_translation_attempts';

/**
 * How an attempt was carried out. Superset of {@link Resolver} (adds the live
 * instruments). `constituent_catalog_match` is the deterministic
 * translation_catalogs match run against a CONTAINER's constituent sub-works
 * (scripts/eval/ft-constituent-catalog-match.mjs, #2916) — same Tier-0
 * mechanism as `tier0_linked`, but the evidence is scoped to one constituent
 * (see {@link FirstTranslationAttempt.constituent}), not the whole book.
 */
export type AttemptMethod =
  | Resolver
  | 'gemini_verifier'
  | 'gemini_grounded_search'
  | 'claude_subagent_verify'
  | 'llm_prior_adjudicate'
  | 'constituent_catalog_match';

/**
 * A prior English translation found during an attempt, kept STRUCTURED (not just
 * a notes string) so per-book consumers — the badge evidence panel, the
 * "Existing translations" surface, work-cluster linking — can render it without
 * re-parsing. `found_refs` (registry ids) supersedes this once #2453 exists; until
 * then this is the queryable record of what was found.
 */
export interface PriorTranslation {
  english_title?: string;
  translator?: string;
  pub_year?: string;
  publisher?: string;
  completeness?: string;
  /** The grounding link to where the prior actually is (archive.org / publisher / WorldCat). */
  source_url?: string;
}

/** One row in the append-only provenance log. */
export interface FirstTranslationAttempt {
  /** Stable id for this attempt; referenced by book.first_translation.best_attempt_id. */
  attempt_id: string;
  book_id: string;
  work_id?: string | null;
  /** ISO timestamp. Caller supplies it (Date.now() is unavailable in some runtimes). */
  date: string;
  method: AttemptMethod;
  match_key: MatchKey;
  /** Which catalogs/sources were consulted (e.g. ['translation_catalogs','open_library']). */
  sources_checked: string[];
  /** The actual queries issued, for auditability. */
  queries?: string[];
  /**
   * Did this attempt find a prior translation, confirm absence, or judge the
   * book not an English-translation candidate at all? `not_applicable` (an agent
   * deciding it's an original-language edition / container / translation into
   * another language) is NOT an absence vote — it must not be counted toward a
   * "first" claim. (Legacy rows encoded it in `notes` as "not_applicable: …".)
   */
  result: 'found' | 'none' | 'not_applicable';
  /** Registry ids of priors found (empty when result==='none'). */
  found_refs?: string[];
  /**
   * Set only by constituent-scoped attempts (method
   * 'constituent_catalog_match'): WHICH sub-work of the container this evidence
   * is about. A constituent-level `found` means that sub-work is not a first —
   * it must never be read as "the whole container has a prior."
   */
  constituent?: { index: number; title: string };
  /** Structured priors found this attempt (translator/year/title/link). */
  priors?: PriorTranslation[];
  evidence_strength: EvidenceStrength;
  /**
   * 0..1 — how independent the consulted sources are from each other and from
   * prior attempts. Three correlated grounding misses ≈ one independent miss.
   */
  independence_score?: number;
  model?: string;
  cost_usd?: number;
  notes?: string;
  /**
   * Version tag of the prompt that produced this attempt (e.g.
   * 'ft-ladder-skeptic/v1-2026-08-08'). Required on every automated
   * instrument's rows (#3778): without it a search result cannot be reproduced
   * or superseded when the prompt changes — the July replicability gap.
   */
  prompt_version?: string;
  /**
   * Pointer into `first_translation_transcripts` (the attempt_id doubles as the
   * key) when the full prompt + raw response + grounding metadata were
   * persisted separately. The ledger row stays lean; the transcript endures.
   */
  transcript_ref?: string;
  /**
   * The verifier's raw result string, preserved by the ingest
   * (ingest-ft-verify-results.mjs) alongside the coarse `result`. For a
   * demote-direction Tier-2 check, `'not_found'` means the agent went looking
   * for the SPECIFIC cited prior and could not confirm it exists — a targeted
   * refutation, stronger than a generic absence sweep (which can simply miss a
   * real prior — the Bacon/Davis case).
   */
  verdict?: string;
}

/**
 * Append an attempt to the provenance log. Pure insert — never updates.
 * Returns the inserted attempt (with attempt_id) for the caller to reference.
 */
export async function appendAttempt(
  db: Db,
  attempt: FirstTranslationAttempt,
): Promise<FirstTranslationAttempt> {
  await db.collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION).insertOne({
    ...attempt,
  });
  return attempt;
}

/**
 * Deterministically derive an attempt_id from book + method + date.
 * Avoids Math.random()/Date.now() (unavailable in workflow runtimes) by
 * requiring the caller to pass the timestamp it already stamped.
 */
export function makeAttemptId(
  bookId: string,
  method: AttemptMethod,
  isoDate: string,
): string {
  return `${bookId}:${method}:${isoDate}`;
}

/** All attempts for a book, newest first. */
export async function getAttempts(
  db: Db,
  bookId: string,
): Promise<FirstTranslationAttempt[]> {
  return db
    .collection<FirstTranslationAttempt>(ATTEMPTS_COLLECTION)
    .find({ book_id: bookId })
    .sort({ date: -1 })
    .toArray();
}

/**
 * Pick the strongest attempt from a set: prefer a positive `found` (presence is
 * stronger evidence than absence), then evidence_strength, then a better
 * match_key, then independence. Returns null for an empty set.
 */
const STRENGTH_RANK: Record<EvidenceStrength, number> = { strong: 2, moderate: 1, weak: 0 };
const MATCH_RANK: Record<MatchKey, number> = { work_id: 3, transliteration: 2, author_title: 1, none: 0 };

export function strongestAttempt(
  attempts: FirstTranslationAttempt[],
): FirstTranslationAttempt | null {
  if (attempts.length === 0) return null;
  return [...attempts].sort((a, b) => {
    // A positive hit is the most decisive evidence.
    if ((a.result === 'found') !== (b.result === 'found')) {
      return a.result === 'found' ? -1 : 1;
    }
    const s = STRENGTH_RANK[b.evidence_strength] - STRENGTH_RANK[a.evidence_strength];
    if (s !== 0) return s;
    const m = MATCH_RANK[b.match_key] - MATCH_RANK[a.match_key];
    if (m !== 0) return m;
    return (b.independence_score ?? 0) - (a.independence_score ?? 0);
  })[0];
}
