/**
 * PRIOR ART: scripts/lib/ngram-normalize.mjs `tokenize()` joins `letter-\nletter` while folding
 * text for ngram COUNTING — it lowercases and strips everything else, so it cannot be used to
 * produce stored text, and it joins regardless of what follows the break. src/lib/align-text.ts
 * `normalizeForSearch()` does the same at search time in TypeScript (a fold with an offset map,
 * not a text transform). Neither writes text back; this one does, so it keeps the rule narrow.
 *
 * dehyphenate — join words the OCR engine split at a printed line break.
 *
 * WHY (#4780). The Internet Archive's `_djvu.xml` keeps the typesetter's line-end hyphens:
 * `am-\nmunition`, `ex-\npositions`. Measured 2026-09-13 on the ingested English shelf: 22,320
 * of 26,621 sampled pages (84%) carry at least one. A split word is invisible to search and
 * quotes; Gemini OCR joins them, so the two text sources disagreed on every such word.
 *
 * THE RULE. `xxx-` at the end of a line followed by a line that starts with a LOWERCASE letter
 * is a line-break artifact: drop the hyphen and the break. When the next line starts with an
 * uppercase letter or a digit the text is left exactly as it is (a hyphenated name or compound
 * such as `Anglo-\nSaxon`, `1-\n2`). A blank line (paragraph break) is never joined across.
 *
 * NUMBER WORDS ARE NEVER JOINED (#4784). The largest false-join class measured on 400 random
 * `ia_ocr_dehyphenate` revisions: `twenty-\nfive`, `thirty-\none`, `one-\nfourth`. The break is
 * kept when the left half is a tens word (`twenty`…`ninety`), or when both halves are number
 * words (`one-\nhalf`, `three-\nquarters`). A right half alone is not enough: `be-\nhalf` and
 * `ca-\nnine` are syllable breaks and must still join.
 *
 * KNOWN FALSE JOINS, by design: a genuine compound whose hyphen happens to fall at the line end
 * and whose second half is lowercase — `self-\npreservation` → `selfpreservation`,
 * `well-\nknown` → `wellknown`. Deciding that case needs a dictionary; out of scope. The spot
 * check in #4780 measures how often it happens. The raw text survives in `page_revisions`.
 */

// ASCII hyphen, U+2010 HYPHEN, U+00AD SOFT HYPHEN, and U+00AC NOT SIGN — ABBYY writes its
// soft-hyphen marker as ¬ on some Archive items (`non¬\ncommissioned`, The Voice of Africa,
// #4780 day-3 spot check); the break may carry trailing/leading blanks.
// The left word and the right word are captured whole so number compounds can be kept.
const LINE_BREAK_HYPHEN = /(\p{L}+)[-‐­¬][ \t]*\r?\n[ \t]*(?=(\p{Ll}\p{L}*))/gu;

const TENS = new Set(['twenty', 'thirty', 'forty', 'fourty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']);
const CARDINALS = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'hundred', 'thousand', ...TENS]);
const ORDINALS_AND_FRACTIONS = new Set(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
  'eighth', 'ninth', 'tenth', 'twelfth', 'twentieth', 'hundredth', 'thousandth',
  'half', 'halves', 'thirds', 'quarter', 'quarters', 'fourths', 'fifths', 'sixths', 'sevenths', 'eighths',
  'ninths', 'tenths', 'twelfths', 'hundredths', 'thousandths']);

/** True when `left-\nright` is a hyphenated number (`twenty-five`, `one-fourth`) to keep as printed. */
function isNumberCompound(left, right) {
  const l = left.toLowerCase();
  if (TENS.has(l)) return true;
  const r = right.toLowerCase();
  return CARDINALS.has(l) && (CARDINALS.has(r) || ORDINALS_AND_FRACTIONS.has(r));
}

const join = (match, left, right) => (isNumberCompound(left, right) ? match : left);

/**
 * @param {string} text  OCR text with `\n` line structure
 * @returns {string}     the same text with line-break hyphenations joined
 */
export function dehyphenateLineBreaks(text) {
  if (!text || typeof text !== 'string' || !text.includes('\n')) return text || '';
  return text.replace(LINE_BREAK_HYPHEN, join);
}

/** How many line-break joins the rule would make on `text` (for reports; no write). */
export function countLineBreakHyphens(text) {
  if (!text || typeof text !== 'string') return 0;
  let n = 0;
  for (const m of text.matchAll(LINE_BREAK_HYPHEN)) if (!isNumberCompound(m[1], m[2])) n++;
  return n;
}
