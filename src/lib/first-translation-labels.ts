/**
 * Badge text for first-translation dispositions.
 *
 * Centralizes the mapping so all UI components stay in sync.
 */

type Disposition = 'confirmed_first' | 'first_from_source' | 'first_complete_translation' | 'first_modern_translation' | 'translation_found' | 'needs_review';

/**
 * Returns the short badge label for a first-translation book.
 * Pass the book's language to get "First Translation from Latin" etc.
 */
export function firstTranslationBadge(
  disposition?: string,
  language?: string,
): string {
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
