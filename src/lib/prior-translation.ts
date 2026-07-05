/**
 * Prior human translation credit — reader gate + link labeling (issue #3026).
 *
 * When a book is NOT the first English translation, we credit the human
 * translation that came before and point the reader to where it can be read or
 * bought. This is the un-extractive move: name the (usually invisible, often
 * underpaid) translator and send serious readers to the scholar's edition.
 *
 * The hard rule — same bar as quotes — is VERIFIED, not trusted. The prose
 * these credits are parsed from was written by Gemini, and the entire
 * first-translation stack exists because AI fabricates priors. A credit only
 * renders once its named edition resolved to a real bibliographic record AND
 * carries a resolvable link. A name with no reachable source is just a name, so
 * a missing/empty `url` is disqualifying on its own.
 */

import type { Book, PriorTranslationCredit } from '@/lib/types/book';

/** Does this book carry a publishable prior-translation credit? */
export function hasPublishablePriorTranslation(
  book: Pick<Book, 'prior_translation'>,
): book is Pick<Book, 'prior_translation'> & { prior_translation: PriorTranslationCredit } {
  const p = book.prior_translation;
  return !!p && typeof p.url === 'string' && /^https?:\/\//.test(p.url) && !!p.work_title;
}

/** Human label for the outbound link, by how the edition was confirmed. */
export function priorLinkLabel(p: PriorTranslationCredit): string {
  switch (p.verification_method) {
    case 'worldcat':
      return 'Find it in a library';
    case 'publisher':
      return 'View at publisher';
    case 'google_books':
      return 'View on Google Books';
    case 'library_catalog':
      return 'Find it in a library';
    default:
      return 'Find it';
  }
}

/** "trans. A, B and C" — Oxford-free join of translator names. */
export function formatTranslators(translators: string[]): string {
  const names = (translators || []).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one-line courtesy sentence, minus the link.
 * e.g. "A published English translation exists: De Subtilitate, trans. John M.
 * Forrester (ACMRS, 2013)."  Partial editions say so, honestly.
 */
export function priorTranslationSentence(p: PriorTranslationCredit): string {
  const lead =
    p.scope === 'partial'
      ? 'A partial published English translation exists:'
      : 'A published English translation exists:';
  const bits: string[] = [p.work_title];
  const translators = formatTranslators(p.translators);
  if (translators) bits.push(`trans. ${translators}`);
  const paren: string[] = [];
  if (p.publisher) paren.push(p.publisher);
  if (p.year) paren.push(String(p.year));
  const tail = paren.length ? ` (${paren.join(', ')})` : '';
  return `${lead} ${bits.join(', ')}${tail}.`;
}
