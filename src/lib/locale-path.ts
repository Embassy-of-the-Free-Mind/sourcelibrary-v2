// Pure locale primitives — NO React, NO next/navigation, so a SERVER component
// can import them. The client hooks that read the current URL (`useLocale`,
// `useLocalePath`) live in `src/lib/i18n.ts`, which re-exports everything here;
// importing that module from a server component is an error in Next 16, which
// is exactly why this split exists.
//
// Locale is derived from the URL prefix (`/es`, `/es/...`) rather than a cookie
// or Accept-Language header, so it never branches edge-cached HTML and every
// localized route is its own indexable page.
//
// To add a language: add it to Locale + SUPPORTED_LOCALES, list its twin
// routes in LOCALIZED_PATHS / LOCALIZED_PATTERNS, and
// fill in the dictionaries (NAV_STRINGS in i18n.ts, HOME_STRINGS in
// home-i18n.ts). Keep the prefixes disjoint from tenant slugs.

export type Locale = 'en' | 'es' | 'la' | 'nl' | 'zh';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'la', 'nl', 'zh'];

/**
 * Locales whose site is for reading books WRITTEN in that language, in the
 * original: Latin (#6254), Dutch and Chinese (#6382). Spanish is the other
 * kind, a language we translate INTO. On these sites the reader opens on the
 * scan and the original text with the English pane off, the homepage leads
 * with a shelf of books in the language, and a collection's count is read
 * against all its members rather than the English-readable ones.
 */
export const ORIGINAL_TEXT_LOCALE_LIST: Locale[] = ['la', 'nl', 'zh'];
export const ORIGINAL_TEXT_LOCALES: ReadonlySet<Locale> = new Set<Locale>(ORIGINAL_TEXT_LOCALE_LIST);
export function readsOriginal(lang: Locale): boolean {
  return ORIGINAL_TEXT_LOCALES.has(lang);
}

/**
 * The locales that own a URL prefix. English is the ROOT — `/book/x`, not
 * `/en/book/x` — because every DOI, shortlink and citation ever minted points
 * there. A new language is added here and gets its prefix for free; nothing
 * below hard-codes `/es`.
 */
export const PREFIXED_LOCALES: Exclude<Locale, 'en'>[] = SUPPORTED_LOCALES.filter(
  (l): l is Exclude<Locale, 'en'> => l !== 'en',
);

/**
 * A dictionary for a surface that has NO route in some locales: the missing
 * locales read the English copy.
 *
 * Use it only where the surface cannot be reached under that locale's prefix
 * (`/support`, `/search`, `/librarian` and sign-in have no `/la` twin, #6254),
 * so the English is never shown under foreign chrome. A surface that IS mounted
 * on a localized route takes a full `Record<Locale, T>` literal instead, and
 * TypeScript then lists the dictionary when a language is added.
 */
export function withEnglishFallback<T>(dict: { en: T } & Partial<Record<Locale, T>>): Record<Locale, T> {
  const out = {} as Record<Locale, T>;
  for (const l of SUPPORTED_LOCALES) out[l] = dict[l] ?? dict.en;
  return out;
}

/** Map a pathname to its locale by URL prefix. Defaults to English. */
export function localeFromPathname(pathname: string | null | undefined): Locale {
  if (!pathname) return 'en';
  for (const l of PREFIXED_LOCALES) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return 'en';
}

// ---------- Locale switching (sitewide language toggle, #2763) ----------

export type PrefixedLocale = Exclude<Locale, 'en'>;

// EN base paths that have a real twin route, PER LOCALE. Keep each set in sync
// with that locale's route folders (`src/app/es/**`, `src/app/la/**`). Spanish
// has the homepage, the acquisition funnel (`/support`, `/auth/signin`), the
// Librarian and search; Latin (#6254) has the homepage only. On a page with no
// twin the switch link falls back to that locale's homepage as a front door
// rather than dead-ending on a 404 — the thin-i18n bargain (deep pages rely on
// the browser's own translate).
//
// Per locale on purpose. This was one shared set while Spanish was the only
// prefixed locale; a shared set would have sent a Latin reader to
// `/la/support`, which no route serves.
export const LOCALIZED_PATHS: Record<PrefixedLocale, Set<string>> = {
  es: new Set<string>(['/', '/support', '/auth/signin', '/librarian', '/search']),
  la: new Set<string>(['/']),
  nl: new Set<string>(['/']),
  zh: new Set<string>(['/']),
};

