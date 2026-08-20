import type { Locale } from '@/lib/i18n';

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
