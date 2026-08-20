/**
 * Reading-language preference (#2770 follow-up).
 *
 * The reader can show a book in English (the pivot translation) or, where a
 * page carries one, in Spanish (`translations.es` / legacy `translation_es`).
 * The preference lives in localStorage so it follows the READER, not the URL:
 * a Spanish speaker who arrives via `/es` or via a `?lang=es` link opens every
 * subsequent book in Spanish without hunting for the toggle, and switching back
 * to English in the reader is remembered the same way.
 *
 * URL wins over storage for a single visit (`?lang=es` on a shared link), and a
 * `?lang=` value is also persisted, so the book page — which is ISR and cannot
 * read searchParams server-side — can hand the preference on to the reader by
 * the client picking it up on mount.
 */
export type ReadingLanguage = 'en' | 'es';

export const READING_LANGUAGE_KEY = 'sl:reading-language';
export const READING_LANGUAGE_PARAM = 'lang';

function isReadingLanguage(v: unknown): v is ReadingLanguage {
  return v === 'en' || v === 'es';
}

/** Stored preference, or null when unset / not in a browser. */
export function getStoredReadingLanguage(): ReadingLanguage | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(READING_LANGUAGE_KEY);
    return isReadingLanguage(v) ? v : null;
  } catch {
    return null;
  }
}

export function setStoredReadingLanguage(lang: ReadingLanguage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READING_LANGUAGE_KEY, lang);
  } catch {
    /* private mode / quota — the preference is a convenience, never required */
  }
}

/** `?lang=` from the current URL, if it names a supported reading language. */
export function readingLanguageFromUrl(): ReadingLanguage | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get(READING_LANGUAGE_PARAM);
  return isReadingLanguage(v) ? v : null;
}

/**
 * Resolve the reading language on mount: URL first (and remember it), then the
 * stored preference, else English. Client-only — call from an effect.
 */
export function resolveReadingLanguage(): ReadingLanguage {
  const fromUrl = readingLanguageFromUrl();
  if (fromUrl) {
    setStoredReadingLanguage(fromUrl);
    return fromUrl;
  }
  return getStoredReadingLanguage() ?? 'en';
}
