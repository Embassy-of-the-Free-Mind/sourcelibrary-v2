/**
 * Author headings for the BPH catalogue: from a search, find the authors the
 * reader may mean, as a card catalogue would offer "Steiner, Rudolf".
 *
 * PRIOR ART: the `authors` thesaurus and /author/[slug] (author-identity.md) cover
 * the main library's `books.author`, not `bph_works`, whose author column is free
 * text with several names joined by "|". /browse/authors lists the main library too.
 *
 * Pure, with no server imports. The route feeds it rows and confirms each heading
 * with a real count.
 */

import { normalizeBphSearchText } from '@/lib/text-normalize';

const WORD = /[\p{L}\p{M}\p{N}]+/gu;

/** Shorter words appear in too many names to say which author a search means. */
const MIN_TERM_LENGTH = 3;

/** A heading that leads to a single record gives the reader nothing to browse. */
const MIN_WORKS = 2;

const wordsOf = (text: string): string[] => normalizeBphSearchText(text).match(WORD) ?? [];

/** The words of a search long enough to identify an author. Normalised. */
export function authorSearchTerms(query: string): string[] {
  return wordsOf(query).filter((word) => [...word].length >= MIN_TERM_LENGTH);
}

/**
 * The headings in these author values that hold every term as a whole word, most
 * frequent first. Whole words keep a half-typed "the" from offering "Paracelsus,
 * Theophrastus". Spellings that normalise alike, or differ only in punctuation
 * ("Boehme, Jacob", "Böhme, Jacob", "Fludd, Robert?"), count as one heading, shown
 * in its commonest form.
 *
 * The count ranks headings within the rows given. It is not the number to show.
 */
export function matchingAuthorHeadings(
  authorValues: Iterable<string | null | undefined>,
  terms: string[],
  limit = 3,
): string[] {
  if (terms.length === 0) return [];

  const byKey = new Map<string, { total: number; forms: Map<string, number> }>();
  for (const value of authorValues) {
    for (const raw of (value ?? '').split('|')) {
      const heading = raw.replace(/[[\]?]/g, '').trim();
      if (!heading) continue;
      const words = wordsOf(heading);
      if (!terms.every((term) => words.includes(term))) continue;
      const key = words.join(' ');
      const entry = byKey.get(key) ?? { total: 0, forms: new Map<string, number>() };
      entry.total += 1;
      entry.forms.set(heading, (entry.forms.get(heading) ?? 0) + 1);
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()]
    .filter((entry) => entry.total >= MIN_WORKS)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((entry) => [...entry.forms].sort((a, b) => b[1] - a[1])[0][0]);
}
