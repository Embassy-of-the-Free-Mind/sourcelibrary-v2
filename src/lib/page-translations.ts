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
