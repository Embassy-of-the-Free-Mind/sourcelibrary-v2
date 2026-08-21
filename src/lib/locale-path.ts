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
// To add a language: add it to Locale + SUPPORTED_LOCALES, extend the prefix
// check in localeFromPathname, add its route shapes to LOCALIZED_PATTERNS, and
// fill in the dictionaries (NAV_STRINGS in i18n.ts, HOME_STRINGS in
// home-i18n.ts). Keep the prefixes disjoint from tenant slugs.

export type Locale = 'en' | 'es';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

/**
 * The locales that own a URL prefix. English is the ROOT — `/book/x`, not
 * `/en/book/x` — because every DOI, shortlink and citation ever minted points
 * there. A new language is added here and gets its prefix for free; nothing
 * below hard-codes `/es`.
 */
export const PREFIXED_LOCALES: Exclude<Locale, 'en'>[] = SUPPORTED_LOCALES.filter(
  (l): l is Exclude<Locale, 'en'> => l !== 'en',
);

/** Map a pathname to its locale by URL prefix. Defaults to English. */
export function localeFromPathname(pathname: string | null | undefined): Locale {
  if (!pathname) return 'en';
  for (const l of PREFIXED_LOCALES) {
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) return l;
  }
  return 'en';
}

// ---------- Locale switching (sitewide EN/ES toggle, #2763) ----------

// EN base paths that have a real Spanish (`/es…`) twin route. Keep this in sync
// with the `src/app/es/**` route folders: the homepage plus the acquisition
// funnel (`/support`, `/auth/signin`). The header toggle is shown on EVERY page,
// but on a page with no twin the ES link falls back to the Spanish homepage
// (`/es`) as a front door rather than dead-ending on a 404 — the thin-i18n
// bargain (deep pages rely on the browser's own translate).
export const LOCALIZED_PATHS = new Set<string>(['/', '/support', '/auth/signin', '/librarian']);

// Path SHAPES with a Spanish twin. One pattern per `src/app/es/**` route —
// deliberately exact, not a bare `/book` prefix: `/book/<id>` and
// `/book/<id>/page/<pageId>` have twins while `/book/<id>/overview`,
// `/guide`, `/search`, `/qa`, … do NOT, and a prefix match would send a
// Spanish reader to `/es/book/x/overview`, which no route serves. A missing
// pattern costs an English page; a wrong one costs a 404.
//
// Keep in sync with the route folders under `src/app/es/`.
const LOCALIZED_PATTERNS: RegExp[] = [
  /^\/collections$/,
  /^\/collections\/[^/]+$/,
  /^\/book\/[^/]+$/,
  /^\/book\/[^/]+\/page\/[^/]+$/,
  /^\/book\/[^/]+\/page-number\/[^/]+$/,
];

function hasLocalizedPath(canonical: string): boolean {
  if (LOCALIZED_PATHS.has(canonical)) return true;
  return LOCALIZED_PATTERNS.some((re) => re.test(canonical));
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
 * Whether the current page has a real Spanish twin (i.e. switching to ES keeps
 * the reader on the same page rather than dumping them on the `/es` homepage).
 * The header uses this to HIDE the EN/ES toggle on deep, English-only pages —
 * the thin-i18n bargain — so clicking ES never bounces you to the front page.
 */
export function hasLocalizedTwin(pathname: string | null | undefined): boolean {
  return hasLocalizedPath(canonicalPath(pathname));
}

/**
 * Href for switching the current page to `target` locale.
 * - English: the canonical page (any `/es` prefix dropped) so the reader stays put.
 * - Spanish: the `/es` twin when one exists, else the Spanish homepage (`/es`).
 */
export function localeHref(target: Locale, pathname: string | null | undefined): string {
  const canonical = canonicalPath(pathname);
  if (target === 'en') return canonical;
  if (hasLocalizedPath(canonical)) return canonical === '/' ? '/es' : `/es${canonical}`;
  return '/es';
}

/**
 * Keep an internal link on the current locale.
 *
 * Rule 5 of `.claude/docs/i18n.md`: the locale is the URL prefix and it stays —
 * but only where a twin route actually exists. The registry above
 * (`LOCALIZED_PATHS` / `LOCALIZED_PREFIXES`) is the single source of truth, so
 * a path with no twin (`/gallery`, `/search`, `/author/…`) is returned
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
  return hasLocalizedPath(path) ? `${prefix}${href}` : href;
}

