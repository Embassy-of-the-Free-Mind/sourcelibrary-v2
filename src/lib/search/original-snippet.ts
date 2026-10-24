/**
 * Where a query stands in a page's ORIGINAL text, for the snippet a search row
 * quotes on an original-text locale (`/la`, `/zh`, #7175).
 *
 * PRIOR ART: src/lib/lexicon/normalize.ts — `normalizeLatin` folds one WORD to a
 * dictionary key and drops every non-letter, so it cannot say where in a page
 * the word stands. src/lib/archaic-orthography.ts — detects early modern
 * spelling, does not match it. keyword-search.ts `indexOfWord` — exact letters
 * only. This file folds a whole page while keeping a map back to the original
 * offsets, so the snippet is cut from the text as printed.
 *
 * A Latin reader types `universum`; the page prints `vniuersum`, `Vniverſum` or
 * `uniuersum`. Folded on both sides (case, accents, ſ→s, j→i, v→u, æ/ę→ae,
 * œ→oe) they meet. The fold is for FINDING the place only; the excerpt shown is
 * the page's own spelling.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/** One character folded for Latin matching. May return '' or two letters. */
function foldLatinChar(ch: string): string {
  const lower = ch.toLowerCase();
  switch (lower) {
    case 'ſ': return 's';
    case 'j': return 'i';
    case 'v': return 'u';
    case 'æ': case 'ę': return 'ae';
    case 'œ': return 'oe';
    default: return lower.normalize('NFD').replace(COMBINING_MARKS, '');
  }
}

/** The folded text and, for each folded character, its offset in the original. */
export function foldLatin(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = foldLatinChar(text[i]);
    for (const c of f) { folded += c; map.push(i); }
  }
  return { folded, map };
}

/** `foldLatin(text).folded`, for a query. */
export function foldLatinString(text: string): string {
  return foldLatin(text).folded;
}

const LETTER = /[\p{L}\p{M}\p{N}]/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The [start, end) of `needle` in `text`, in the ORIGINAL text's offsets, or
 * null. A whole-word hit wins over a hit inside a longer word. With `latin` the
 * comparison is folded; otherwise it is case-insensitive only (Chinese has no
 * case and no word spaces, so any hit is a word hit).
 */
export function locateInOriginal(text: string, needle: string, opts: { latin: boolean }): [number, number] | null {
  const n = needle.trim();
  if (!n) return null;
  if (!opts.latin) {
    const at = text.toLowerCase().indexOf(n.toLowerCase());
    return at >= 0 ? [at, at + n.length] : null;
  }
  const { folded, map } = foldLatin(text);
  const q = foldLatinString(n);
  if (!q) return null;
  const word = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(q)}(?![\\p{L}\\p{M}\\p{N}])`, 'u').exec(folded);
  const at = word ? word.index : folded.indexOf(q);
  if (at < 0) return null;
  const last = at + q.length - 1;
  return [map[at], map[last] + 1];
}

/**
 * The place a search row's excerpt should be cut around: the whole query
 * first, then its words longest first, then the word the search engine
 * reported as its hit. Null when none of them is in the text.
 */
export function locateQuery(text: string, query: string, opts: { latin: boolean; hit?: string }): [number, number] | null {
  const phrase = query.replace(/^"|"$/g, '').trim();
  const words = phrase.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const c of [phrase, ...words, opts.hit ?? '']) {
    if (!c || !LETTER.test(c)) continue;
    const span = locateInOriginal(text, c, opts);
    if (span) return span;
  }
  return null;
}
