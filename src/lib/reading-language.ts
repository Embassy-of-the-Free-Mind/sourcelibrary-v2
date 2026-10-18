/**
 * Reading language = the URL prefix. Nothing else. (#4112)
 *
 * Spanish lives at `/es/…`, English at the root. A `/book/…` URL is an English
 * page and renders English; `/es/book/…` renders Spanish. The reader's EN/ES
 * control is a LINK between those two URLs, not a view toggle, so the address
 * bar always says which language you are reading and every reading URL is
 * shareable, indexable and edge-cacheable as itself.
 *
 * This module used to keep a `localStorage` preference that followed the reader
 * across URLs. It was written on mere ARRIVAL at any `/es/…` page, and read on
 * mount by every book page including English ones — so one visit to the Spanish
 * site silently switched the English site to Spanish, permanently, with nothing
 * in the URL to explain it. That also contradicted the rule the rest of the i18n
 * layer is built on (`src/lib/locale-path.ts`: "locale is derived from the URL
 * prefix rather than a cookie or Accept-Language header, so it never branches
 * edge-cached HTML"). The store is gone; `clearLegacyReadingLanguage` below
 * exists only to sweep the stale key out of browsers that still carry it.
 *
 * A `?lang=xx` on an English URL is a different thing: it is IN the address
 * bar, carried link to link through pages that have no twin (#6938,
 * `carryLocale` in locale-path.ts). It localizes chrome only.
 *
 * To resolve the locale of the current page, use `useLocale()`
 * (`src/lib/i18n.ts`) or `localeFromPathname()` (`src/lib/locale-path.ts`).
 */

import { carriedLocale, CARRIED_LOCALE_PARAM, localeFromPathname, type PrefixedLocale } from '@/lib/locale-path';

/** The query parameter that names a language on an English URL (#6938, and legacy `?lang=es` links). */
export const READING_LANGUAGE_PARAM = CARRIED_LOCALE_PARAM;

/** The key the retired preference store used. Read by nothing; only cleared. */
const LEGACY_STORAGE_KEY = 'sl:reading-language';

/**
 * Drop the retired preference key. Readers who visited `/es` while the store was
 * live still carry `es` in localStorage; it no longer does anything, but leaving
 * it behind would let any future reintroduction silently resurrect the bug.
 */
export function clearLegacyReadingLanguage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* private mode / quota — nothing depends on this succeeding */
  }
}

/**
 * The `/xx` edition of an English URL carrying `?lang=xx`, or null when there
 * is nothing to move to. `hasEdition` must answer for THIS page from real data
 * (the book page asks the server): answering from the route registry alone
 * would loop, because `/xx/book/<id>` 307s a book without that edition back to
 * `/book/<id>?lang=xx`. Returns null for already-localized paths, so this is
 * safe to call unconditionally.
 */
export function legacyLangRedirect(
  pathname: string,
  search: string,
  hasEdition: (lang: PrefixedLocale) => boolean,
): string | null {
  const lang = carriedLocale(search);
  if (!lang || localeFromPathname(pathname) !== 'en') return null;
  if (!hasEdition(lang)) return null;
  const params = new URLSearchParams(search);
  params.delete(READING_LANGUAGE_PARAM);
  const rest = params.toString();
  return `/${lang}${pathname}${rest ? `?${rest}` : ''}`;
}
