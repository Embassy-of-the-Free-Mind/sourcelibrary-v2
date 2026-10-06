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
 *   2. A bracketed definition straight after a chip — `<term>Tamim</term>
 *      [perfect]` → `<term>Tamim</term> <note>perfect</note>`. The note-free
 *      prompt wrote 13 of these on 3 of 40 pages (#5919). Single brackets are
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
const EDITORIAL_MARK = /^(?:sic|illegible|lacuna|gap|unclear|damaged|erased|missing|blank|torn|lost|deleted|struck out|text missing|word missing|corrupt(?:ed|ion)?|uncertain|untranslated|abbreviated|lat(?:in)?\.?|gr(?:eek)?\.?|heb(?:rew)?\.?)\b/i;

/** Verbs supplied after a speaker's name: `<term>Zisang Hu</term> [replied]`. */
const SUPPLIED_VERB = /^(?:said|says|say|replied|replies|reply|answered|answers|asked|asks|responded|responds|wrote|writes|continued|continues|declared|declares|spoke|speaks|explained|explains|added|adds|taught|teaches|commented|comments|objected|objects|is|was|are|were|be|has|had|have)$/i;

/** `<term>X</term> [Y]` — not a markdown link `[Y](url)`, not a bracket that holds markup. */
const TERM_BRACKET = /(<term>[^<\n]*<\/term>)([ \t]?)\[([^[\]<>\n]+)\](?!\()/gi;

const words = (/** @type {string} */ s) => s.split(/\s+/).filter(Boolean).length;

/**
 * True when the bracket after a term is the model's gloss of it.
 * @param {string} body  the bracket's content
 * @param {string} after the text right after the closing bracket
 */
export function isBracketDefinition(body, after = '') {
  const b = body.trim();
  if (!b || words(b) > MAX_BRACKET_WORDS) return false;
  // A gloss opens with a word or a quote; `[?]`, `[…]`, `[3]`, `[fol. 12r]` do not.
  if (!/^["'‘“*_]*\p{L}/u.test(b)) return false;
  // A number makes it a reference — `[fol. 12r]`, `[ch. 3]`, `[Ps 37:35]`.
  if (/\p{N}/u.test(b)) return false;
  if (EDITORIAL_MARK.test(b.replace(/^["'‘“*_]+/, ''))) return false;
  if (SUPPLIED_VERB.test(b)) return false;
  // `[said]:` / `[replied]:` — a bracket that leads into speech is part of the sentence.
  if (/^\s*:/.test(after)) return false;
  return true;
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
    const after = text.slice(offset + whole.length, offset + whole.length + 3);
    if (!isBracketDefinition(body, after)) return whole;
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
