/**
 * Badge text for first-translation claims.
 *
 * Centralizes the mapping so all UI components stay in sync.
 *
 * THE COPY RULE (revised 2026-08-11, Derek): plain catalog voice. A library
 * catalog says "first edition" without an epistemology lecture, and everyone
 * understands the implicit "as far as the record shows." We say "First
 * Translation" the same way. The evidence — every search, every source, every
 * screening decision — lives in the data (`work_translation_history`,
 * `first_translation_attempts`) one click away for anyone who wants it; it
 * does not live in the reader's face as a disclaimer. State the fact plainly;
 * keep the provenance available; correct the card when someone shows us a
 * prior. (The previous two-register system — assertive vs. hedged wording by
 * evidence strength — read as a library afraid of its own catalog.)
 *
 * The one qualifier we keep is `inProgress` (#3435): "in progress" on a
 * barely-translated book is reader service, not epistemic hedging — it stops
 * the bibliographic claim from implying a readable English edition exists.
 */

import type { FirstTranslationClaim } from './first-translation/candidate';

type Disposition = 'confirmed_first' | 'first_from_source' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';

/**
 * Returns the short badge label for a first-translation book.
 * Pass the book's language to get "First from Latin" etc.
 *
 * The `claim` parameter is retained for call-site compatibility but no longer
 * changes the register: badged books get the plain catalog label.
 */
export function firstTranslationBadge(
  disposition?: string,
  language?: string,
  inProgress?: boolean,
  _claim: FirstTranslationClaim = 'candidate',
): string {
  if (inProgress) {
    return disposition === 'first_from_source' && language
      ? `First from ${language}, in progress`
      : 'First Translation, in progress';
  }
  if (disposition === 'first_from_source' && language) {
    return `First from ${language}`;
  }
  if (disposition === 'first_complete_translation') {
    return 'First Complete Translation';
  }
  if (disposition === 'first_modern_translation') {
    return 'First Modern Translation';
  }
  // confirmed_first or fallback
  return 'First Translation';
}

/**
 * One sentence stating how much of the book is actually readable in English.
 * Shown beside the description whenever coverage is below the readable floor,
 * so the panel never lets a bibliographic claim stand in for a finished text.
 */
export function translationProgressNote(coverage: number): string {
  const pct = coverage < 0.01 ? '<1' : String(Math.round(coverage * 100));
  return `Translation in progress — about ${pct}% of this book is available in English so far.`;
}

/**
 * The expanded description shown in the book detail panel. Plain catalog
 * voice; the search record backs it one click away.
 */
export function firstTranslationDescription(
  disposition?: string,
  _claim: FirstTranslationClaim = 'candidate',
): string {
  switch (disposition as Disposition) {
    case 'first_from_source':
      return 'English translations of this work exist from another source language; this is the first English translation of this text.';
    case 'first_complete_translation':
      return 'Earlier English translations were partial. This is the first complete English translation.';
    case 'first_modern_translation':
      return 'The first modern English translation.';
    default:
      return 'The first English translation of this text.';
  }
}

/**
 * The claim as one clause, for surfaces with no room for a panel: the book
 * page's publication line, `<meta name="description">`, structured data.
 *
 * Returns null when the book carries no first-translation claim worth stating,
 * so callers fall back to their neutral wording rather than printing an empty
 * qualifier.
 */
export function firstTranslationClause(claim: FirstTranslationClaim): string | null {
  if (claim === 'confirmed' || claim === 'candidate') return 'First English translation';
  return null;
}
