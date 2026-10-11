/**
 * The edition-vs-work language distinction, as machine-readable apparatus (#3942).
 *
 * `books.language` is the MANIFESTATION language — what is printed on the leaves
 * this scan holds (the contract set by `resolveLanguage` in
 * `src/lib/resolve-language.ts`, #2185). `books.original_language` names the
 * language of the WORK, and is set only when the two differ.
 *
 * Every MCP surface used to serve the first scalar under the name
 * `original_language`, which is exactly backwards for a translation: de Slane's
 * 1863 French Muqaddimah returned "Arabic" beside a page of French, so a caller
 * citing it for non-European sourcing was quoting English←French←Arabic without
 * anything in the response saying so. The flattening is the defect — a wrong
 * catalogue value is one book, a surface that cannot express the difference is
 * every book.
 *
 * Naming: `edition_language` / `work_language` rather than reusing
 * `original_language`, because "original" is the word that caused the confusion.
 * On a translated edition the page's `original` field (the OCR of the leaf) is
 * the original *of this edition*, not of the work.
 */
import { displayLanguage, sameLanguage } from '@/lib/language-utils';

export interface LanguageApparatusSource {
  language?: string | null;
  original_language?: string | null;
  text_role?: string | null;
  /** Who set `text_role` — `heuristic-v1`, `import-heuristic-v1`, `human-qa-*`, … */
  text_role_source?: string | null;
  is_translation?: boolean | null;
}

export interface LanguageApparatus {
  /** Language printed on the leaves of THIS scan. */
  edition_language: string | null;
  /** Language of the work, when known and different from the edition. */
  work_language?: string;
  /** original | period-translation | modern-translation, when classified. */
  text_role?: string;
  /**
   * Present only when `text_role` is "original" by DEFAULT rather than by
   * review — which is nearly every "original" in the corpus (#4441).
   */
  text_role_note?: string;
  /** Present only on a translated edition — states the chain in words. */
  translation_note?: string;
}

const TRANSLATION_ROLES = new Set(['period-translation', 'modern-translation']);

/**
 * `text_role: "original"` is what classify-text-role.mjs (and its import twin,
 * src/lib/text-role.ts) assign to EVERY non-English scan and to every English
 * book with no translation signal in its title/author. Measured on live books
 * 2026-10-11: of ~41.5K "original" values, all but ~20 came from
 * `heuristic-v1` / `import-heuristic-v1` or carry no source at all. Risner's
 * 1572 Latin Alhazen is "original" by that rule — a Latin edition of a work
 * composed in Arabic (#4441). So a heuristic "original" means "not classified
 * as a translation", and serving it bare reads as a scholarly claim.
 */
function isDefaultedOriginal(role: string | undefined, source: string | null | undefined): boolean {
  if (role !== 'original') return false;
  return !source || /heuristic/i.test(source);
}

export const DEFAULTED_ORIGINAL_NOTE =
  'text_role "original" on this record is a default, not a classification: the metadata heuristic ' +
  'assigns it to every non-English scan and to every English book whose title and author show no ' +
  'translation signal, and nobody has checked it against the work. It is NOT evidence that these pages ' +
  'are in the language the work was written in, or are the author\'s own words. The work\'s own language ' +
  'is not recorded on this record. Before citing a passage as the author\'s wording, establish the ' +
  'language of composition independently; list_editions shows other witnesses of the same work.';

/**
 * Build the apparatus block for a book record. Returns an object meant to be
 * spread into a response.
 *
 * `work_language` and `translation_note` are omitted rather than nulled when
 * they don't apply — `work_language: null` invites a caller to render "null".
 * An absent `work_language` means NOT RECORDED, never "same as the edition":
 * `original_language` is set on under a tenth of live books, so its absence is
 * the normal state of a translated edition too (#4441).
 */
