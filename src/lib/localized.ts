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
 * Does this book actually EXIST in `lang`?
 *
 * A localized URL is a promise that the page is in that language, so this is
 * the gate on whether `/es/book/<slug>` may exist at all — not a display
 * preference. English is always true (it is the root). For any other language
 * it means the book's PAGES have been translated: a title gloss alone is
 * chrome, not an edition.
 *
 * Returns `null` when the payload cannot answer — the counter is a Mongo field
 * and the Supabase catalog fast-path does not carry it. Callers must treat
 * `null` as "ask, or do nothing", NEVER as false: reading an absent field as
 * "no Spanish edition" would 307 a genuinely Spanish book to English, which is
 * the absence-is-not-failure trap this codebase keeps re-learning.
 */
export function hasLocalizedEdition(
  book: Record<string, unknown>,
  lang: Locale,
): boolean | null {
  if (lang === 'en') return true;
  const field = TRANSLATED_COUNTER[lang];
  if (!field) return false;
  const value = book[field];
  if (value === undefined) return null;
  return typeof value === 'number' && value > 0;
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
