/**
 * First-translation graded verdict model (issue #2564).
 *
 * Replaces the boolean `is_first_translation` and the loosely-typed
 * `translation_verification.disposition` with a graded verdict + a
 * prior-relationship qualifier + orthogonal qualifiers. The boolean flag
 * becomes a DERIVED, single-writer read of this model (see ./derive.ts).
 *
 * Layer ownership (per #2564 / #2453): this module owns the verdict/qualifier
 * TYPES and the derived rule. The `prior_translations` registry schema is
 * shared with #2453 — the registry-row shape here is the minimal contract the
 * derived rule needs, not the registry's authoritative definition.
 */

// ── A. Primary verdicts (mutually exclusive) ──────────────────────────────

/**
 * What the first-translation claim resolves to. Exactly one per book.
 *
 * - first_no_prior   No English translation of this text in any form.
 * - first_from_source English of the *work* exists from a *different* source
 *                    language, but not from THIS text (source-language rule).
 * - first_complete   Only partial/excerpt/anthology English exists → ours is
 *                    the first complete one. GATED on our item being complete.
 * - first_modern     Only antiquated (pre-~1900) English exists.
 * - not_first        A complete modern English translation of this text exists.
 * - not_applicable   Not a single translatable text (visual art, scripture MS,
 *                    English-source original, multi-work container).
 * - unverifiable     Competent tradition sources are catalog-blind here.
 *                    Excluded from the public headline count.
 * - needs_review     Conflicting/inconclusive evidence or unresolved identity.
 */
export type FirstTranslationVerdict =
  | 'first_no_prior'
  | 'first_from_source'
  | 'first_complete'
  | 'first_modern'
  | 'not_first'
  | 'not_applicable'
  | 'unverifiable'
  | 'needs_review';

/** The verdicts that, subject to the gates in derive.ts, badge as a "first". */
export const FIRST_FAMILY: ReadonlySet<FirstTranslationVerdict> = new Set([
  'first_no_prior',
  'first_from_source',
  'first_complete',
  'first_modern',
]);

// ── B. Prior-relationship qualifier ───────────────────────────────────────

/**
 * How a found candidate translation relates to OUR text. Set whenever a
 * candidate is found. Determines whether the candidate defeats "first".
 *
 *  same_text                 → not_first
 *  same_work_diff_edition    → not_first (recension / authorial revision)
 *  different_source_language → does NOT defeat (source-language rule)
 *  related_distinct_work     → does NOT defeat (parent/sibling/derivative)
 *  partial                   → supports first_complete
 *  adaptation                → usually does not defeat; flag for review
 */
export type PriorRelationship =
  | 'same_text'
  | 'same_work_diff_edition'
  | 'different_source_language'
  | 'related_distinct_work'
  | 'partial'
  | 'adaptation';

// ── C. Orthogonal qualifiers ──────────────────────────────────────────────

/**
 * How much trust the verdict's evidence carries.
 * - strong   prior positively found, OR absence confirmed in competent sources
 * - moderate well-searched absence, bounded ("couldn't scan dissertations")
 * - weak     absence from a blind catalog only — "effectively unsearched"
 *
 * weak-evidence first-claims are EXCLUDED from the public headline count.
 */
export type EvidenceStrength = 'strong' | 'moderate' | 'weak';

/** Completeness of OUR scanned item. Gates first_complete. */
export type OurCompleteness = 'complete' | 'partial' | 'unknown';

/** What the absence claim was matched on. Weights how much an absence is worth. */
export type MatchKey = 'work_id' | 'author_title' | 'transliteration' | 'none';

/** Which effort tier produced the resolved verdict. */
export type Resolver =
  | 'tier0_linked'
  | 'tier1_catalog'
  | 'tier2_agent'
  | 'human';

// ── The resolved verdict object stored on the book ────────────────────────

/** `book.first_translation` — the single resolved record per book. */
export interface FirstTranslation {
  verdict: FirstTranslationVerdict;
  evidence_strength: EvidenceStrength;
  our_completeness: OurCompleteness;
  match_key: MatchKey;
  /** Set when a candidate prior was found (§B value). */
  prior_relationship?: PriorRelationship;
  /** Registry ids of the priors this verdict rests on. */
  prior_refs?: string[];
  resolver: Resolver;
  /** attempt_id of the attempt that produced this verdict. */
  best_attempt_id?: string;
  resolved_at?: Date | string;
}

// ── Legacy disposition compatibility ──────────────────────────────────────

/** The legacy `translation_verification.disposition` enum (pre-#2564). */
export type LegacyDisposition =
  | 'confirmed_first'
  | 'first_from_source'
  | 'first_complete_translation'
  | 'first_modern_translation'
  | 'translation_found'
  | 'needs_review';

/** Legacy disposition → graded verdict. */
export const DISPOSITION_TO_VERDICT: Record<LegacyDisposition, FirstTranslationVerdict> = {
  confirmed_first: 'first_no_prior',
  first_from_source: 'first_from_source',
  first_complete_translation: 'first_complete',
  first_modern_translation: 'first_modern',
  translation_found: 'not_first',
  needs_review: 'needs_review',
};

/** Graded verdict → legacy disposition (for label/back-compat surfaces). */
export const VERDICT_TO_DISPOSITION: Partial<Record<FirstTranslationVerdict, LegacyDisposition>> = {
  first_no_prior: 'confirmed_first',
  first_from_source: 'first_from_source',
  first_complete: 'first_complete_translation',
  first_modern: 'first_modern_translation',
  not_first: 'translation_found',
  needs_review: 'needs_review',
  // not_applicable / unverifiable have no legacy equivalent — they were
  // previously mis-collapsed into confirmed_first and inflated the count.
};

// ── Minimal book shape the derived rule reads ─────────────────────────────

/**
 * The subset of a book document the derived rule depends on. Kept structural
 * so callers can pass a full Mongo doc without a cast.
 */
export interface FirstTranslationBook {
  first_translation?: FirstTranslation | null;
  translation_verification?: {
    disposition?: string;
    /**
     * The priors the disposition rests on. An empty/absent array under a
     * `translation_found` disposition means the verdict is unsupported — it is
     * NOT treated as a defeat (see the evidence gate in resolveFirstTranslation).
     */
    translations_found?: unknown[];
  } | null;
  visible?: boolean;
  pages_translated?: number | null;
  // Read by the coverage gate (#3435): a first-translation claim is
  // bibliographic, but the BADGE also implies a reader can read the English.
  // Denominator mirrors the canonical `translatedToEnglish` homepage stat —
  // pages_ocr minus blanks — with pages_count as the fallback.
  pages_ocr?: number | null;
  pages_blank?: number | null;
  pages_count?: number | null;
  // Read only by the evidence-quality guard (#2579) when validating a legacy
  // `translation_found` demotion against its cited priors.
  title?: string;
  author?: string;
  language?: string | null;
  original_language?: string | null;
}
