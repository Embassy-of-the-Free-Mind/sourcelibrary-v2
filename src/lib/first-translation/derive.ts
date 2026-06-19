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

  const verdict = DISPOSITION_TO_VERDICT[disposition];
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
 * The derived `is_first_translation` flag — the render gate for the badge.
 *
 * A book badges as a first when:
 *  - its verdict is in the first-family, AND
 *  - if first_complete, our scanned item is actually complete, AND
 *  - it is visible and has translated pages (readers can read it).
 *
 * This is the ONLY writer of `is_first_translation`. Reconcile jobs materialize
 * the boolean from this function; no script sets it directly.
 */
export function isFirstTranslation(book: FirstTranslationBook): boolean {
  const ft = resolveFirstTranslation(book);
  if (!ft || !FIRST_FAMILY.has(ft.verdict)) return false;
  // first_complete is only honest if OUR item is the complete one.
  if (ft.verdict === 'first_complete' && ft.our_completeness !== 'complete') {
    return false;
  }
  return !!book.visible && (book.pages_translated ?? 0) > 0;
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
