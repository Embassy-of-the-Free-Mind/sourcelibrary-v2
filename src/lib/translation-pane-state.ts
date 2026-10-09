/**
 * What the translation pane should say when a page has a transcription but no
 * `translation.data`.
 *
 * PRIOR ART: src/lib/translation-request-cta.ts — decides whether to OFFER a
 * translation request, and already knows an English book has nothing to be
 * translated into; but the pane around that decision still said "It has not
 * been translated into English yet" over an English page. This names the pane
 * state itself so the copy can branch on it. Reader2C.tsx and the CTA helper
 * each had their own `startsWith('english')`; both now use `isEnglishBook()`.
 *
 * Why English is different (#4958, .claude/docs/pipeline.md "English
 * Modernization"): the pipeline never dispatches an English book to
 * translation. A pre-1700 English edition may instead be MODERNIZED — Early
 * Modern → Modern English — into the same `translation.data` field, and only
 * when a reader asks. So an empty translation pane on an English book is not
 * "untranslated"; it is either the normal state of an English edition, or a
 * modernization nobody has asked for yet.
 */
import type { Book } from '@/lib/types/book';

export type TranslationPaneEmptyState =
  /** An English edition: the transcription IS the reading text. Nothing is owed. */
  | 'english-reading-text'
  /** Early Modern English (pre-1700): a modernized reading could be made but has not been. */
  | 'english-not-modernized'
  /** Not English, OCR present, no translation: the ordinary "ready to translate" state. */
  | 'ready-to-translate';

/** First year modern-orthography English is treated as needing no modernization. */
export const MODERNIZATION_CUTOFF_YEAR = 1700;

/** `books.language` is the EDITION's language (language-fields.md). "English", "english", "English (modernized)" all count. */
export function isEnglishBook(language?: string | null): boolean {
  return (language || '').trim().toLowerCase().startsWith('english');
}

/** The edition year from `books.published` ("1657", "c. 1657", "1657-1660"), or null. */
export function publishedYear(published?: string | number | null): number | null {
  if (published == null) return null;
  const m = /\b(\d{4})\b/.exec(String(published));
  return m ? Number(m[1]) : null;
}

export function translationPaneEmptyState(
  book: Pick<Book, 'language'> & { published?: string | number | null },
): TranslationPaneEmptyState {
  if (!isEnglishBook(book.language)) return 'ready-to-translate';
  const year = publishedYear(book.published);
  if (year != null && year < MODERNIZATION_CUTOFF_YEAR) return 'english-not-modernized';
  return 'english-reading-text';
}
