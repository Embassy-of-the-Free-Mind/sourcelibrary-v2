/**
 * Separate the translation model's own definitions from the `<term>` chips it
 * wraps them in, so every surface shows them as editorial notes (#5895, #5901).
 *
 * PRIOR ART: src/lib/term-definitions.ts — this rule, written for the reader
 * (#5908). Moved here unchanged so the stored-text cleanup
 * (scripts/maintenance/translation-cleanup-a2-5700.mjs, class `d_termdef`) and
 * the reader run ONE copy; the .ts file re-exports it (the arrangement of
 * scripts/lib/lanes.mjs and pipeline-unit-prices.mjs, which src/ imports).
 * src/lib/notes-off.ts (`preprocessTerms`) — decides what a <term> does when
 * notes are hidden, but assumes the chip holds only the word, so a definition
 * inside it is unwrapped into body text. This pass runs before it.
 *
 * The prompt asks for `<term>X</term> <gloss>meaning</gloss>`. In practice the
 * model writes two shapes the reader mislabels (measured on 793 pages, #5700
 * comment of 2026-10-06):
 *
 *   1. The definition collapsed INTO the term — `<term>Geomancy: A method of
 *      divination that interprets markings on the ground…</term>`. With notes on
 *      it printed mid-sentence as a vocabulary chip; with notes off
 *      `preprocessTerms` unwrapped it, so the definition read as the book's own
 *      words. Here it becomes `<term>Geomancy</term> <note>A method of
 *      divination…</note>`, which notes-off hides and notes-on labels as an
 *      editorial note. When the head word already stands right before the chip
 *      (`**Geomancy** <term>Geomancy: …</term>`), only the note is kept —
 *      otherwise the head prints twice.
 *   2. A `<gloss>` straight after a `<term>`. `<gloss>` is the PAGE-MARK tag (a
 *      gloss printed in the original), so the reader titled the model's
 *      definition "Gloss/annotation in original". A gloss in that position is
 *      the model's, so it becomes a `<note>`.
 *
 * `separateTermDefinitions` (both shapes) is the display pass. Stored
 * translations are rewritten with shape 1 only (`splitInlineTermDefinitions`,
 * #5901): `page_terms` (#4695) indexes term+gloss pairs, so shape 2 stays a
 * display decision. Genuine long terms — mantras, titles — carry no
 * "head: definition" colon and pass through unchanged. Idempotent.
 */

/** Longest head (in words) still read as a term rather than a sentence. */
const MAX_HEAD_WORDS = 6;
/** A definition needs at least this many words, unless the chip as a whole is long. */
const MIN_DEFINITION_WORDS = 3;
/** A chip longer than this, with a colon, is a definition whatever its parts. */
const LONG_TERM_WORDS = 7;

/** @param {string} s */
const words = (s) => s.split(/\s+/).filter(Boolean).length;

/**
 * Split `head: definition`, or null when the chip is a genuine term.
 * @param {string} body
 * @returns {{ head: string, definition: string } | null}
 */
