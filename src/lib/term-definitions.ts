/**
 * Separate the translation model's own definitions from the `<term>` chips it
 * wraps them in, so every surface shows them as editorial notes (#5895).
 *
 * PRIOR ART: src/lib/notes-off.ts (`preprocessTerms`) — decides what a <term>
 * does when notes are hidden, but assumes the chip holds only the word, so a
 * definition inside it is unwrapped into body text. This pass runs before it.
 *
 * The prompt asks for `<term>X</term> <gloss>meaning</gloss>`. In practice the
 * model writes two shapes the reader mislabels (measured on 793 pages, #5700
 * comment of 2026-10-06):
 *
 *   1. The definition collapsed INTO the term — `<term>Geomancy: A method of
 *      divination that interprets markings on the ground…</term>` (5.9% of
 *      pages). With notes on it printed mid-sentence as a vocabulary chip; with
 *      notes off `preprocessTerms` unwrapped it, so the definition read as the
 *      book's own words. Here it becomes `<term>Geomancy</term> <note>A method
 *      of divination…</note>`, which notes-off hides and notes-on labels as an
 *      editorial note. When the head word already stands right before the chip
 *      (`**Geomancy** <term>Geomancy: …</term>`), only the note is kept —
 *      otherwise the head prints twice.
 *   2. A `<gloss>` straight after a `<term>`. `<gloss>` is the PAGE-MARK tag (a
 *      gloss printed in the original), so the reader titled the model's
 *      definition "Gloss/annotation in original". A gloss in that position is
 *      the model's, so it becomes a `<note>`.
 *
 * Display only: stored translations are not rewritten here (that is a data
 * decision, #5895 out-of-scope). Genuine long terms — mantras, titles — carry
 * no "head: definition" colon and pass through unchanged. Idempotent.
 */

/** Longest head (in words) still read as a term rather than a sentence. */
const MAX_HEAD_WORDS = 6;
/** A definition needs at least this many words, unless the chip as a whole is long. */
const MIN_DEFINITION_WORDS = 3;
/** A chip longer than this, with a colon, is a definition whatever its parts. */
const LONG_TERM_WORDS = 7;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Split `head: definition`, or null when the chip is a genuine term. */
export function splitTermDefinition(body: string): { head: string; definition: string } | null {
  // The colon must be followed by whitespace — "Genesis 1:3" is a reference, not a definition.
  const m = body.match(/^\s*([^:]+?)\s*:\s+([\s\S]+?)\s*$/);
  if (!m) return null;
  const [, head, definition] = m;
  if (words(head) > MAX_HEAD_WORDS) return null;
  // A definition opens with a word, not a verse or folio number.
  if (!/^[\p{L}"'‘“(]/u.test(definition)) return null;
  if (words(definition) < MIN_DEFINITION_WORDS && words(body) <= LONG_TERM_WORDS) return null;
  return { head, definition };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `before` ends with `head` (ignoring markdown emphasis), as a whole word. */
function headPrecedes(before: string, head: string): boolean {
  const tail = before.replace(/[\s*_]+$/, '');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(head)}$`, 'iu').test(tail);
}

export function separateTermDefinitions(text: string): string {
  if (!text || !/<term>/i.test(text)) return text;

  // Shape 1: a definition inside the chip. Single-line, tag-free bodies only —
  // anything nested is left to the span normaliser and rendered as before.
  const out = text.replace(/<term>([^<\n]*?)<\/term>/gi, (whole, body: string, offset: number) => {
    const split = splitTermDefinition(body);
    if (!split) return whole;
    const note = `<note>${split.definition}</note>`;
    return headPrecedes(text.slice(Math.max(0, offset - 200), offset), split.head)
      ? note
      : `<term>${split.head}</term> ${note}`;
  });

  // Shape 2: the model's gloss right after a term is commentary, not a page mark.
  return out.replace(
    /(<term>[^<]*?<\/term>)(\s*)<gloss(?:\s[^>]*)?>([\s\S]*?)<\/gloss>/gi,
    '$1$2<note>$3</note>'
  );
}
