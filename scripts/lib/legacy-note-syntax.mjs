/**
 * The reader's rules for the LEGACY note syntaxes (#5942): single-bracket interpolations, bracketed image
 * paragraphs, and the `[[label: …]]` blocks of the 2025-12 prompts. One definition, imported by the reader
 * (src/components/reader/NotesRenderer.tsx) and by the notes-layer parser (scripts/lib/annotation-layer.mjs),
 * so the stored `translation.text` hides exactly what the reader hides.
 *
 * PRIOR ART: these regexes and `looksLikeImageDescription` lived in NotesRenderer.tsx (#4298, #4385), where an
 * .mjs script cannot import them; they are moved here verbatim (the reader's behaviour does not change; its
 * tests in tests/unit/bracketed-image-descriptions.test.ts and translator-interpolations.test.ts still pin it).
 * scripts/lib/leaked-markup.mjs is the precedent for a scripts/lib module the reader imports.
 *
 * Pure: no I/O.
 */

// A paragraph that is nothing but one single-bracket run: blank line (or start)
// before, blank line (or end) after, no nesting, single line.
export const BRACKETED_PARAGRAPH = /(^|\n[ \t]*\n)[ \t]*\[([^\[\]\n]{3,})\][ \t]*(?=\n[ \t]*\n|\n?$)/g;

// The noun that makes a bracketed paragraph a picture, not a stage direction.
const PICTORIAL_NOUN = /^(?:woodcuts?|wood-?blocks?|engravings?|etchings?|illustrations?|images?|pictures?|diagrams?|figures?|emblems?|head-?pieces?|tail-?pieces?|vignettes?|ornaments?|fleurons?|initials?|frontispieces?|portraits?|plates?|drawings?|sketch(?:es)?|maps?|charts?|borders?|cartouches?|seals?|miniatures?|illuminations?)$/i;

// What may follow the noun: the start of a description, or nothing at all.
// A bare number is a reference ("[Figure 3]") and stays an interpolation; a
// numbered caption ("Illustration 35: …", "Plate III and VI.") is a picture.
const DESCRIPTION_TAIL = /^(?:$|[:,.;—–-]|\s+[0-9IVXLC]+[a-z]?(?:[:.]|\s+and\b)|\s+(?:of|with|showing|shows|depicting|depicts|containing|contains|featuring|illustrating|representing|labell?ed|in|on|at|from|after|and|centred|centered|printed|framed|surrounded|spanning|occupying|description|omitted|caption)\b)/i;

// Words that open a sentence rather than modify a noun: "[Therefore the figure of
// the Sun …]" is the author speaking, whatever noun follows.
const NOT_A_MODIFIER = new Set(['in', 'that', 'this', 'these', 'those', 'when', 'therefore', 'it', 'he', 'she', 'they', 'we', 'i', 'is', 'was', 'are', 'were', 'for', 'and', 'but', 'if', 'as', 'so', 'which', 'who', 'then', 'thus', 'here', 'there', 'now', 'not', 'no', 'to', 'from', 'by', 'at', 'on', 'see', 'cf', 'note']);

/**
 * True when a bracketed paragraph opens with a picture's noun phrase:
 * an optional article, up to three modifiers, a pictorial noun, then a
 * description or the end ("Ornate woodcut headpiece with floral motifs",
 * "Engraving of a man's head", "Diagram: A vertical section").
 * @param {string} inner
 */
export function looksLikeImageDescription(inner) {
  const words = inner.trim().split(/\s+/);
  let i = /^(?:an?|the)$/i.test(words[0] ?? '') ? 1 : 0;
  for (let mods = 0; i < words.length && mods <= 3; i++, mods++) {
    const word = words[i].replace(/[:,.;]$/, '');
    if (NOT_A_MODIFIER.has(word.toLowerCase())) return false;
    // Whatever follows the bare noun, its own trailing punctuation included. A
    // noun followed by another word is a modifier ("woodcut headpiece"): go on.
    if (PICTORIAL_NOUN.test(word) && DESCRIPTION_TAIL.test(words.slice(i).join(' ').slice(word.length))) {
      return true;
    }
    if (!/^[A-Za-z'’-]+,?$/.test(word)) return false;
  }
  return false;
}

// Single-bracket runs are the translator speaking — supplied words and stage
// directions ("[that is, Mercury]", "[The remainder is blank]"). Conservative
// match: single line, no nesting, never a markdown link ("[text](url)").
export const INTERP_PATTERN = /(?<!\[)\[([^\[\]\n]{1,240})\](?!\]|\()/g;

/** A lacuna mark such as "[…]" reports missing text, not commentary: it always survives. */
export const isLacunaMark = (inner) => /^[\s.…·—–-]*$/.test(inner);
