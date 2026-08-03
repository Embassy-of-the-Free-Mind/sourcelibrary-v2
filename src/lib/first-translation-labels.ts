/**
 * Badge text for first-translation dispositions.
 *
 * Centralizes the mapping so all UI components stay in sync.
 */

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
 */
export function firstTranslationBadge(
  disposition?: string,
  language?: string,
  inProgress?: boolean,
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
 * Returns the expanded description shown in the book detail page.
 */
/**
 * One sentence stating how much of the book is actually readable in English.
 * Shown beside the description whenever coverage is below the readable floor,
 * so the panel never lets a bibliographic claim stand in for a finished text.
 */
export function translationProgressNote(coverage: number): string {
  const pct = coverage < 0.01 ? '<1' : String(Math.round(coverage * 100));
  return `Translation in progress — about ${pct}% of this book is available in English so far.`;
}

export function firstTranslationDescription(disposition?: string): string {
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
      return 'This text has not previously been translated into English.';
  }
}
