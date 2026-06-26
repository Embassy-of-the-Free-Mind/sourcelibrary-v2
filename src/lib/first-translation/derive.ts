/**
 * Derived single-writer rule for `is_first_translation` (issue #2564).
 *
 * `is_first_translation` MUST NOT be written by ~37 competing scripts anymore.
 * It is a DERIVED read of `book.first_translation` (the graded verdict), with
 * a back-compat fallback to the legacy `translation_verification.disposition`
 * so the read path keeps working while data migrates.
 *
 * Two questions, two functions:
 *   isFirstTranslation(book) — does this book badge as a "first"? (render gate)
 *   isPublicFirst(book)      — does it count toward the public headline? (count)
 *
 * The public count is STRICTER: it excludes weak-evidence and unverifiable
 * claims (the ~1,666 non-Western "couldn't actually check" defaults), so the
 * headline number is defensible rather than inflated.
 */

import {
  FIRST_FAMILY,
  DISPOSITION_TO_VERDICT,
  type FirstTranslation,
  type FirstTranslationBook,
  type FirstTranslationVerdict,
  type LegacyDisposition,
} from './types';

/**
 * Normalize a book to a graded {@link FirstTranslation} record.
 *
 * Precedence:
 *  1. `book.first_translation` (the new authoritative object) when present.
 *  2. A shim derived from the legacy `translation_verification.disposition`,
 *     so books not yet migrated still resolve. The shim fills the orthogonal
 *     qualifiers with the semantics the legacy disposition already implied:
 *       - first_complete_translation meant "ours IS the first complete" →
 *         our_completeness:'complete' (passes the gate).
 *       - legacy claims carry evidence_strength:'weak' (they were produced by
 *         the catalog cron / content-enrichment, never the rigorous agent), so
 *         they badge but are EXCLUDED from the public count until re-resolved.
 *
 * Returns null when neither a verdict nor a recognized disposition is present.
 */
export function resolveFirstTranslation(
  book: FirstTranslationBook,
): FirstTranslation | null {
  if (book.first_translation && book.first_translation.verdict) {
    return book.first_translation;
  }

  const disposition = book.translation_verification?.disposition as
    | LegacyDisposition
    | undefined;
  if (!disposition || !(disposition in DISPOSITION_TO_VERDICT)) return null;

  let verdict = DISPOSITION_TO_VERDICT[disposition];

  // EVIDENCE GATE (spot-check 2026-06-19): a `translation_found` disposition is
  // only trustworthy if it actually recorded the prior it claims to have found.
  // The catalog cron set ~42% of `translation_found` with an EMPTY
  // translations_found (e.g. Olivier de Serres' Théâtre d'Agriculture — a
  // work-identity false match), which wrongly demotes genuine firsts. An
  // evidence-free `translation_found` is NOT a defeat — escalate to needs_review.
  if (verdict === 'not_first') {
    const priors = book.translation_verification?.translations_found;
    if (!Array.isArray(priors) || priors.length === 0) {
      verdict = 'needs_review';
    }
  }

  return {
    verdict,
    // Legacy claims were never produced by the rigorous engine → weak.
    evidence_strength: 'weak',
    // first_complete_translation implied our item was the complete one.
    our_completeness: verdict === 'first_complete' ? 'complete' : 'unknown',
    match_key: 'none',
    resolver: 'tier1_catalog',
  };
}

/** The graded verdict for a book, or null if unresolved. */
export function firstTranslationVerdict(
  book: FirstTranslationBook,
): FirstTranslationVerdict | null {
  return resolveFirstTranslation(book)?.verdict ?? null;
}

/**
 * The bibliographic first-translation claim, WITHOUT render gates.
 *
 * True when the verdict is in the first-family and the first_complete gate is
 * satisfied. This is what the stored `is_first_translation` boolean should
 * equal — the claim is set on hidden/untranslated books too (raw 6,908 vs
 * public 5,732), so it must NOT depend on visibility or translated pages.
 *
 * This is the ONLY writer of `is_first_translation`. The reconcile job
 * materializes the boolean from this function; no script sets it directly.
 */
export function isFirstByVerdict(book: FirstTranslationBook): boolean {
  const ft = resolveFirstTranslation(book);
  if (!ft || !FIRST_FAMILY.has(ft.verdict)) return false;
  // first_complete is only honest if OUR item is the complete one.
  if (ft.verdict === 'first_complete' && ft.our_completeness !== 'complete') {
    return false;
  }
  return true;
}

/**
 * The render gate for the public "First Translation" badge.
 *
 * The bibliographic claim ({@link isFirstByVerdict}) AND the book is visible
 * and has translated pages (readers can actually read it).
 */
export function isFirstTranslation(book: FirstTranslationBook): boolean {
  return isFirstByVerdict(book) && !!book.visible && (book.pages_translated ?? 0) > 0;
}

/**
 * Whether this book counts toward the PUBLIC "N first translations" headline.
 *
 * Stricter than {@link isFirstTranslation}: a claim only counts if it badges
 * AND its evidence is not weak. This carves out:
 *   - weak-evidence claims (catalog-blind absence — "effectively unsearched"),
 *   - the legacy disposition shim (always weak until re-resolved by a real
 *     tier), which is most of today's non-Western confirmed_first pool.
 *
 * Use this — not isFirstTranslation — for the headline count and the
 * "N ± M" estimate. `unverifiable` is not in the first-family so it is already
 * excluded; this also drops weak first-family claims.
 */
export function isPublicFirst(book: FirstTranslationBook): boolean {
  if (!isFirstTranslation(book)) return false;
  const ft = resolveFirstTranslation(book)!;
  return ft.evidence_strength !== 'weak';
}

/**
 * Bidirectional data-hygiene gate for the reconcile WRITE path (issue #2564,
 * Derek's 323-contradiction finding: `disposition` is itself ~53% wrong, so
 * promoting a currently-unbadged book purely from a stale `confirmed_first`
 * shim would inject ~170 false positives while fixing ~150 false negatives).
 *
 * A PROMOTION (flag false→true) must rest on real evidence, not the legacy
 * disposition shim. We allow it only when the verdict is first-family AND it
 * was produced by a real adjudicator (tier1/tier2/human) with non-weak
 * evidence — i.e. NOT the weak `tier1_catalog` legacy shim that
 * resolveFirstTranslation synthesizes from a bare disposition.
 *
 * Demotions are not gated here — removing an unsupported badge is always safe
 * (the evidence gate in resolveFirstTranslation already routes evidence-free
 * `translation_found` to needs_review).
 */
export function canPromoteToFirst(book: FirstTranslationBook): boolean {
  if (!isFirstByVerdict(book)) return false;
  // Must be a real, stored verdict object — not the legacy-disposition shim.
  const stored = book.first_translation;
  if (!stored || !stored.verdict) return false;
  if (stored.evidence_strength === 'weak') return false;
  // A first_no_prior is an absence claim; require it came from an adjudicator
  // that actually searched (tier1 catalog sweep, tier2 agent, or human),
  // never a bare materialization.
  return stored.resolver === 'tier1_catalog'
    || stored.resolver === 'tier2_agent'
    || stored.resolver === 'human';
}
