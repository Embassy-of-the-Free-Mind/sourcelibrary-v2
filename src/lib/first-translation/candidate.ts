/**
 * The CANDIDATE state — defaulting the claim, and letting evidence defeat it.
 *
 * WHY THE DEFAULT FLIPS
 * ---------------------
 * "First English translation" is an unprovable universal negative: a catalogue
 * can only ever return *nothing found*. Our catalogue's recall is **27%** — three
 * of every four known prior English translations are invisible to it — so a
 * `none_found` can never be strong enough to assert the negative outright.
 *
 * The instrument is, however, precise in the OTHER direction. A prior that IS
 * found is a positive, checkable fact (32/32 live identity confirmations; zero
 * contradictions across 399 independently-classified `never_translated` books).
 *
 * So build on what the instrument is good at: **every non-English book is a
 * candidate until a prior is linked.** Two properties follow, and both are the
 * point:
 *
 *  - It is HONEST at any recall. "No prior translation found, here is the search"
 *    is a claim about a bounded, dated act we actually performed. "This is the
 *    first" is a claim about the world that no search can support.
 *  - It is MONOTONE. Adding a source (ESTC, 84000, CBETA) can only ever move
 *    books from candidate to defeated — never the reverse. The corpus corrects
 *    itself as evidence grows, instead of wrong badges sitting wrong forever
 *    until someone re-verifies each by hand.
 *
 * WHAT THIS FILE IS NOT
 * ---------------------
 * It does not write anything, it does not touch `is_first_translation`, and it
 * renders nothing. It is a pure read over fields other passes already computed.
 * The reconcile stays the single writer of the flag (#2564), and badge copy is a
 * separate decision from badge state.
 */

import { isFirstTranslation, resolveFirstTranslation } from './derive';
import type { FirstTranslationBook } from './types';

/**
 * What we can honestly say about this book's first-translation status.
 *
 * Ordered from strongest claim to no claim. `candidate` is the DEFAULT for the
 * eligible pool, not an unusual state — measured 2026-08-03, 16,268 of 17,071
 * eligible books sit here.
 */
export type FirstTranslationClaim =
  /** A verified first. Earned by evidence, never defaulted into. */
  | 'confirmed'
  /** Non-English, no prior found, screens clear. The honest default. */
  | 'candidate'
  /** A prior English translation was found and linked. */
  | 'defeated'
  /** The question does not apply: the pages are already English, or this book IS a published translation. */
  | 'not_applicable'
  /** We could not ask. Distinct from "we asked and found nothing" — see below. */
  | 'unknown';

export interface FirstTranslationClaimResult {
  claim: FirstTranslationClaim;
  /** Machine-readable reason, for both UI copy and debugging a surprising claim. */
  reason:
    | 'verified_first'
    | 'no_prior_found'
    | 'prior_found'
    | 'source_already_english'
    | 'book_is_a_translation'
    | 'catalogued_english'
    | 'source_language_unscreened';
  /**
   * True when a screen could not run (no OCR, or too little legible text), so
   * the claim rests on an UNRUN check rather than a passed one. A caller that
   * renders a candidate must be able to say so.
   *
   * Deliberately not folded into `claim`: a book with no OCR is still a
   * candidate, it is simply a less-checked one. Collapsing the two would either
   * hide the gap or drop 449 books for a reason that is about us, not them.
   */
  screensIncomplete: boolean;
  /** Set when a screen wants a human before this claim is published. */
  needsReview: boolean;
}

/** Fields written by the two screening sweeps (#3524). */
export interface ScreenedBook extends FirstTranslationBook {
  source_language_screen?: {
    verdict?: 'english_source' | 'foreign_source' | 'undetermined' | 'no_ocr';
  } | null;
  translator_author_screen?: { verdict?: 'hold' } | null;
}

const ENGLISH_LANGUAGES = new Set(['english', 'en', 'eng']);

/**
 * Is the CATALOGUED language English?
 *
 * ⚠️ Necessary but nowhere near sufficient, and never a substitute for the
 * source-language screen. `books.language` is the language of the WORK, not of
 * the pages we hold: Ganguli's *Mahābhārata* and Avalon's *Serpent Power* are
 * catalogued Sanskrit and are English editions. That is why the screen exists,
 * and why this check runs AFTER it.
 */
function isCataloguedEnglish(book: ScreenedBook): boolean {
  const l = (book.language ?? '').trim().toLowerCase();
  return ENGLISH_LANGUAGES.has(l);
}

/**
 * Classify what we can honestly claim about this book.
 *
 * PRECEDENCE IS THE DESIGN. Evidence that DEFEATS the claim is checked before
 * evidence that supports it, so a book can never be `confirmed` while carrying a
 * found prior or an already-English source. That ordering is what makes the
 * state monotone under new sources: adding evidence can only move a book down
 * the list, never up.
 */
export function classifyFirstTranslationClaim(
  book: ScreenedBook,
): FirstTranslationClaimResult {
  const sourceScreen = book.source_language_screen?.verdict;
  const held = book.translator_author_screen?.verdict === 'hold';
  const screensIncomplete =
    sourceScreen === undefined || sourceScreen === 'no_ocr' || sourceScreen === 'undetermined';

  // 1. A found prior defeats everything, including a confirmed verdict. This is
  //    the only direction the instrument is reliable in, so it goes first.
  const resolved = resolveFirstTranslation(book);
  if (resolved?.verdict === 'not_first') {
    return { claim: 'defeated', reason: 'prior_found', screensIncomplete, needsReview: false };
  }

  // 2. The pages are already English — measured, not inferred from `language`.
  if (sourceScreen === 'english_source') {
    return {
      claim: 'not_applicable',
      reason: 'source_already_english',
      screensIncomplete: false,
      needsReview: false,
    };
  }

  // 3. Catalogued English AND not contradicted by the screen. Checked second
  //    because the screen is the better instrument; this only catches books the
  //    screen could not reach.
  if (isCataloguedEnglish(book) && sourceScreen !== 'foreign_source') {
    return {
      claim: 'not_applicable',
      reason: 'catalogued_english',
      screensIncomplete,
      needsReview: false,
    };
  }

  // 4. The book may itself be a published translation we re-hosted (Legge's
  //    *Chinese Classics*, the Loebs). A HOLD is a review request, never an
  //    exclusion — the signal is irreducibly noisy (a translator is often also an
  //    author; a rendering into German does not defeat a claim about English), so
  //    §17 applies: never derive a destructive outcome from an unverified match.
  //    The claim survives and is flagged.
  if (held) {
    return {
      claim: 'candidate',
      reason: 'book_is_a_translation',
      screensIncomplete,
      needsReview: true,
    };
  }

  // 5. A verified first, earned through the existing gates (evidence quality,
  //    readable coverage, the single-writer verdict).
  if (isFirstTranslation(book)) {
    return { claim: 'confirmed', reason: 'verified_first', screensIncomplete, needsReview: false };
  }

  // 6. The honest default.
  return {
    claim: 'candidate',
    reason: screensIncomplete ? 'source_language_unscreened' : 'no_prior_found',
    screensIncomplete,
    needsReview: false,
  };
}

/**
 * Does this book carry a first-translation claim of ANY strength?
 *
 * Convenience for surfaces that list "works with no known prior translation"
 * without distinguishing verified from candidate. Do NOT use it to render a
 * badge: the whole point is that the two states must look different.
 */
export function hasFirstTranslationClaim(book: ScreenedBook): boolean {
  const { claim } = classifyFirstTranslationClaim(book);
  return claim === 'confirmed' || claim === 'candidate';
}
