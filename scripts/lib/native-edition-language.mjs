/**
 * Is a book WRITTEN in a given locale's language? — the .mjs side of the rule.
 *
 * The TS side is `NATIVE_EDITION_LANGUAGE` / `isNativeEdition` in
 * `src/lib/localized.ts` (#4120). Node scripts cannot import the TS module, so
 * the pattern lives here ONCE and every script imports it — rather than each
 * growing its own copy, which is how `sync-es-collection.mjs`,
 * `embed-book-page-texts.mjs` and the next caller would drift apart the first
 * time a spelling is added to one of them.
 *
 * **Change this together with `NATIVE_EDITION_LANGUAGE` in src/lib/localized.ts.**
 *
 * ANCHORED on purpose. The stored `books.language` values it must REFUSE are
 * real ones: "Spanish / Latin", "Spanish / French", "Nahuatl-Spanish", "Old
 * Spanish" and "Spanish in Hebrew characters" — Judeo-Spanish in Hebrew script,
 * which a Spanish reader cannot read at all and which a substring match would
 * happily claim. A bilingual edition is its own question: only part of the page
 * is the language, so any promise made about the whole page is half-kept.
 */

export const NATIVE_EDITION_LANGUAGE = {
  es: /^\s*(spanish|espa(?:ñ|n)ol|castellano|castilian)\s*$/i,
};

/** True when `bookLanguage` means the text already IS `lang`. */
export function isNativeEditionLanguage(bookLanguage, lang) {
  const pattern = NATIVE_EDITION_LANGUAGE[lang];
  return !!pattern && typeof bookLanguage === 'string' && pattern.test(bookLanguage);
}

/** Mongo fragment: books readable in `lang` — translated into it, or written in it. */
export function localizedEditionFilter(lang) {
  return {
    $or: [
      { [`pages_translated_${lang}`]: { $gt: 0 } },
      { language: NATIVE_EDITION_LANGUAGE[lang] },
    ],
  };
}

/**
 * Mongo fragment: books the `page_texts` store should hold text for in `lang`.
 *
 * NOT the same question as `localizedEditionFilter`, which answers "can a reader
 * read this in `lang`" and leaves visibility to each caller. This one answers
 * "would the writer embed it", so it carries the two guards the writer needs: a
 * native edition must be `visible` (we do not embed hidden books) and must have
 * `pages_ocr > 0`, since for a native edition the OCR *is* the text.
 *
 * It exists because the WRITER and its AUDIT have to select the same set. When
 * the worker built this inline and `page-texts-coverage.mjs` selected on the
 * counter alone, the audit left every native book out of its own denominator
 * and would have reported clean over the exact state #4146 described. Two
 * copies of a selector disagree the first time one of them is corrected — which
 * is the whole reason this module exists (see the header).
 */
export function embeddableEditionFilter(lang) {
  const pattern = NATIVE_EDITION_LANGUAGE[lang];
  return {
    $or: [
      { [`pages_translated_${lang}`]: { $gt: 0 } },
      // Only for a language we have a native pattern for; otherwise the counter
      // remains the whole rule, exactly as it was before #4146.
      ...(pattern ? [{ language: pattern, visible: true, pages_ocr: { $gt: 0 } }] : []),
    ],
  };
}
