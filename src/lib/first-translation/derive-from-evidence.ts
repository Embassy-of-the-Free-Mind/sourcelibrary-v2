/**
 * Derive a graded verdict from the accumulated attempt ledger (issue #2564 / #2805).
 *
 * The attempt log (`first_translation_attempts`) is the durable, approach-agnostic
 * record of every search ever run for a book. This module turns that pile into a
 * single `book.first_translation` verdict — "verdict = f(accumulated evidence)".
 * It does NOT write the public `is_first_translation` boolean; that stays a
 * derived read materialized only by the sign-off-gated reconcile (derive.ts).
 *
 * Pure over an injected attempts array + the book (the book is needed to run the
 * evidence-quality guard on cited priors), so it is unit-testable without a DB.
 *
 * HARDENED against the real, legacy-backfilled ledger (a spot-check found two
 * failure modes the naive mapping produced):
 *
 *  1. Studies miscounted as translations → FALSE DEMOTES. The legacy backfill
 *     recorded scholarly studies that merely CITE a work (e.g. Needham's
 *     *Science and Civilisation in China* for 武備志) as "found" priors, with a
 *     URL. A bare URL proves a URL exists, not that a *translation* exists. So a
 *     found prior now defeats a first ONLY when it is a TRUSTWORTHY sighting:
 *     non-weak evidence AND (a registry `found_refs` id OR a prior that passes
 *     `evaluatePrior`). All the legacy study/guess rows are `weak` → excluded.
 *
 *  2. `not_applicable` collapsed into absence → FALSE PROMOTES. An agent judging
 *     a book "not an English-translation candidate" was stored as `result:none`
 *     and counted as an absence vote. It is now detected (result, legacy
 *     "not_applicable: …" notes, or the backfill's mid-notes
 *     "status=not_applicable" / "disposition=not_applicable" form) and either
 *     yields a `not_applicable` verdict (from an independent agent/human) or is
 *     excluded from the absence count.
 *
 *  3. Undocumented "none" counted as an absence vote → FALSE PROMOTES. Legacy
 *     rows with `result:none` but NO recorded sources_checked/queries are a
 *     stored opinion, not a search; counting them let two miscoded legacy rows
 *     fake cross-family independence and promote English originals (found in
 *     the 2026-07-02 reconcile dry-run). Absence votes now require recorded
 *     search coverage.
 *
 * The asymmetry is enforced: a DEMOTE needs a trustworthy positive sighting; a
 * PROMOTE needs clean, independent absence with NO prior hint at all. Anything
 * ambiguous (a weak/unconfirmable "found" hint) returns null — change nothing,
 * defer to the existing/legacy state — rather than guess in either direction.
 */

import { attemptFamily } from './prior-evidence';
import {
  strongestAttempt,
  type FirstTranslationAttempt,
} from './attempt-log';
import { evaluatePrior, type BookInput, type CitedPriorInput } from '../ft-prior-guard';
import type {
  FirstTranslation,
  FirstTranslationBook,
  MatchKey,
  Resolver,
} from './types';

/** Map an attempt's method to the resolver tier that should own the verdict. */
function methodToResolver(method: FirstTranslationAttempt['method']): Resolver {
  switch (method) {
    case 'tier2_agent': return 'tier2_agent';
    case 'human': return 'human';
    case 'tier0_linked': return 'tier0_linked';
    // tier1_catalog and gemini_verifier are both catalog-grounded searches.
    default: return 'tier1_catalog';
  }
}

const MATCH_RANK: Record<MatchKey, number> = { work_id: 3, transliteration: 2, author_title: 1, none: 0 };

function bestMatchKey(attempts: FirstTranslationAttempt[]): MatchKey {
  let best: MatchKey = 'none';
  for (const a of attempts) if (MATCH_RANK[a.match_key] > MATCH_RANK[best]) best = a.match_key;
  return best;
}

function bookInput(book: FirstTranslationBook): BookInput {
  return {
    title: book.title ?? '',
    author: book.author,
    language: book.original_language ?? book.language ?? undefined,
  };
}

function toCited(p: NonNullable<FirstTranslationAttempt['priors']>[number]): CitedPriorInput {
  const c = p.completeness;
  const completeness =
    c === 'complete' || c === 'partial' || c === 'excerpts' || c === 'unknown' ? c : undefined;
  return {
    english_title: p.english_title,
    translator: p.translator,
    pub_year: p.pub_year,
    completeness,
    publisher: p.publisher,
  };
}

