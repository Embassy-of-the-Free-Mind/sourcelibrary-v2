/**
 * Write-time guard for the model's definitions in a new translation (#5902).
 *
 * PRIOR ART: scripts/lib/term-definitions.mjs — the shape-1 rule
 * (`splitInlineTermDefinitions`), shared by the reader (#5895) and the stored-text
 * cleanup (#5901). Imported here, not copied: this module only adds the bracket
 * shape and runs both before `translation.data` is stored.
 * scripts/lib/translate-core.mjs `sanitizeTranslationTags` — the tag repair every
 * writer runs; kept separate because the #5700 cleanup accepts its output only when
 * it DELETED tags, and this guard inserts a `<note>`.
 *
 * Two shapes, both the model's commentary written where a reader takes it for the
 * book's words:
 *
 *   1. A definition inside the chip — `<term>Luna: the alchemical name for
 *      silver</term>` → `<term>Luna</term> <note>the alchemical name for
 *      silver</note>`. Left over from prompts v2/v5 (#5902 comment of 2026-10-06:
 *      0 of 628 pages under v6+), so this half is a safety net.
 *   2. A bracketed definition straight after a chip the sentence NAMES — `For the
 *      term <term>Tamim</term> [perfect]` → `For the term <term>Tamim</term>
 *      <note>perfect</note>`. The note-free prompt wrote 13 bracket glosses on 3 of
 *      40 pages (#5919). Built for precision, not recall: without a naming cue
 *      ("called", "the term", "the name", "said"…) a bracket after a term is, on
 *      stored pages, as often a supplied word as a gloss, and a gloss left in
 *      brackets still reads as the translator's. Single brackets are
 *      otherwise the translator's supplied words (#4385), which the reader marks
 *      and this guard leaves alone: `what a [mere trick] performs`, `**Rabbi
 *      Isaac** [said]:`, and `<term>Zisang Hu</term> [replied]` — a supplied
 *      speech verb after a name is the sentence, not a gloss of the name.
 *
 * Out of scope: `<term>X</term> <gloss>Y</gloss>` stays as written. `page_terms`
 * (#4695, scripts/lib/page-terms-parse.mjs) indexes term+gloss pairs, and #5942
 * moves notes to their own layer; the reader relabels that gloss at display time.
 *
 * Pure and idempotent. Chips inside an annotation span (`<note>`, `<margin>`, …)
 * are left alone, so a `<note>` is never written inside another.
 */
import { splitInlineTermDefinitions, insideSpan } from './term-definitions.mjs';

/** Longest bracket read as a gloss of the term rather than a supplied clause. */
const MAX_BRACKET_WORDS = 8;

/** Editorial marks the model writes in brackets — about the page, not the term. */
const EDITORIAL_MARK = /^(?:sic|illegible|lacuna|gap|unclear|damaged|erased|missing|blank|torn|lost|deleted|struck out|text missing|word missing|corrupt(?:ed|ion)?|uncertain|untranslated|abbreviated|see|cf|vid|ibid|lat(?:in)?\.?|gr(?:eek)?\.?|heb(?:rew)?\.?)\b/i;

/**
 * Words a supplied clause opens with — `<term>Tiphereth</term> [is denoted]`, `<term>Batu</term>
 * [should judge it]`, `<term>monoculus</term> [it] completes`. A gloss of a term never does.
 */
const SUPPLIED_START = /^(?:when|where|whence|because|if|since|while|whereas|though|although|comes|come|came|goes|go|went|one|ones|someone|something|anyone|is|are|was|were|be|being|been|it|its|they|he|she|we|that|which|who|whom|this|these|those|in|into|to|of|and|or|nor|at|for|by|from|with|on|should|would|could|can|may|might|must|shall|will|has|had|have|does|did|do|not|as|so|then|there|here)$/i;

/** Verbs supplied after a speaker's name: `<term>Zisang Hu</term> [replied]`. */
const SUPPLIED_VERB = /^(?:said|says|say|replied|replies|reply|answered|answers|asked|asks|responded|responds|wrote|writes|continued|continues|declared|declares|spoke|speaks|explained|explains|added|adds|taught|teaches|commented|comments|objected|objects|states|stated|notes|noted|took|takes)$/i;

/**
 * The sentence is NAMING the term — `the stars astronomers have called <term>NEBULOSAE</term>
 * [nebulous]`, `For the term <term>Tamim</term> [perfect]`, `what it said <term>Ach</term> [but]`.
 * Only then is a bracket after a term read as its gloss: elsewhere it is, on a random draw of stored
 * v10–v13 pages, as often the noun the sentence needs (`hot <term>apathetic</term> [conditions]`,
 * `<term>cephalic</term> [vein]`) or the rest of a name (`<term>Vincentius</term> [Hispanus]`) as a gloss.
 */
const NAMING_CUE = /(?:^|[^\p{L}])(?:called|calls|call|named|name|names|termed|term|terms|word|words|said|says|means|meaning|known as|i\.e\.)[^\p{L}\p{N}]*$/iu;

