/**
 * Pure text utilities for word-level alignment (issue #3091).
 *
 * Shared by the server-side span resolver (src/lib/word-alignment.ts) and the
 * client-side trace layer (src/components/reader/TraceAlignment.tsx), which
 * both need to answer the same question: "where does this quoted span sit in
 * this larger text?" — robustly against the ways an LLM (or a renderer)
 * lawfully differs from the stored page text.
 *
 * The folds are SYMMETRIC (applied to both haystack and needle), so they can
 * be aggressive without breaking genuine usage: measured on real pages, the
 * model quoting early-modern Latin routinely
 *   - expands scribal abbreviations (nõ → non, Creatorẽ → Creatorem),
 *   - normalizes long ſ to s (or misreads it as f),
 *   - joins end-of-line hyphenations (reſurrectio-\nnem → reſurrectionem),
 *   - drops accents (cùm → cum),
 * each of which broke exact matching for ~half of all pairs.
 *
 * Kept dependency-free so it is safe to import from client bundles.
 */

export interface NormalizedText {
  /** Folded, whitespace-collapsed text used for searching. */
  norm: string;
  /** rawIdx[i] = offset in the ORIGINAL string of the char behind norm[i]. */
  rawIdx: number[];
}

/** Early-modern nasal abbreviations: tilde vowel = vowel + n. */
const TILDE_VOWELS: Record<string, string> = {
  'ã': 'an', 'ẽ': 'en', 'ĩ': 'in', 'õ': 'on', 'ũ': 'un',
};

/** Single-char ligatures NFD won't decompose. */
const LIGATURES: Record<string, string> = {
  'æ': 'ae', 'œ': 'oe', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ß': 'ss',
};

/**
 * Fold one char to its normalized form (possibly several chars).
 * Order matters: tilde-vowel expansion must run before diacritic stripping,
 * or `õ` would collapse to plain `o` and lose its `n`.
 */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  const base = lower.length === 1 ? lower : ch;
  if (TILDE_VOWELS[base]) return TILDE_VOWELS[base];
  if (LIGATURES[base]) return LIGATURES[base];
  if (base === 'ſ') return 's';
  // Strip combining diacritics (cùm → cum). Multi-char decompositions of a
  // genuinely different letter (rare) fall back to the original char.
  const stripped = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return stripped.length >= 1 ? stripped : base;
}

const WS = /\s/;

/**
 * Normalize a string for alignment search, keeping a map from each folded
 * char back to its raw offset:
 * - whitespace runs collapse to a single space,
 * - end-of-line hyphenations disappear (`letter-` + whitespace → joined),
 * - chars fold per foldChar (case, ligatures, abbreviations, diacritics).
 */
export function normalizeForSearch(raw: string): NormalizedText {
  const chars: string[] = [];
  const rawIdx: number[] = [];
  let inWs = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (WS.test(ch)) {
      if (!inWs && chars.length > 0) {
        chars.push(' ');
        rawIdx.push(i);
      }
      inWs = true;
      continue;
    }
    // Dehyphenation: a hyphen glued to a word end and followed by whitespace
    // is a line-break artifact — drop it AND the whitespace so the two halves
    // join ("reſurrectio-\nnem" → "reſurrectionem"). A spaced dash (" - ")
    // survives because the preceding char is whitespace.
    if ((ch === '-' || ch === '\u00AD') && i + 1 < raw.length && WS.test(raw[i + 1]) && i > 0 && !WS.test(raw[i - 1])) {
      while (i + 1 < raw.length && WS.test(raw[i + 1])) i++;
      inWs = false;
      continue;
    }
    const folded = foldChar(ch);
    for (const f of folded) {
      chars.push(f);
      rawIdx.push(i);
    }
    inWs = false;
  }
  // Trim a trailing collapsed space so spans never end on padding.
  if (chars[chars.length - 1] === ' ') {
    chars.pop();
    rawIdx.pop();
  }
  return { norm: chars.join(''), rawIdx };
}

/** Normalize a needle the same way normalizeForSearch treats the haystack. */
export function normalizeNeedle(span: string): string {
  const n = normalizeForSearch(span);
  return n.norm.trim();
}

export interface LocatedSpan {
  /** Raw-offset range [start, end) in the original string. */
  start: number;
  end: number;
  /** Where the match begins in the normalized string (for cursor movement). */
  normStart: number;
  /**
   * Where the match ends in the normalized string (exclusive). NOT derivable
   * from `end - start`: folding changes length in both directions (`æ`→`ae`
   * grows, dehyphenation and diacritic stripping shrink), so a raw length is
   * not a normalized length. Callers testing "is this normalized offset inside
   * the span?" must use this.
   */
  normEnd: number;
}

function indexWithFallback(norm: string, needle: string, fromNorm: number): number {
  let at = norm.indexOf(needle, Math.max(0, fromNorm));
  if (at === -1 && fromNorm > 0) at = norm.indexOf(needle);
  return at;
}

/**
 * Find `span` inside a normalized haystack, preferring the first occurrence
 * at/after `fromNorm` (occurrence disambiguation for repeated phrases) and
 * falling back to a global search. Returns raw offsets into the original
 * string, or null when the span cannot be found.
 *
 * Second chance: models misread long ſ as `f` ("aduerſus" quoted as
 * "aduerfus"). On a miss, retry with the needle's f folded to s — safe
 * because the rest of the phrase still has to anchor the match exactly.
 */
export function locateSpan(
  hay: NormalizedText,
  span: string,
  fromNorm = 0,
): LocatedSpan | null {
  const needle = normalizeNeedle(span);
  if (!needle || needle.length < 2) return null;
  let at = indexWithFallback(hay.norm, needle, fromNorm);
  if (at === -1 && needle.includes('f')) {
    at = indexWithFallback(hay.norm, needle.replace(/f/g, 's'), fromNorm);
  }
  if (at === -1) return null;
  const start = hay.rawIdx[at];
  const end = hay.rawIdx[at + needle.length - 1] + 1;
  return { start, end, normStart: at, normEnd: at + needle.length };
}
