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
 *      otherwise the head prints twice. When it does not, the chip is split
 *      only if the definition reads as the model's English gloss
 *      (`readsAsGloss`); a citation, a mantra or a title inside a chip is the
 *      book's own text and stays as it is.
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
 * Chips that carry a colon and are still the BOOK's words — splitting them would
 * hide page text behind a note (found on the #5901 scan, before any write):
 *   - a citation: `law: Gracchus, Code, On adultery`, `Code: Concerning the most
 *     holy churches`, `Psalm 37: verses 35, 36`;
 *   - a mantra: `Tadyatha: Hume hume, humile humila, batiye svaha`;
 *   - a title and its subtitle: `Book of Jin: Treatise on Astronomy`,
 *     `Mother: Perfection of Wisdom in One Letter`.
 * A real definition under one of these heads stays a chip, as before.
 */
const CITATION_HEAD = /^(?:laws?|lex|l|code|cod|codex|digest|dig|ff|authenti\w+|auth|institutes?|inst|novels?|nov|chapters?|chap|cap|c|canons?|can|sections?|sect|paragraphs?|par|verses?|vers|v|gloss\w*|rubric|titles?|tit|books?|lib|liber|questions?|quaest|qu?|distinctions?|dist|d|articles?|art|arguments?|arg|extra|decretals?|clementines?|psalms?|ps|rules?|reg|ibid(?:em)?|idem)\.?$/i;
const MANTRA = /(?:tadyath|syadyath|sv[aā]h[aā]|swaha|\bph[aā][tṭ]\b|\bmant[h]?ra:|\bdh[aā]ra[nṇ][iī]:)|(?:^|:)\s*(?:o[mṃṁ]|namo|nama[hḥ])\s/i;
/** Small words a title leaves in lower case. */
const TITLE_SMALL = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'and', 'or', 'to', 'for', 'by', 'with', 'from']);
/** @param {string} s */
const isTitleCase = (s) => {
  const ws = s.split(/\s+/).filter((w) => /\p{L}/u.test(w) && !TITLE_SMALL.has(w.toLowerCase()));
  return ws.length > 0 && ws.every((w) => /^[^\p{L}]*\p{Lu}/u.test(w));
};

/** A head that does not repeat the sentence is split only when it is this short… */
const MAX_NEW_HEAD_WORDS = 4;
/** …its definition is a gloss, not a passage… */
const MAX_NEW_DEFINITION_WORDS = 60;
/** …and reads as English prose: `tenebo statum meum: locum meum tuebor` and
 *  `Gretter vid Þorbiorn Anugul: Er þat vel…` are the source text, wrapped in a chip. */
const ENGLISH_GLUE = /(?:^|[^\p{L}])(?:the|of|or|to|for|by|with|that|which|from|and|used|its|their|this|these|who|where|when|was|were|into|literally|meaning|here|referring|refers|approximately|approx|about|an|is|as|in|on|at|a(?=\s+\p{Ll}{2}))(?:$|[^\p{L}])/iu;
/** A second `label: ` inside the definition, unless the label is the model's own (`original:`, `Latin:`). */
const INNER_LABEL = /([\p{L}.]+)["”'’*_)]*:\s/gu;

/**
 * True when a definition reads as the model's English gloss rather than as more
 * of the page — the test a chip must pass when its head is NOT already in the
 * sentence (when it is, the repeat itself shows the chip is the model's).
 * @param {string} head @param {string} definition
 */
export function readsAsGloss(head, definition) {
  if (words(head) > MAX_NEW_HEAD_WORDS || words(definition) > MAX_NEW_DEFINITION_WORDS) return false;
  if (!ENGLISH_GLUE.test(definition)) return false;
  for (const m of definition.matchAll(INNER_LABEL)) if (!APPARATUS_HEAD.test(m[1])) return false;
  return true;
}

/**
 * Where `head: definition` divides: the first colon followed by whitespace that
 * is not inside brackets. `God (original: ΘΥ — Theou)` has none, so it is not a
 * definition; `strength (original: "uirtutem"): while often…` divides after the
 * bracket. A colon with a space before it is a proportion or an apparatus entry
 * (`EG² : AB² = AC + ac : AC`), never a definition.
 * @param {string} body
 */
function colonAt(body) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0 && /\s/.test(body[i + 1] || '')) return /\s/.test(body[i - 1] || ' ') ? -1 : i;
  }
  return -1;
}