/** `<term>X</term> [Y]` — not a markdown link `[Y](url)`, not a bracket that holds markup. */
const TERM_BRACKET = /(<term>[^<\n]*<\/term>)([ \t]?)\[([^[\]<>\n]+)\](?!\()/gi;

const words = (/** @type {string} */ s) => s.split(/\s+/).filter(Boolean).length;

/** Lower-cased letters only, for the respelling test. @param {string} s */
const letters = (s) => s.toLowerCase().normalize('NFD').replace(/[^\p{L}]/gu, '');

/** Levenshtein distance, small strings only. @param {string} a @param {string} b */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * The bracket respells the term — `<term>Fufina</term> [fusina]` (a long-s reading), `<term>Saphir</term>
 * [Sapphire]`. That is the translator's correction of the word, which stays in the sentence.
 * @param {string} term @param {string} body
 */
function respells(term, body) {
  const a = letters(term), b = letters(body);
  if (!a || !b) return false;
  return distance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 3));
}

/**
 * True when the bracket after a term is the model's gloss of it. Built for precision: a gloss
 * left in brackets still reads as the translator's (#4385), but a supplied word moved into a note
 * is a word gone from the sentence when notes are off.
 * @param {string} body  the bracket's content
 * @param {{ after?: string, before?: string, term?: string }} [ctx]
 *   after: text right after the bracket; before: text right before the `<term>`; term: the chip's text
 */
export function isBracketDefinition(body, { after = '', before = '', term = '' } = {}) {
  const b = body.trim();
  if (!b || words(b) > MAX_BRACKET_WORDS) return false;
  // A gloss opens with a word or a quote; `[?]`, `[…]`, `[3]`, `[fol. 12r]` do not.
  if (!/^["'‘“*_]*\p{L}/u.test(b)) return false;
  // A number makes it a reference — `[fol. 12r]`, `[ch. 3]`, `[Ps 37:35]`.
  if (/\p{N}/u.test(b)) return false;
  const bare = b.replace(/^["'‘“*_]+/, '');
  // `called <term>Atherfatha</term> [c]`: a supplied letter or two, not a gloss.
  if (letters(bare).length < 3) return false;
  if (EDITORIAL_MARK.test(bare)) return false;
  // `[said]:` / `[replied]:` — a bracket that leads into speech is part of the sentence.
  if (/^\s*:/.test(after)) return false;
  if (SUPPLIED_VERB.test(b)) return false;
  // One word in the past tense is the verb the sentence needs (`called <term>…</term> [emerged] from`);
  // a short word with a full stop is an abbreviation (`<term>Reitmohren</term> [Bav.]`).
  if (/^\p{L}+ed$/u.test(bare) || /^\p{L}{1,5}\.$/u.test(bare)) return false;
  if (term && respells(term, b)) return false;
  // Only where the sentence names the term. A capitalised bracket elsewhere is as often the rest of
  // a name the translator completed (`the <term>Clementine</term> [Constitutions]`, `<term>Vincentius</term>
  // [Hispanus]`, `<term>Innocentius</term> [IV]`, legal citations on stored v11 pages) as a gloss.
  if (!NAMING_CUE.test(before)) return false;
  // `the said <term>Clementine</term>`: legal Latin's "aforesaid", not a verb of naming.
  if (/(?:^|[^\p{L}])the\s+said[^\p{L}\p{N}]*$/iu.test(before)) return false;
  // `M.T. says <term>bustum</term> [is what] the Greeks call`: a supplied clause, even after a cue.
  return !SUPPLIED_START.test(bare.split(/\s+/)[0]);
}

/**
 * Shape 2: `<term>X</term> [definition]` → `<term>X</term> <note>definition</note>`.
 * @param {string} text
 * @returns {{ text: string, n: number }}
 */
export function bracketDefinitionsToNotes(text) {
  if (!text || !/<\/term>[ \t]?\[/i.test(text)) return { text, n: 0 };
  const inSpan = insideSpan(text);
  let n = 0;
  const out = text.replace(TERM_BRACKET, (whole, chip, _sp, body, offset) => {
    if (inSpan(offset)) return whole;
    const ctx = {
      after: text.slice(offset + whole.length, offset + whole.length + 3),
      // Tags out first: the `term` in a preceding `</term>` is not the word "term".
      before: text.slice(Math.max(0, offset - 80), offset).replace(/<[^<>]*>/g, ' '),
      term: chip.replace(/<\/?term>/gi, ''),
    };
    if (!isBracketDefinition(body, ctx)) return whole;
    n++;
    return `${chip} <note>${body.trim()}</note>`;
  });
  return { text: out, n };
}

/**
 * Both shapes, as stored. `n` counts what changed, for the writer's log line.
 * @param {string} text
 * @returns {{ text: string, n: { split: number, head_dropped: number, apparatus: number, in_span: number, bracket: number } }}
 */
export function guardTermDefinitions(text) {
  const shape1 = splitInlineTermDefinitions(text, { outsideSpans: true });
  const shape2 = bracketDefinitionsToNotes(shape1.text);
  return { text: shape2.text, n: { ...shape1.n, bracket: shape2.n } };
}

/** The guarded text alone, for a writer that does not log. @param {string} text */
export const guardTranslationText = (text) => (typeof text === 'string' ? guardTermDefinitions(text).text : text);