const NOT_APPLICABLE_RE = /^\s*not[_ ]applicable\b/i;
// Legacy backfills embed the judgment mid-notes ("[legacy_ai] status=not_applicable; …"),
// which the anchored form misses — so an "original English work, FT does not apply"
// row counted as an absence vote and promoted English originals to first_no_prior
// (the Book of Kells / Religio Medici class in the 2026-07-02 reconcile dry-run).
const LEGACY_NA_RE = /\b(?:status|disposition|result)=not[_ ]applicable\b/i;
function isNotApplicable(a: FirstTranslationAttempt): boolean {
  return (
    a.result === 'not_applicable'
    || NOT_APPLICABLE_RE.test(a.notes ?? '')
    || LEGACY_NA_RE.test(a.notes ?? '')
  );
}

/**
 * An absence vote is only evidence when the attempt documents what it searched.
 * A negative claim is exactly as strong as its recorded coverage (the module's
 * first principle) — a legacy row with no sources and no queries is a stored
 * opinion, not a search, and must not count toward first_no_prior independence.
 */
function hasSearchCoverage(a: FirstTranslationAttempt): boolean {
  return (a.sources_checked?.length ?? 0) > 0 || (a.queries?.length ?? 0) > 0;
}

/**
 * A found prior counts as a real defeat only when it is a TRUSTWORTHY sighting:
 * non-weak evidence AND (a concrete registry id OR a prior that survives the
 * evidence-quality guard). This is what excludes the legacy study/guess rows.
 */
function isTrustworthyFound(a: FirstTranslationAttempt, bi: BookInput): boolean {
  if (a.result !== 'found') return false;
  if (a.evidence_strength === 'weak') return false;
  if (a.found_refs && a.found_refs.length > 0) return true;
  return (a.priors ?? []).some((p) => evaluatePrior(bi, toCited(p)).trustworthy);
}

/**
 * Resolve the accumulated attempts for ONE book into a graded verdict, or null
 * when the pile doesn't justify any verdict (ambiguous → defer, change nothing).
 * Pure — no DB, no clock.
 */
export function deriveVerdictFromAttempts(
  attempts: FirstTranslationAttempt[],
  book: FirstTranslationBook,
): FirstTranslation | null {
  if (attempts.length === 0) return null;
  const bi = bookInput(book);

  // 1) A trustworthy prior sighting → not_first. The ONLY thing that demotes.
  const trustFound = attempts.filter((a) => isTrustworthyFound(a, bi));
  if (trustFound.length > 0) {
    const families = new Set(trustFound.map(attemptFamily)).size;
    const strongest = strongestAttempt(trustFound)!;
    return {
      verdict: 'not_first',
      evidence_strength: families >= 2 ? 'strong' : 'moderate',
      our_completeness: 'unknown',
      match_key: bestMatchKey(trustFound),
      prior_relationship: 'same_text',
      prior_refs: strongest.found_refs?.length ? strongest.found_refs : undefined,
      resolver: methodToResolver(strongest.method),
      best_attempt_id: strongest.attempt_id,
    };
  }

  // 2) An independent agent/human judged it not a candidate → not_applicable.
  const naHi = attempts.find(
    (a) => isNotApplicable(a) && (attemptFamily(a) === 'agent' || attemptFamily(a) === 'human'),
  );
  if (naHi) {
    return {
      verdict: 'not_applicable',
      evidence_strength: 'moderate',
      our_completeness: 'unknown',
      match_key: 'none',
      resolver: methodToResolver(naHi.method),
      best_attempt_id: naHi.attempt_id,
    };
  }

  // 3) Any UNconfirmable "found" hint (weak/guard-failing) makes a "first" claim
  //    unsafe — we can't demote (not trustworthy) but mustn't promote over a
  //    possible prior either. Defer: change nothing.
  if (attempts.some((a) => a.result === 'found')) return null;

  // 4) Clean absence only. Count independent FAMILIES (not raw methods);
  //    exclude not_applicable rows (not absence votes) and rows with no recorded
  //    search coverage (an undocumented "none" is not evidence of absence).
  const absences = attempts.filter(
    (a) => a.result === 'none' && !isNotApplicable(a) && hasSearchCoverage(a),
  );
  if (absences.length === 0) return null;
  const families = new Set(absences.map(attemptFamily)).size;
  const strongest = strongestAttempt(absences)!;
  const ownerMethod =
    absences.find((a) => attemptFamily(a) === 'agent')?.method ??
    absences.find((a) => attemptFamily(a) === 'human')?.method ??
    strongest.method;
  return {
    verdict: 'first_no_prior',
    // Independence by family. Never 'strong' from absence here.
    evidence_strength: families >= 2 ? 'moderate' : 'weak',
    our_completeness: 'unknown',
    match_key: bestMatchKey(absences),
    resolver: methodToResolver(ownerMethod),
    best_attempt_id: strongest.attempt_id,
  };
}
