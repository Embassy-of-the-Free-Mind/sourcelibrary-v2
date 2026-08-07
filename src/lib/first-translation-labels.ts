/**
 * Badge text for first-translation claims.
 *
 * Centralizes the mapping so all UI components stay in sync.
 *
 * THE COPY RULE (#3459). "First English translation" asserts an unprovable
 * universal negative: no catalogue can establish one, it can only return
 * *nothing found*. Our reference set's measured recall is 27% — three of every
 * four known prior English translations are invisible to it — and a sampled
 * check puts the positive predictive value of a `none_found` near 50%.
 *
 * So the copy states the SEARCH, which is a bounded, dated act we actually
 * performed and can show, rather than the negative, which is a claim about the
 * world that no search supports. "No prior English translation found" is true
 * at any recall; "this is the first" is not.
 *
 * Two registers, and which one a book gets is decided by evidence strength in
 * `classifyFirstTranslationClaim`, never by the badge flag alone:
 *
 *   confirmed → strong/moderate evidence. The assertive label stands.
 *   candidate → weak or unrecorded evidence (88% of badged books, measured
 *               2026-08-07). Reports the search and its limits.
 */

import type { FirstTranslationClaim } from './first-translation/candidate';

type Disposition = 'confirmed_first' | 'first_from_source' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';

/**
 * Returns the short badge label for a first-translation book.
 * Pass the book's language to get "First Translation from Latin" etc.
 *
 * `inProgress` marks a book whose translation is real but far from complete
 * (#3435 — 244 badged books are under 10% translated). The bibliographic claim
 * is unchanged; the label stops implying a readable English edition exists.
 * "First Complete Translation" collapses to "First Translation, in progress",
 * because calling a 6%-translated book *complete* is the specific claim the
 * coverage gate exists to prevent.
 *
 * `claim` decides the register. A `candidate` never gets an assertive label,
 * however strong the disposition reads — the disposition records what a search
 * concluded, not how well it was evidenced, and conflating the two is what put
 * an unqualified "First Translation" on 5,243 weakly-evidenced books.
 *
 * ⚠️ IT DEFAULTS TO `candidate`, AND THAT DIRECTION IS THE POINT. A caller that
 * cannot supply the claim has, by definition, not established the evidence —
 * the collection, catalogue, author and exhibition cards all render from
 * `books_catalog`, which carries `ft_disposition` but no evidence strength, so
 * none of them can tell a cross-checked first from a legacy shim. Defaulting to
 * the assertive label would let every one of those surfaces assert a universal
 * negative by omission, which is precisely how this area fails (see
 * `.claude/docs/invariants/first-translation-claims.md`: every defect here
 * failed toward a confident clean negative). Opt IN to `confirmed`; never
 * inherit it.
 */
export function firstTranslationBadge(
  disposition?: string,
  language?: string,
  inProgress?: boolean,
  claim: FirstTranslationClaim = 'candidate',
): string {
  if (claim === 'candidate') {
    // Deliberately one label, not a family. The disposition's shades
    // (complete / modern / from-source) are distinctions the weak evidence
    // cannot support, so drawing them here would dress up a coin flip.
    return inProgress ? 'No prior translation found, in progress' : 'No prior translation found';
  }
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
 * The expanded description shown in the book detail panel.
 *
 * For a `candidate` this is the search statement — what we looked for, and the
 * two things a reader needs in order to weigh it: that a catalogue can only
 * report absence, and that ours is thin for exactly the period most of this
 * corpus comes from. Stating the limit is not a hedge; it is the claim.
 *
 * Defaults to `candidate` for the same reason `firstTranslationBadge` does.
 */
export function firstTranslationDescription(
  disposition?: string,
  claim: FirstTranslationClaim = 'candidate',
): string {
  if (claim === 'candidate') {
    return 'We searched the catalogues for an earlier English translation of this text and found none. That is a record of the search, not proof that none exists — catalogue coverage of early printed books is thin, and an absence there is weaker evidence than a find.';
  }
  switch (disposition as Disposition) {
    case 'confirmed_first':
      return 'No prior complete English translation of this text has been found.';
    case 'first_from_source':
      return 'English translations of this work exist from another source language, but this specific text has never been translated.';
    case 'first_complete_translation':
      return 'Only partial translations or excerpts exist. This is the first complete English translation.';
    case 'first_modern_translation':
      return 'Only antiquated translations exist. This is the first modern English translation.';
    default:
      return 'No prior English translation of this text was found.';
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
  if (claim === 'confirmed') return 'First English translation';
  if (claim === 'candidate') return 'No prior English translation found';
  return null;
}
