/**
 * Separate the translation model's own definitions from the `<term>` chips it
 * wraps them in, so every surface shows them as editorial notes (#5895).
 *
 * PRIOR ART: src/lib/notes-off.ts (`preprocessTerms`) — decides what a <term>
 * does when notes are hidden, but assumes the chip holds only the word, so a
 * definition inside it is unwrapped into body text. This pass runs before it.
 *
 * The rule itself lives in scripts/lib/term-definitions.mjs — ONE copy, shared
 * with the stored-text cleanup that rewrites `translation.data` by the same
 * rule (#5901). Change it there; this file only gives it its `@/lib` name.
 */
export {
  splitTermDefinition,
  splitInlineTermDefinitions,
  separateTermDefinitions,
} from '../../scripts/lib/term-definitions.mjs';
