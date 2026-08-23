import type { Locale } from '@/lib/locale-path';

/**
 * Localized METADATA — titles, collection names, intros — for non-English surfaces.
 *
 * The rule (see .claude/docs/i18n.md): one language-keyed map per record, never
 * a per-language column. `pages.translations.es` set the pattern for page text;
 * these are the same shape for the words around it:
 *
 *   books.localized       = { es: { title }, fr: { title } }
 *   collections.localized = { es: { name, subtitle, description } }
 *
 * English stays where it always was — `books.display_title` is the English
 * gloss, `collections.name/subtitle/description` the English copy — so `en`
 * is never written into the map. The ORIGINAL title (`books.title`) is the
 * bibliographic identity and is never localized; a gloss sits beside it.
 *
 * Written by scripts/maintenance/localize-metadata.mjs. All read paths go
 * through the helpers below so a surface can never half-localize.
 */

export interface LocalizedBookFields {
  /** Gloss of the title in this language (what English keeps in display_title). */
  title?: string;
  /** Short book summary in this language (from index.bookSummary.brief / summary). */
  summary?: string;
  /** Chapter titles in this language, aligned by index with books.chapters[]. */
  chapters?: string[];
}

export interface LocalizedCollectionFields {
  name?: string;
  subtitle?: string;
  description?: string;
}

export type LocalizedBookMap = Partial<Record<Exclude<Locale, 'en'>, LocalizedBookFields>>;
export type LocalizedCollectionMap = Partial<Record<Exclude<Locale, 'en'>, LocalizedCollectionFields>>;

type BookLike = { title?: string | null; display_title?: string | null; localized?: LocalizedBookMap | null };

/**
 * The title to SHOW for `lang`: the language's gloss, else the English gloss
 * for English, else the original. Never returns empty.
 */
export function localizedTitle(book: BookLike, lang: Locale): string {
  if (lang !== 'en') {
    const gloss = book.localized?.[lang]?.title;
    if (gloss) return gloss;
    // No gloss yet in this language: fall back to the ORIGINAL, not the English
    // gloss — an English title under Spanish chrome is the wrong half-measure.
    return book.title || book.display_title || '';
  }
  return book.display_title || book.title || '';
}

/**
 * The original title when it differs from what localizedTitle() shows, for the
 * small line under a glossed title. Null when they are the same string.
 */
export function originalTitleIfDifferent(book: BookLike, lang: Locale): string | null {
  const shown = localizedTitle(book, lang);
  const original = book.title || '';
  return original && original !== shown ? original : null;
}

/**
 * Per-language page-text counters on `books`. Declared in
 * `scripts/lib/book-docs.mjs`; one field per language, written by
 * `scripts/maintenance/sync-pages-translated-es.mjs`.
 */
const TRANSLATED_COUNTER: Record<Exclude<Locale, 'en'>, string> = {
  es: 'pages_translated_es',
};

/**
 * `books.language` values whose ORIGINAL text is already in a locale.
 *
 * A book WRITTEN in Spanish has no `pages_translated_es` and never will — you
 * do not pivot Spanish into Spanish — so a counter-only test scores it zero and
 * hides the most Spanish thing we own from every /es surface. 67 live books
 * were in exactly that position when this was added.
 *
 * ANCHORED on purpose. The stored values it must REFUSE are real ones:
 * "Spanish / Latin", "Spanish / French", "Nahuatl-Spanish", "Old Spanish", and
 * "Spanish in Hebrew characters" — Judeo-Spanish in Hebrew script, which a
 * Spanish reader cannot read at all and which a substring match would happily
 * claim. A half-Spanish page is a weaker promise than `/es` makes, and a
 * bilingual edition is its own question (the Ximénez Popol Vuh carries K'iche'
 * and Spanish in parallel columns and is catalogued under K'iche'). Widen this
 * only with a decision about what a bilingual page owes a Spanish reader.
 *
 * ONE pattern, exported, because the same set has to be selected in Mongo
 * (`{ language: NATIVE_EDITION_LANGUAGE.es }`) and tested in JS. Two copies of
 * this rule would drift the moment a spelling is added to one of them.
 */
