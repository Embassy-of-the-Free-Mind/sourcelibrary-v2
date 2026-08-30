/**
 * The language pair for a scholarly edition's `citation` block (#3959).
 *
 * WHY THIS EXISTS
 * ---------------
 * `editions[].citation.original_language` predates the edition-vs-work
 * vocabulary and means something narrower than its name suggests: the language
 * of the leaves WE translated from. On de Slane's French *Muqaddimah* that is
 * "French" — a true statement about our English translation's source, and one
 * that says nothing about the work being Arabic. The field is therefore
 * under-specified, not wrong, and the reader of a DOI citation cannot tell which
 * sense is meant.
 *
 * THE INVARIANT
 * -------------
 * This block is persisted into `books.editions[]` and travels into minted DOI
 * citation payloads, so the fix is strictly ADDITIVE:
 *
 *  - `original_language` is passed through VERBATIM from `books.language`, with
 *    no normalisation. Normalising it would rewrite "lat" to "Latin" and
 *    "Ancient Greek" to "Greek" on every future edition, silently changing what
 *    an already-published citation series claims.
 *  - `work_language` is new, normalised, and omitted when it carries no
 *    information — so a citation for a translation-of-a-translation can state
 *    the whole chain while historic rows keep reading exactly as minted.
 *
 * Naming follows src/lib/edition-language.ts (#3942): `work_language`, not a
 * second use of "original", because "original" is the word that caused the
 * confusion in the first place.
 *
 * TWIN FILE: src/lib/edition-language.ts holds `citationLanguageFields()` for
 * TS/src consumers (node can't import .ts, Next can't import .mjs scripts).
 * Keep the two in lockstep, like scripts/lib/r2-key.mjs + src/lib/r2-key.ts.
 *
 * The comparison — the load-bearing decision, "are these two the same language?"
 * — is delegated to `canonicalLanguage()` in ./source-language-match.mjs rather
 * than re-tabulating the code→name mappings here. One alias table, one place to
 * fix it. A token neither table resolves falls back to the title-cased raw
 * string, which is what displayLanguage() does on the same input.
 */
import { canonicalLanguage } from './source-language-match.mjs';

/**
 * Tokens that mean "no usable language signal" — mirrors PLACEHOLDER_LANGS in
 * src/lib/language-utils.ts. A placeholder must never be emitted as a work
 * language: "the work was written in unknown" is worse than saying nothing.
 */
const PLACEHOLDER_LANGS = new Set([
  'none', 'n/a', 'na', 'unknown', 'und', 'null', '', 'multiple', 'mul',
  'mixed', 'various', 'zxx', 'undetermined',
]);

/** Historical-register prefixes displayLanguage() strips before comparing. */
const REGISTER_PREFIX = /^(modern|ancient|old|classical|medieval|middle|early)\s+/;

function titleCase(value) {
  return value.replace(/\b[a-z]/g, c => c.toUpperCase());
}

/**
 * Normalise a raw language token to a canonical display name, or null when it
 * carries no signal. Mirrors displayLanguage() in src/lib/language-utils.ts.
 */
function displayLanguage(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toLowerCase().trim().replace(REGISTER_PREFIX, '');
  if (!cleaned || PLACEHOLDER_LANGS.has(cleaned)) return null;
  const canonical = canonicalLanguage(cleaned);
  return titleCase(canonical || cleaned);
}

/**
 * Build the `original_language` / `work_language` pair for a citation block.
 *
 * `work_language` is emitted only when the work's language is known AND differs
 * from the language we translated from. Equal languages carry no information
 * (the FRBR work and manifestation coincide), and an absent field reads as "this
 * edition is in the work's own language" — whereas `work_language: null` invites
 * a citation renderer to print "null".
 */
export function citationLanguageFields(book) {
  const fields = { original_language: book.language ?? '' };

  const edition = displayLanguage(book.language);
  const work = displayLanguage(book.original_language);
  if (work && (!edition || work.toLowerCase() !== edition.toLowerCase())) {
    fields.work_language = work;
  }

  return fields;
}
