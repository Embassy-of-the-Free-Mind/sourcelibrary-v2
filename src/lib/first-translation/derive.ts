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
import { evaluatePrior, type CitedPriorInput } from '../ft-prior-guard';

/**
 * Map a legacy `translations_found[]` entry (untyped Mongo shape) to the
 * guard's {@link CitedPriorInput}. Field names mirror what the badge panel's
 * normalizePriors reads, so the guard sees the same prior the reader does.
 */
function toCitedPrior(p: unknown): CitedPriorInput {
  const o = (p ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const completeness = str(o.completeness);
  return {
    english_title: str(o.english_title) ?? str(o.title),
    translator: str(o.translator),
    pub_year: str(o.pub_year) ?? str(o.year),
    completeness:
      completeness === 'complete' ||
      completeness === 'partial' ||
      completeness === 'excerpts' ||
      completeness === 'unknown'
        ? completeness
        : undefined,
    publisher: str(o.publisher),
    series: str(o.series),
    notes: str(o.notes),
  };
}

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
      // No cited prior at all — an evidence-free defeat. Escalate, don't demote.
      verdict = 'needs_review';
    } else {
      // A cited prior only defeats a first if it is a TRUSTWORTHY sighting.
      // The #2564 Arithmologia demotion trusted a prior that was actually
      // Godwin's *anthology* — a real citation to the wrong kind of source. Run
      // the evidence-quality guard (#2579): if NO cited prior survives it, the
      // demotion isn't justified → needs_review (a Tier-2 re-verification, not
      // a restored first).
      const bookInput = {
        title: book.title ?? '',
        author: book.author,
        language: book.original_language ?? book.language ?? undefined,
      };
      const anyTrustworthy = priors.some(
        (p) => evaluatePrior(bookInput, toCitedPrior(p)).trustworthy,
      );
      if (!anyTrustworthy) verdict = 'needs_review';
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
 * The share of a book's readable pages that carry an English translation.
 *
 * Denominator is the canonical "readable" definition already used by
 * `system_config.homepage_stats.translatedToEnglish` — `pages_ocr` minus
 * blanks — because a page with no OCR was never a page anyone could translate.
 * Falls back to `pages_count` when OCR counts are absent.
 *
 * Returns `null` when no denominator can be established. Callers must treat
 * null as "unknown", never as zero: a book with missing page counts has not
 * been shown to be thin, and demoting on absent data is the #17 hazard in
 * miniature.
 */
export interface TranslationCoverageBook {
  pages_translated?: number | null;
  pages_ocr?: number | null;
  pages_blank?: number | null;
  pages_count?: number | null;
}

export function translationCoverage(book: TranslationCoverageBook): number | null {
  const translated = book.pages_translated ?? 0;
  const ocr = book.pages_ocr ?? 0;
  const blank = book.pages_blank ?? 0;
  const readable = ocr - blank;
  const denominator = readable > 0 ? readable : (book.pages_count ?? 0);
  if (denominator <= 0) return null;
  // Translated can exceed the denominator on odd page inventories; clamp so a
  // ratio is always interpretable as a share.
  return Math.min(translated / denominator, 1);
}

/**
 * The coverage floor at which "First Translation" describes something a reader
 * can actually read. Same 90% the homepage's `translatedToEnglish` stat uses —
 * this is deliberately NOT a new threshold (see the collection-spec rule: no
 * new primitives where an existing one answers the question).
 */
export const FIRST_TRANSLATION_READABLE_MIN = 0.9;

/**
 * Is enough of this book translated for the badge to mean what it says?
 *
 * Unknown coverage returns `true` — the badge's existing `pages_translated > 0`
 * gate still applies upstream, and we do not withdraw a claim because page
 * counts are missing.
 */
export function isTranslationReadable(book: TranslationCoverageBook): boolean {
  const coverage = translationCoverage(book);
  if (coverage === null) return true;
  return coverage >= FIRST_TRANSLATION_READABLE_MIN;
}

/**
 * Whether this book counts toward the PUBLIC "N first translations" headline.
 *
 * Stricter than {@link isFirstTranslation} in two ways: a claim only counts if
 * it badges, its evidence is not weak, AND enough of it is actually translated
 * to read. This carves out:
 *   - weak-evidence claims (catalog-blind absence — "effectively unsearched"),
 *   - the legacy disposition shim (always weak until re-resolved by a real
 *     tier), which is most of today's non-Western confirmed_first pool,
 *   - barely-translated books (#3435): 244 badged books are under 10%
 *     translated, so counting them asserts a readable English edition that
 *     does not exist yet. The bibliographic claim survives; only the headline
 *     and the unqualified badge label are withheld.
 *
 * Use this — not isFirstTranslation — for the headline count and the
 * "N ± M" estimate. `unverifiable` is not in the first-family so it is already
 * excluded; this also drops weak first-family claims.
 */
export function isPublicFirst(book: FirstTranslationBook): boolean {
  if (!isFirstTranslation(book)) return false;
  if (!isTranslationReadable(book)) return false;
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
