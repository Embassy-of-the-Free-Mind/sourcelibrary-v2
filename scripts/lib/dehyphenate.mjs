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
 * KNOWN FALSE JOINS, by design: a genuine compound whose hyphen happens to fall at the line end
 * and whose second half is lowercase — `self-\npreservation` → `selfpreservation`,
 * `well-\nknown` → `wellknown`. Deciding that case needs a dictionary; out of scope. The spot
 * check in #4780 measures how often it happens. The raw text survives in `page_revisions`.
 */

// ASCII hyphen, U+2010 HYPHEN, U+00AD SOFT HYPHEN, and U+00AC NOT SIGN — ABBYY writes its
// soft-hyphen marker as ¬ on some Archive items (`non¬\ncommissioned`, The Voice of Africa,
// #4780 day-3 spot check); the break may carry trailing/leading blanks.
const LINE_BREAK_HYPHEN = /(\p{L})[-‐­¬][ \t]*\r?\n[ \t]*(?=\p{Ll})/gu;

/**
 * @param {string} text  OCR text with `\n` line structure
 * @returns {string}     the same text with line-break hyphenations joined
 */
export function dehyphenateLineBreaks(text) {
  if (!text || typeof text !== 'string' || !text.includes('\n')) return text || '';
  return text.replace(LINE_BREAK_HYPHEN, '$1');
}

/** How many line-break joins the rule would make on `text` (for reports; no write). */
export function countLineBreakHyphens(text) {
  if (!text || typeof text !== 'string') return 0;
  return (text.match(LINE_BREAK_HYPHEN) || []).length;
}

// ---------------------------------------------------------------------------------------------
// #4947 — two more Internet Archive defects the hyphen rule above cannot see.
// ---------------------------------------------------------------------------------------------

/**
 * A Google-scan watermark line: `Digitized by Google` as ABBYY reads it (`Digitized by VjOOQIC`,
 * `DigitizedbyLjOOQlC`, `Digitized by eGangotri` …). The pattern is `Digitized by` and then at most
 * a short garbled token, alone on its line. `Digitized by the Internet Archive in 2007 with funding
 * from …` is the Archive's own colophon page, real text, and stays because `the` is refused.
 * Measured 2026-10 (#4947): every one of the 74 written `chaldanoraclesv00theugoog` pages ends
 * with one.
 */
const DIGITIZER_LINE = /^[ \t]*D[il1I]g[il1I]t[il1I][sz]ed[ \t]*by[ \t]*(?!the\b)\S{1,14}(?:[ \t]\S{1,6}){0,2}[ \t]*$/gimu;

/** Drop digitiser watermark lines (see DIGITIZER_LINE). Text without one is returned unchanged. */
export function stripDigitizerWatermark(text) {
  if (!text || typeof text !== 'string') return text || '';
  DIGITIZER_LINE.lastIndex = 0;
  if (!DIGITIZER_LINE.test(text)) return text;
  return text.split('\n').filter((line) => { DIGITIZER_LINE.lastIndex = 0; return !DIGITIZER_LINE.test(line); })
    .join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}

const WORD_EDGE_PUNCT = /^[^\p{L}]+|[^\p{L}]+$/gu;
const lettersOnly = (t) => /^\p{L}+$/u.test(t);

/**
 * The vocabulary of one book, from its own leaves: the lowercased words seen INSIDE a line (the
 * first and last word of each line are left out, because those are where split halves sit), and
 * the adjacent word pairs seen inside a line. A book of a few hundred pages is its own dictionary
 * for the words it uses, in its own language and spelling, at $0.
 *
 * @param {string[]} leaves
 * @returns {{ words: Set<string>, pairs: Set<string> }}
 */
