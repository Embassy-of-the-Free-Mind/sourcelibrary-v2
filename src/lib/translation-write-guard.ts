/**
 * Write-time guard for the model's definitions in a new translation (#5902): a
 * definition inside a `<term>`, or bracketed straight after one, is stored as a
 * `<note>`.
 *
 * PRIOR ART: scripts/lib/translation-write-guard.mjs — the rule lives there, ONE
 * copy, shared with the scripts-side writers (translate-core, translate-worker,
 * the batch collectors). This file only gives it its `@/lib` name (the
 * arrangement of src/lib/term-definitions.ts).
 */
export {
  guardTranslationText,
  guardTermDefinitions,
  bracketDefinitionsToNotes,
  isBracketDefinition,
} from '../../scripts/lib/translation-write-guard.mjs';