// Path SHAPES with a twin, per locale. One pattern per route under
// `src/app/<locale>/` — deliberately exact, not a bare `/book` prefix:
// `/book/<id>` and `/book/<id>/page/<pageId>` have twins while
// `/book/<id>/overview`, `/book/<id>/guide`, `/qa`, … do NOT, and a prefix
// match would send a Spanish reader to `/es/book/x/overview`, which no route
// serves. A missing pattern costs an English page; a wrong one costs a 404.
const BOOK_PATTERNS: RegExp[] = [
  /^\/book\/[^/]+$/,
  /^\/book\/[^/]+\/page\/[^/]+$/,
  /^\/book\/[^/]+\/page-number\/[^/]+$/,
];
const LOCALIZED_PATTERNS: Record<PrefixedLocale, RegExp[]> = {
  es: [/^\/collections$/, /^\/collections\/[^/]+$/, ...BOOK_PATTERNS],
  // No Latin collection pages: collection names and intros are English copy,
  // and nothing is translated INTO Latin (#6254).
  la: BOOK_PATTERNS,
  nl: BOOK_PATTERNS,
  zh: BOOK_PATTERNS,
};

function hasLocalizedPath(canonical: string, lang: PrefixedLocale): boolean {
  if (LOCALIZED_PATHS[lang].has(canonical)) return true;
  return LOCALIZED_PATTERNS[lang].some((re) => re.test(canonical));
}

/**
 * Strip the locale prefix to get the canonical English path.
 *
 * Every gate and matcher that reasons about a PATH FAMILY — the preview
 * content gate, the crawler rules, anything keyed on `/book` — must run on
 * this, not on the raw pathname. `/es/book/x` is the same content surface as
 * `/book/x`; a matcher that only knows the English form leaves the localized
 * twin ungated, silently, for as long as nobody looks (found on the #4082
 * preview: `/book/…` 403'd for anonymous callers and `/es/book/…` served).
 */
export function canonicalPath(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  for (const l of PREFIXED_LOCALES) {
    if (pathname === `/${l}`) return '/';
    if (pathname.startsWith(`/${l}/`)) return pathname.slice(l.length + 1); // '/es/x' → '/x'
  }
  return pathname;
}

/**
 * Whether the current page has a real twin in `lang` (i.e. switching keeps the
 * reader on the same page rather than dumping them on that locale's homepage).
 * With no `lang`, whether it has a twin in ANY prefixed locale — the header
 * uses that to HIDE the language toggle on deep, English-only pages (the
 * thin-i18n bargain), so clicking a language never bounces you to a front page.
 */
export function hasLocalizedTwin(pathname: string | null | undefined, lang?: PrefixedLocale): boolean {
  const canonical = canonicalPath(pathname);
  if (lang) return hasLocalizedPath(canonical, lang);
  return PREFIXED_LOCALES.some((l) => hasLocalizedPath(canonical, l));
}

/**
 * Href for switching the current page to `target` locale.
 * - English: the canonical page (any locale prefix dropped) so the reader stays put.
 * - Otherwise: that locale's twin when one exists, else its homepage (`/es`, `/la`).
 */
export function localeHref(target: Locale, pathname: string | null | undefined): string {
  const canonical = canonicalPath(pathname);
  if (target === 'en') return canonical;
  if (hasLocalizedPath(canonical, target)) return canonical === '/' ? `/${target}` : `/${target}${canonical}`;
  return `/${target}`;
}

/**
 * Keep an internal link on the current locale.
 *
 * Rule 5 of `.claude/docs/i18n.md`: the locale is the URL prefix and it stays —
 * but only where a twin route actually exists. The registry above
 * (`LOCALIZED_PATHS` / `LOCALIZED_PATTERNS`) is the single source of truth, so
 * a path with no twin (`/gallery`, `/catalog`, `/author/…`) is returned
 * UNTOUCHED rather than pointed at a 404. That asymmetry is deliberate: a
 * Spanish reader following an unprefixed link lands on an English page, which
 * is honest; following a prefixed one would land on nothing.
 *
 * Absolute URLs, anchors and already-prefixed paths pass through unchanged, so
 * this is safe to apply blindly at a link site.
 */
export function localePath(href: string, lang: Locale): string {
  if (lang === 'en' || !href || !href.startsWith('/')) return href;
  const prefix = `/${lang}`;
  if (href === prefix || href.startsWith(`${prefix}/`)) return href;
  if (href === '/') return prefix; // the localized home is `/es`, not `/es/`
  const path = href.split(/[?#]/)[0];
  return hasLocalizedPath(path, lang) ? `${prefix}${href}` : href;
}