export function bookVocabulary(leaves) {
  const words = new Set();
  const pairs = new Set();
  for (const leaf of leaves || []) {
    if (!leaf) continue;
    for (const line of String(leaf).split('\n')) {
      const toks = line.split(/\s+/).filter(Boolean).map((t) => t.replace(WORD_EDGE_PUNCT, '').toLowerCase());
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (!t || !lettersOnly(t)) continue;
        if (i > 0 && i < toks.length - 1) words.add(t);
        const n = toks[i + 1];
        if (n && lettersOnly(n)) pairs.add(`${t} ${n}`);
      }
    }
  }
  return { words, pairs };
}

// Last word of a line (letters, ending lowercase, preceded by a blank, an opening quote/bracket or
// the line start), a single line break, then a lowercase word at the start of the next line.
const HYPHENLESS_BREAK = /(^|[\s"'“‘(\[])(\p{L}*\p{Ll})[ \t]*\r?\n[ \t]*(\p{Ll}+)(?=[^\p{L}]|$)/gu;
const MIN_HALF = 2;
const MIN_JOINED = 6;

/**
 * Rejoin a word the OCR engine split at a line break WITHOUT a hyphen (#4947). ABBYY drops the
 * printed hyphen on some items (`vege\ntables`, verified in the item's own `_djvu.xml`), so
 * `dehyphenateLineBreaks` never sees the break; measured 6.8% of line-break pairs on one Mead item,
 * 0% on another from the same engine version. It is per item, so a blanket join is wrong — it
 * would turn `the man\ncomes` into `mancomes`.
 *
 * THE RULE. Join `a\nb` into `ab` only when the book itself attests `ab` as a word inside a line
 * AND never prints `a b` as two adjacent words inside a line. Both halves ≥ 2 letters and the
 * joined word ≥ 6, so short function-word pairs (`in\nto`, `a\nway`) are never touched. A
 * paragraph break is never joined across. The case of the halves is kept (`Our\nselves` →
 * `Ourselves`).
 *
 * KNOWN FALSE JOINS, by design: a pair that is also a word the book uses and that the book never
 * happens to print as two words inside a line (`some\ntimes` in a book that only ever wrote
 * `sometimes`). The raw text survives in `page_revisions` for every written page.
 *
 * @param {string} text
 * @param {{ words: Set<string>, pairs: Set<string> }} vocab  from `bookVocabulary(leavesOfThisBook)`
 * @returns {string}
 */
export function rejoinHyphenlessSplits(text, vocab) {
  if (!text || typeof text !== 'string' || !text.includes('\n') || !vocab?.words?.size) return text || '';
  return text.replace(HYPHENLESS_BREAK, (m, pre, a, b) => (shouldJoin(a, b, vocab) ? `${pre}${a}${b}` : m));
}

/** How many joins `rejoinHyphenlessSplits` would make on `text` (for reports; no write). */
export function countHyphenlessSplits(text, vocab) {
  if (!text || typeof text !== 'string' || !vocab?.words?.size) return 0;
  let n = 0;
  for (const m of text.matchAll(HYPHENLESS_BREAK)) if (shouldJoin(m[2], m[3], vocab)) n++;
  return n;
}

function shouldJoin(a, b, vocab) {
  if (a.length < MIN_HALF || b.length < MIN_HALF || a.length + b.length < MIN_JOINED) return false;
  const la = a.toLowerCase(), lb = b.toLowerCase();
  return vocab.words.has(la + lb) && !vocab.pairs.has(`${la} ${lb}`);
}

// A token carrying a character ABBYY emits for ink it could not read: `^`, `~`, `|`, `£`, `¥`,
// `¬`, `©`. The #4947 measure: 93% of one Google-scanned item's pages carry one (marginal running
// heads folded into the body line), 7% of a clean uoft scan's. A per-page SIGNAL, not a gate.
const JUNK_TOKEN = /\S*[\^~|£¥¬©]\S*/gu;

/** Number of junk tokens (see JUNK_TOKEN) in `text`. */
export function junkTokenCount(text) {
  if (!text || typeof text !== 'string') return 0;
  return (text.match(JUNK_TOKEN) || []).length;
}
