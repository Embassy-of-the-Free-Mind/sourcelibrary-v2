/**
 * See-also references for the BPH catalogue, as on a card catalogue: a reader who
 * searches "jakob" (244 works) should learn that "jacob" holds 1,040.
 *
 * PRIOR ART: src/lib/bph-catalog-suggest.ts — it corrects a word the catalogue does
 * not hold, by edit distance. A variant spelling is a word the catalogue does hold,
 * so that route never fires for it, and "alchemy" is too far from "alchimie" to be
 * found by distance at all. The `authors` thesaurus (author-identity.md) covers the
 * main library's author names, not subject words or this catalogue's free text.
 *
 * Hand-kept on purpose: each group was checked against bph_works on 2026-11-06 and
 * every spelling in it finds works. Add a group only after checking that too. A
 * wrong pair sends readers to unrelated books; the route hides one that finds nothing.
 *
 * No server imports: the browser uses this to decide whether to ask at all.
 */

import { normalizeBphSearchText } from '@/lib/text-normalize';

const VARIANT_GROUPS: readonly (readonly string[])[] = [
  ['alchemy', 'alchemie', 'alchimie', 'alchimia'],
  ['astrology', 'astrologie'],
  ['Behmen', 'Böhme'],
  ['cabala', 'kabbalah', 'qabalah'],
  ['Jacob', 'Jakob'],
  ['magia', 'magic', 'magie'],
  ['mysticism', 'mystik'],
  ['Rosencreutz', 'Rosenkreutz', 'Rosenkreuz', 'Rosicrucian'],
  ['Trismegisto', 'Trismegistus'],
];

const GROUP_BY_WORD = new Map<string, readonly string[]>(
  VARIANT_GROUPS.flatMap((group) => group.map((word) => [normalizeBphSearchText(word), group] as const)),
);

const MAX_VARIANTS = 4;

/**
 * The same search with one word swapped for each of its variants. Empty when no
 * word in the query is on the list. Only the catalogue's normalised form counts as
 * a match, so "Boehme" and "Bohme" are "Böhme" here as they are in the search.
 */
export function bphSeeAlsoQueries(query: string): string[] {
  const queries: string[] = [];
  for (const match of query.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const norm = normalizeBphSearchText(match[0]);
    const group = GROUP_BY_WORD.get(norm);
    if (!group) continue;
    for (const variant of group) {
      if (normalizeBphSearchText(variant) === norm) continue;
      queries.push(query.slice(0, match.index) + variant + query.slice(match.index + match[0].length));
    }
  }
  return queries.slice(0, MAX_VARIANTS);
}
