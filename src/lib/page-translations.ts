import type { Page, TranslationData } from '@/lib/types/page';

/**
 * Language-keyed translation access (#2835).
 *
 * The general model for non-English content translations is the
 * `pages.translations` map (ISO code → TranslationData). It supersedes the
 * one-off `pages.translation_es` field. During migration both may exist, so all
 * READ paths go through these helpers — they fold the legacy `translation_es`
 * into the unified view (the map wins if a language is present in both).
 *
 * English is NOT in this map; it lives on `pages.translation` (the pivot base).
 * These helpers cover the *other* target languages a reader can switch to.
 */

/** Human-facing language names by ISO 639-1 code (extend as languages ship). */
export const TARGET_LANGUAGE_NAMES: Record<string, string> = {
  es: 'Español',
  zh: '中文',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
  it: 'Italiano',
  ar: 'العربية',
};

/**
 * The ISO codes a book-level EDITION counter can exist for —
 * `books.pages_translated_<iso>`, written by that language's translation worker.
 *
 * Derived from the language-name table above so the two cannot drift: a
 * language a reader can be offered is a language whose counter we look for.
 * English is not here; its counter is the unsuffixed `pages_translated`.
 */
export const TEXT_EDITION_LANGS: string[] = Object.keys(TARGET_LANGUAGE_NAMES);

/** Mongo projection for every edition counter, for `editionsForBook` below. */
export const EDITION_COUNTER_PROJECTION: Record<string, 1> = {
  pages_translated: 1,
  ...Object.fromEntries(TEXT_EDITION_LANGS.map((l) => [`pages_translated_${l}`, 1])),
};

/**
 * Which editions of a book's text exist, and how many pages each covers:
 * `{ en: 357, es: 357 }`. Languages with no pages are omitted — a key with a
 * zero would read as "we have a Spanish edition, it's empty", which is the
 * opposite of true.
 *
 * The counters are the source of truth here rather than a per-page scan,
 * because they are what every other surface gates on (the `/es` 307, the card
 * tag, the derived collection). A caller comparing this against page-level
 * results is comparing the same number the reader's URL was judged by.
 */
export function editionsForBook(book: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const en = Number(book.pages_translated || 0);
  if (en > 0) out.en = en;
  for (const l of TEXT_EDITION_LANGS) {
    const n = Number(book[`pages_translated_${l}`] || 0);
    if (n > 0) out[l] = n;
  }
  return out;
}

/**
 * All non-English translations available for a page, keyed by ISO code.
 * Folds the legacy `translation_es` into the map (map entry wins on conflict).
 */
export function availableTranslations(page: Pick<Page, 'translations' | 'translation_es'>): Record<string, TranslationData> {
  const out: Record<string, TranslationData> = {};
  // Legacy first so an explicit map entry overrides it.
  if (page.translation_es?.data) out.es = page.translation_es;
  if (page.translations) {
    for (const [lang, data] of Object.entries(page.translations) as [string, TranslationData][]) {
      if (data?.data) out[lang] = data;
    }
  }
  return out;
}

/** Get one language's translation (map preferred, legacy es fallback). Null if absent. */
export function getTranslation(
  page: Pick<Page, 'translations' | 'translation_es'>,
  lang: string,
): TranslationData | null {
  if (page.translations?.[lang]?.data) return page.translations[lang];
  if (lang === 'es' && page.translation_es?.data) return page.translation_es;
  return null;
}

/** ISO codes a page can be read in (excludes English). */
export function availableLanguageCodes(page: Pick<Page, 'translations' | 'translation_es'>): string[] {
  return Object.keys(availableTranslations(page));
}

/** True if a page has any non-English translation. */
export function hasAnyTranslation(page: Pick<Page, 'translations' | 'translation_es'>): boolean {
  return availableLanguageCodes(page).length > 0;
}