export function languageApparatus(book: LanguageApparatusSource): LanguageApparatus {
  const edition = displayLanguage(book.language) || null;
  const workRaw = displayLanguage(book.original_language) || null;
  // A work language equal to the edition language carries no information — the
  // FRBR work and manifestation coincide. resolveLanguage() already drops these
  // at import; older records predate it, so drop it here too.
  const work = workRaw && (!edition || !sameLanguage(workRaw, edition)) ? workRaw : null;

  const role = typeof book.text_role === 'string' && book.text_role ? book.text_role : undefined;
  // A record can evidence a translation three ways, and the weakest of them
  // (a work language that differs) is the one present on the oldest rows.
  const isTranslation = book.is_translation === true || (role ? TRANSLATION_ROLES.has(role) : false) || !!work;

  const apparatus: LanguageApparatus = { edition_language: edition };
  if (work) apparatus.work_language = work;
  // A record stamped "original" that also evidences a translation (a differing
  // work language, or is_translation: true) contradicts itself — ~200 live
  // books at the time of #4441. The translation evidence is specific; the
  // "original" is almost always the classifier's default. Serve the evidence
  // and withhold the label, so "original" never sits beside a translation_note.
  if (role && !(role === 'original' && isTranslation)) {
    apparatus.text_role = role;
    if (isDefaultedOriginal(role, book.text_role_source)) apparatus.text_role_note = DEFAULTED_ORIGINAL_NOTE;
  }

  if (isTranslation) {
    apparatus.translation_note = work && edition
      ? `The pages of this edition are in ${edition}; the work was written in ${work}. Text quoted from the \`original\` field is ${edition} — a translation, not the author's own words. Any English translation we serve is therefore English←${edition}←${work}. Say so when citing this for the work's own wording.`
      : edition
        ? `This edition is a translation into ${edition}, not the work's original language. Text quoted from the \`original\` field is the ${edition} translator's wording, not the author's. The work's own language is not recorded on this record.`
        : 'This edition is a translation; the language of the work is not recorded on this record.';
  }

  return apparatus;
}

/**
 * The apparatus MINUS `edition_language`, for responses that already serve the
 * edition language under its own name (the quote API's `quote.language`).
 * Spreading this keeps one source of truth for the note's wording rather than
 * letting each surface phrase the chain its own way.
 */
export function languageApparatusFields(
  book: LanguageApparatusSource
): Omit<LanguageApparatus, 'edition_language'> {
  const { edition_language: _edition, ...rest } = languageApparatus(book);
  void _edition;
  return rest;
}

/**
 * The language pair for a scholarly edition's `citation` block (#3959).
 *
 * `editions[].citation.original_language` predates this vocabulary and means
 * something narrower than its name suggests: the language of the leaves WE
 * translated from. On de Slane's French *Muqaddimah* that is "French", which is
 * a true statement about our English translation's source and says nothing about
 * the work being Arabic. So the field is under-specified, not wrong.
 *
 * It is also persisted into `books.editions[]` and travels into minted DOI
 * citation payloads, so the fix is strictly ADDITIVE:
 *
 *  - `original_language` is passed through VERBATIM from `books.language`, with
 *    no normalisation. Running it through `displayLanguage()` would rewrite
 *    "lat" to "Latin" and "Ancient Greek" to "Greek" on every future edition,
 *    silently changing what an already-published citation series claims.
 *  - `work_language` is new, normalised, and omitted when it carries no
 *    information — so a citation for a translation-of-a-translation can state
 *    the whole chain while historic rows keep reading exactly as minted.
 *
 * TWIN FILE: scripts/lib/edition-citation-language.mjs mirrors this function for
 * the batch DOI minters (node can't import .ts). Keep the two in lockstep, like
 * scripts/lib/r2-key.mjs + src/lib/r2-key.ts.
 */
export interface CitationLanguageFields {
  /** Language of the leaves this English translation was made FROM. Verbatim. */
  original_language: string;
  /** Language of the WORK, when it differs from the translation source. */
  work_language?: string;
}

export function citationLanguageFields(book: LanguageApparatusSource): CitationLanguageFields {
  const fields: CitationLanguageFields = { original_language: book.language ?? '' };
  const { work_language } = languageApparatus(book);
  if (work_language) fields.work_language = work_language;
  return fields;
}

/**
 * True when a caller quoting this book's `original` field would be quoting a
 * translator rather than the author — the case the citation apparatus has to
 * disclose.
 */
export function servesTranslatedOriginal(book: LanguageApparatusSource): boolean {
  return !!languageApparatus(book).translation_note;
}