export const NATIVE_EDITION_LANGUAGE: Record<Exclude<Locale, 'en'>, RegExp> = {
  es: /^\s*(spanish|espa(?:ñ|n)ol|castellano|castilian)\s*$/i,
};

/** Is the book's own text already in `lang` (no translation involved)? */
export function isNativeEdition(book: Record<string, unknown>, lang: Locale): boolean {
  if (lang === 'en') return false; // English is the root; hasLocalizedEdition short-circuits it
  const pattern = NATIVE_EDITION_LANGUAGE[lang];
  const language = book?.language;
  return !!pattern && typeof language === 'string' && pattern.test(language);
}

/**
 * Mongo fragment for "this book exists in `lang`" — native original OR
 * translated pages. Use this wherever a surface selects books for a localized
 * page, so the query and `hasLocalizedEdition` below can never disagree.
 */
export function localizedEditionFilter(lang: Exclude<Locale, 'en'>): Record<string, unknown> {
  return {
    $or: [
      { [TRANSLATED_COUNTER[lang]]: { $gt: 0 } },
      { language: NATIVE_EDITION_LANGUAGE[lang] },
    ],
  };
}

/**
 * Does this book actually EXIST in `lang`?
 *
 * A localized URL is a promise that the page is in that language, so this is
 * the gate on whether `/es/book/<slug>` may exist at all — not a display
 * preference. English is always true (it is the root). For any other language
 * it means the book's PAGES are in it, which happens two ways: they were
 * TRANSLATED into it (`pages_translated_<iso> > 0`), or they were WRITTEN in it
 * (`NATIVE_EDITION_LANGUAGE`). Either way the promise `/es` makes is kept. A
 * title gloss alone is still chrome, not an edition.
 *
 * Returns `null` when the payload cannot answer — a hand-built card object, a
 * narrowed API select, anything carrying neither input. (The Supabase catalog
 * fast-path carries both since #4166; it carried only `language` before, which
 * is worse than carrying neither: half a signal answers confidently and
 * wrongly.) Callers must treat `null`
 * as "ask, or do nothing", NEVER as false: reading an absent field as "no
 * Spanish edition" would 307 a genuinely Spanish book to English, which is the
 * absence-is-not-failure trap this codebase keeps re-learning. Note both fields
 * must be PROJECTED for a false to mean anything — see the tail of the body.
 */
export function hasLocalizedEdition(
  book: Record<string, unknown>,
  lang: Locale,
): boolean | null {
  if (lang === 'en') return true;
  const field = TRANSLATED_COUNTER[lang];
  if (!field) return false;
  // Written in the language: the pages already ARE it, no counter involved.
  if (isNativeEdition(book, lang)) return true;
  const value = book[field];
  if (value === undefined) return null;
  if (typeof value === 'number' && value > 0) return true;
  // The counter says no. That only settles it if we could also SEE that the
  // book is not a native edition — with `language` unprojected we cannot, and
  // answering false here would 307 a genuinely Spanish book to English, the
  // exact failure the paragraph above warns about. Say "cannot answer" instead;
  // callers re-ask Atlas with both fields projected.
  return book.language === undefined ? null : false;
}

type CollectionLike = {
  name?: string; subtitle?: string; description?: string;
  localized?: LocalizedCollectionMap | null;
};

/** Collection copy for `lang`, with a flag per field saying whether it fell back to English. */
export function localizedCollection(doc: CollectionLike, lang: Locale): {
  name: string; subtitle?: string; description?: string; descriptionIsEnglish: boolean;
} {
  const l = lang === 'en' ? undefined : doc.localized?.[lang];
  return {
    name: l?.name || doc.name || '',
    // A localized name with no localized subtitle: drop the English subtitle
    // rather than mix languages on one line.
    subtitle: l?.subtitle || (l?.name ? undefined : doc.subtitle),
    description: l?.description || doc.description,
    descriptionIsEnglish: lang !== 'en' && !l?.description && !!doc.description,
  };
}
