/**
 * "Did you mean?" for the BPH catalogue: turn a query that found nothing into
 * the closest query made of words the catalogue actually holds.
 *
 * PRIOR ART: src/lib/fuzzy.ts (`findSuggestions`) with /api/search/suggest — its
 * vocabulary is the main library's whole titles and index terms, so it does not
 * know names only the catalogue holds, and it matches a query against a whole
 * phrase, so it cannot correct one word of two. `levenshtein` is reused from it.
 *
 * This module is pure. The route feeds it rows and then confirms each candidate
 * with a real count, because a corrected phrase is not guaranteed to occur: the
 * search box matches the query as one contiguous string.
 */

import { levenshtein } from '@/lib/fuzzy';
import { normalizeBphSearchText } from '@/lib/text-normalize';

/**
 * Public columns only. `search_norm` feeds a public box and deliberately leaves
 * out staff notes, prices and workflow fields, because a match would disclose
 * them (scripts/migration/expand-bph-search-norm.sql). A suggestion discloses
 * the word itself, so this list must stay a subset of the public fields.
 */
export const BPH_VOCABULARY_COLUMNS = [
  'title', 'full_title', 'parallel_title', 'uniform_title',
  'author', 'variant_author', 'pseudonym', 'editor',
  'place', 'keywords',
] as const;

/** Words shorter than this are never in the vocabulary. */
const MIN_WORD_LENGTH = 4;

/** A shorter typed word is too easily one edit away from an unrelated word. */
const MIN_CORRECTABLE_LENGTH = 6;

/** Letters, combining marks and digits in any script, so Greek and Hebrew stay whole. */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

const isNumeric = (word: string) => /^\p{N}+$/u.test(word);

export interface VocabularyWord {
  /** The spelling most often printed in the catalogue, shown to the reader. */
  display: string;
  /** How many times the word occurs across the catalogue's public fields. */
  count: number;
}

/** Normalised word → how the catalogue spells it, and how often. */
export type BphVocabulary = Map<string, VocabularyWord>;

/** Build the vocabulary from catalogue rows, reading only the public columns. */
export function buildBphVocabulary(rows: Iterable<Record<string, unknown>>): BphVocabulary {
  const spellings = new Map<string, Map<string, number>>();
  for (const row of rows) {
    for (const column of BPH_VOCABULARY_COLUMNS) {
      const value = row[column];
      if (typeof value !== 'string') continue;
      for (const word of value.match(WORD) ?? []) {
        if (isNumeric(word)) continue;
        const norm = normalizeBphSearchText(word);
        if ([...norm].length < MIN_WORD_LENGTH) continue;
        const forms = spellings.get(norm) ?? new Map<string, number>();
        forms.set(word, (forms.get(word) ?? 0) + 1);
        spellings.set(norm, forms);
      }
    }
  }

  const vocabulary: BphVocabulary = new Map();
  for (const [norm, forms] of spellings) {
    let display = '';
    let best = 0;
    let count = 0;
    for (const [form, n] of forms) {
      count += n;
      if (n > best) {
        best = n;
        display = form;
      }
    }
    vocabulary.set(norm, { display, count });
  }
  return vocabulary;
}

/**
 * The vocabulary as compact JSON for the shared data cache, which refuses items
 * over 2 MB. The normalised key is left out because it can be recomputed.
 */
export type BphVocabularyWords = Array<[display: string, count: number]>;

export function vocabularyToWords(vocabulary: BphVocabulary): BphVocabularyWords {
  return [...vocabulary.values()].map((w) => [w.display, w.count]);
}

export function vocabularyFromWords(words: BphVocabularyWords): BphVocabulary {
  return new Map(words.map(([display, count]) => [normalizeBphSearchText(display), { display, count }]));
}

/**
 * Stricter than `findSuggestions`, and set against what readers actually typed
 * into this box (2026-11-06, 300 logged zero-result searches). Its scale gave
 * "vampires" → "empires" and "grimorio" → "Gregorio", and short words gave
 * "coxe" → "code". These limits keep "artistotle", "rozacrucians", "tritemius"
 * and "hermes trimesgistro", and lose those.
 */
function maxDistanceFor(length: number): number {
  if (length <= 9) return 1;
  if (length <= 11) return 2;
  return 3;
}

/** Closest vocabulary words: nearest first, the commoner word winning a tie. */
function closestWords(norm: string, vocabulary: BphVocabulary, limit: number): string[] {
  const maxDistance = maxDistanceFor([...norm].length);
  const firstLetter = [...norm][0];
  const scored: Array<{ display: string; distance: number; count: number }> = [];
  for (const [candidate, word] of vocabulary) {
    // People rarely mistype the first letter; a different one means a different word.
    if ([...candidate][0] !== firstLetter) continue;
    if (Math.abs(candidate.length - norm.length) > maxDistance) continue;
    const distance = levenshtein(norm, candidate);
    if (distance <= maxDistance) scored.push({ display: word.display, distance, count: word.count });
  }
  scored.sort((a, b) => a.distance - b.distance || b.count - a.count);
  return scored.slice(0, limit).map((s) => s.display);
}

/**
 * Corrected versions of `query`, best first. Empty when every word is already
 * known, or when an unknown word has nothing close to it. Words the catalogue
 * knows, numbers and short words are left as typed.
 */
export function suggestBphQueries(query: string, vocabulary: BphVocabulary, limit = 3): string[] {
  const replacements = new Map<string, string[]>();
  for (const word of query.match(WORD) ?? []) {
    if (isNumeric(word)) continue;
    const norm = normalizeBphSearchText(word);
    if ([...norm].length < MIN_CORRECTABLE_LENGTH || vocabulary.has(norm)) continue;
    const closest = closestWords(norm, vocabulary, limit);
    if (closest.length > 0) replacements.set(word, closest);
  }
  if (replacements.size === 0) return [];

  // The nth candidate takes each misspelt word's nth-closest correction, or its
  // last one when that word has fewer.
  const candidates = new Set<string>();
  for (let i = 0; i < limit; i++) {
    candidates.add(
      query.replace(WORD, (word) => {
        const closest = replacements.get(word);
        return closest ? closest[Math.min(i, closest.length - 1)] : word;
      }),
    );
  }
  return [...candidates];
}