export function splitTermDefinition(body) {
  // The colon must be followed by whitespace — "Genesis 1:3" is a reference, not a definition.
  const m = body.match(/^\s*([^:]+?)\s*:\s+([\s\S]+?)\s*$/);
  if (!m) return null;
  const [, head, definition] = m;
  if (words(head) > MAX_HEAD_WORDS) return null;
  // A definition opens with a word (possibly italicised), not a verse or folio number.
  if (!/^[\p{L}"'‘“(*_]/u.test(definition)) return null;
  if (words(definition) < MIN_DEFINITION_WORDS && words(body) <= LONG_TERM_WORDS) return null;
  return { head, definition };
}

/**
 * Heads that label the model's own apparatus rather than name a term —
 * `<term>original: 足陽明經 (zú yáng míng jīng); a major channel…</term>`. The
 * whole chip is commentary, so it becomes a note with no term chip.
 */
export const APPARATUS_HEAD = /^(?:original|lit(?:erally|\.)?|i\.e\.|note|cf\.?)$/i;

/** Lower-cased word tokens; apostrophes dropped, so `God’s` and `God's` are one word. @param {string} s */
const tokens = (s) => s.toLowerCase().replace(/['’‘ʼ]/g, '').match(/[\p{L}\p{M}\p{N}]+/gu) || [];
/** Words that join a phrase without naming anything: "Cassia or Manna" is the head "Cassia and Manna". */
const JOINER = new Set(['and', 'or', 'the', 'a', 'an', 'of']);
/** A word and its English singular: `drachms` before a chip headed `drachm` is the same word. @param {string} w */
const forms = (w) => [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')];
/** @param {string} a @param {string} b */
const sameWord = (a, b) => a === b || (a.length > 3 && b.length > 3 && forms(a).some((f) => forms(b).includes(f)));

/**
 * True when `before` ends with `head` — the sentence already carries the word,
 * so keeping the chip would print it twice. Read word by word, ignoring case,
 * emphasis and quote marks, the apostrophe's shape, an English plural, and
 * joining words: `"formal number" <term>Formal number: …`, `God’s field
 * <term>God's field: …`, `drachms <term>drachm: …`.
 * @param {string} before @param {string} head
 */
export function headPrecedes(before, head) {
  const want = tokens(head).filter((w) => !JOINER.has(w));
  if (!want.length) return false;
  const have = tokens(before).filter((w) => !JOINER.has(w)).slice(-want.length);
  return have.length === want.length && want.every((w, i) => sameWord(w, have[i]));
}

/** Annotation spans a `<note>` must not be written into (src/lib/normalize-annotation-spans.ts, plus the panel tags). */
const SPAN_TAG = /<(\/?)(note|margin|gloss|insert|unclear|image-desc|interp|meta)(?:\s[^>]*)?>/gi;

/**
 * Offsets of `text` that lie inside an open annotation span.
 * @param {string} text
 * @returns {(offset: number) => boolean}
 */
function insideSpan(text) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let depth = 0, from = 0;
  for (const m of text.matchAll(SPAN_TAG)) {
    if (m[1]) { if (depth > 0 && --depth === 0) ranges.push([from, m.index]); }
    else if (depth++ === 0) from = m.index;
  }
  if (depth > 0) ranges.push([from, text.length]);
  return (offset) => ranges.some(([a, b]) => offset > a && offset < b);
}

/**
 * Shape 1: a definition inside the chip. Single-line, tag-free bodies only —
 * anything nested is left to the span normaliser and rendered as before.
 *
 * `outsideSpans` is for a caller that STORES the result: a chip inside a
 * `<note>`, `<margin>` or other annotation span is left alone, because a
 * `<note>` written there is a nested span (the reader flattens those first, so
 * it does not need the guard).
 *
 * @param {string} text
 * @param {{ outsideSpans?: boolean }} [opts]
 * @returns {{ text: string, n: { split: number, head_dropped: number, apparatus: number, in_span: number } }}
 */
export function splitInlineTermDefinitions(text, { outsideSpans = false } = {}) {
  const n = { split: 0, head_dropped: 0, apparatus: 0, in_span: 0 };
  if (!text || !/<term>/i.test(text)) return { text, n };
  const inSpan = outsideSpans ? insideSpan(text) : null;
  const out = text.replace(/<term>([^<\n]*?)<\/term>/gi, (whole, body, offset) => {
    const split = splitTermDefinition(body);
    if (!split) return whole;
    if (inSpan && inSpan(offset)) { n.in_span++; return whole; }
    if (APPARATUS_HEAD.test(split.head)) { n.apparatus++; return `<note>${body.trim()}</note>`; }
    const note = `<note>${split.definition}</note>`;
    if (headPrecedes(text.slice(Math.max(0, offset - 200), offset), split.head)) { n.head_dropped++; return note; }
    n.split++;
    return `<term>${split.head}</term> ${note}`;
  });
  return { text: out, n };
}

/**
 * The display pass: both shapes.
 * @param {string} text
 * @returns {string}
 */
export function separateTermDefinitions(text) {
  if (!text || !/<term>/i.test(text)) return text;
  const out = splitInlineTermDefinitions(text).text;
  // Shape 2: the model's gloss right after a term is commentary, not a page mark.
  return out.replace(
    /(<term>[^<]*?<\/term>)(\s*)<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>/gi,
    '$1$2<note>$3</note>'
  );
}