/**
 * Split `head: definition`, or null when the chip is a genuine term.
 * @param {string} body
 * @returns {{ head: string, definition: string } | null}
 */
export function splitTermDefinition(body) {
  // The colon must be followed by whitespace — "Genesis 1:3" is a reference, not a definition.
  const at = colonAt(body);
  if (at < 0) return null;
  const head = body.slice(0, at).trim();
  const definition = body.slice(at + 1).trim();
  if (!head || !definition) return null;
  if (words(head) > MAX_HEAD_WORDS) return null;
  // A definition opens with a word (possibly italicised), not a verse or folio number.
  if (!/^[\p{L}"'‘“(*_]/u.test(definition)) return null;
  // The model's own label (`original: "Bhauma"`) is commentary however short it is.
  if (words(definition) < MIN_DEFINITION_WORDS && words(body) <= LONG_TERM_WORDS && !APPARATUS_HEAD.test(head)) return null;
  // The book's own words, not a definition: a numbered or labelled citation, a mantra,
  // shouted text, a title with its subtitle.
  // `aplaneis; original: "ἀπλανεῖς"; literally "unwandering"`: the colon belongs to a label
  // inside the chip, not to the chip's head.
  if (/[\d|;]/.test(head) || CITATION_HEAD.test(head) || MANTRA.test(body)) return null;
  if (!/\p{Ll}/u.test(definition) && /\p{Lu}/u.test(definition)) return null;
  if (isTitleCase(definition) && words(definition) > 1 && ((words(head) > 1 && isTitleCase(head)) || !/^["'‘“(*_]*(?:the|an?)\s/i.test(definition))) return null;
  return { head, definition };
}

/**
 * Heads that label the model's own apparatus rather than name a term —
 * `<term>original: 足陽明經 (zú yáng míng jīng); a major channel…</term>`,
 * `<term>Latin: *magister equitum*; a high-ranking commander</term>`. The whole
 * chip is commentary, so it becomes a note with no term chip.
 */
export const APPARATUS_HEAD = new RegExp(`^(?:(?:original\\s+)?(?:${[
  'latin', 'greek', 'hebrew', 'german', 'french', 'italian', 'spanish', 'dutch', 'english', 'arabic', 'persian', 'syriac', 'aramaic',
  'sanskrit', 'pali', 'tibetan', 'chinese', 'japanese', 'coptic', 'armenian', 'russian', 'irish', 'portuguese', 'catalan', 'text',
].join('|')})|original|lit(?:erally|\\.)?|i\\.e\\.|note|cf\\.?)$`, 'i');

/** Lower-cased word tokens; apostrophes dropped, so `God’s` and `God's` are one word. @param {string} s */
const tokens = (s) => s.toLowerCase().replace(/['’‘ʼ]/g, '').match(/[\p{L}\p{M}\p{N}]+/gu) || [];
/** Words that join a phrase without naming anything: "Cassia or Manna" is the head "Cassia and Manna". */
const JOINER = new Set(['and', 'or', 'the', 'a', 'an', 'of']);
/** Endings English adds to one word: `calcined` / `calcination`, `matrices` / `matrix`, `journeymen` / `journeyman`. */
const ENDINGS = [[/ies$/, 'y'], [/ices$/, 'ix'], [/men$/, 'man'], [/(?:es|s|ed|d|ing|ation|ion|al|ly)$/, ''], [/(?:ed|ing|ation|ion)$/, 'e']];
/** @param {string} w */
const stems = (w) => [w, ...ENDINGS.map(([re, to]) => w.replace(re, to))].filter((x) => x.length > 3);
/** The same English word in another form. A cognate in the source language (`substance` /
 *  `substantia`, `nature` / `Natur`) is a different word: that chip is the vocabulary the page gives.
 *  @param {string} a @param {string} b */
const sameWord = (a, b) => a === b || stems(a).some((f) => stems(b).includes(f));

/** Words after which a chip is part of the sentence: `and a <term>quality: …</term> is`. */
const LEADS_ON = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'of', 'in', 'on', 'at', 'to', 'by', 'with', 'for', 'from', 'into', 'and', 'or', 'but', 'nor', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'its', 'their', 'his', 'her', 'our', 'your', 'my', 'no', 'not', 'any', 'every', 'each', 'some', 'such', 'than']);
/** How many words back the head may stand: `reception of brothers <term>Reception: …`. */
const HEAD_WINDOW = 3;
/** The sentence before a chip, without the notes and tags the reader does not print inline. @param {string} s */
const proseOf = (s) => s.replace(/<(note|gloss|margin|meta|image-desc)>[^<]*<\/\1>/gi, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');

/**
 * True when the sentence before the chip already carries `head`, so keeping the
 * chip would print it twice. Read word by word, ignoring case, emphasis and
 * quote marks, the apostrophe's shape, English endings and joining words:
 * `"formal number" <term>Formal number: …`, `God’s field <term>God's field: …`,
 * `drachms <term>drachm: …`, `to be calcined <term>calcination: …`.
 * The head may stand a few words back (`reception of brothers <term>Reception:
 * …`). Never when the word right before the chip leads on to it: `— The
 * <term>verutum: a short javelin…</term>, according to…` needs its chip to
 * stay a sentence.
 * @param {string} before @param {string} head
 */
export function headPrecedes(before, head) {
  const want = tokens(head).filter((w) => !JOINER.has(w));
  if (!want.length) return false;
  const all = tokens(proseOf(before));
  const have = all.filter((w) => !JOINER.has(w));
  /** @param {number} back */
  const endsAt = (back) => have.length - back >= want.length && want.every((w, i) => sameWord(w, have[have.length - back - want.length + i]));
  // `— The <term>verutum: a short javelin…</term>, according to…`: the chip is the sentence's own word.
  if (!all.length || LEADS_ON.has(all[all.length - 1])) return false;
  if (endsAt(0)) return true;
  for (let back = 1; back <= HEAD_WINDOW; back++) if (endsAt(back)) return true;
  return false;
}

/** This many chips with one head and different text on a page are the page's own labels. */
const REPEATED_LABEL = 3;

/** Annotation spans a `<note>` must not be written into (src/lib/normalize-annotation-spans.ts, plus the panel tags). */
const SPAN_TAG = /<(\/?)(note|margin|gloss|insert|unclear|image-desc|interp|meta)(?:\s[^>]*)?>/gi;

/**
 * Offsets of `text` that lie inside an open annotation span.
 * @param {string} text
 * @returns {(offset: number) => boolean}
 */
export function insideSpan(text) {
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
  // One head given three DIFFERENT "definitions" on a page is a run of labelled entries the
  // page prints — `Urine color: yellow like pure gold`, `Urine color: almost pale…` round a
  // urine wheel — not a definition. (A model repeating one definition says the same thing each time.)
  /** @type {Map<string, Set<string>>} */
  const seen = new Map();
  for (const m of text.matchAll(/<term>([^<\n]*?)<\/term>/gi)) {
    const sp = splitTermDefinition(m[1]);
    if (!sp || APPARATUS_HEAD.test(sp.head)) continue;
    const key = sp.head.toLowerCase();
    seen.set(key, (seen.get(key) || new Set()).add(sp.definition.toLowerCase()));
  }
  const out = text.replace(/<term>([^<\n]*?)<\/term>/gi, (whole, body, offset) => {
    const split = splitTermDefinition(body);
    if (!split) return whole;
    if ((seen.get(split.head.toLowerCase())?.size || 0) >= REPEATED_LABEL) return whole;
    if (inSpan && inSpan(offset)) { n.in_span++; return whole; }
    if (APPARATUS_HEAD.test(split.head)) { n.apparatus++; return `<note>${body.trim()}</note>`; }
    const note = `<note>${split.definition}</note>`;
    const before = text.slice(Math.max(0, offset - 200), offset);
    if (headPrecedes(before, split.head)) { n.head_dropped++; return note; }
    // `**utility** <term>utility (utilitas): …</term>`: the half of the head the sentence
    // already carries is dropped, the other half stays the chip.
    const pair = split.head.match(/^(.+?)\s*\(\s*([^()]+?)\s*\)$/);
    if (pair && !/:\s/.test(pair[2])) {
      const keep = headPrecedes(before, pair[1]) ? pair[2] : headPrecedes(before, pair[2]) ? pair[1] : null;
      if (keep) { n.head_dropped++; return `<term>${keep.replace(/^[*_"“'‘]+|[*_"”'’]+$/g, '')}</term> ${note}`; }
    }
    if (!readsAsGloss(split.head, split.definition)) return whole;
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
