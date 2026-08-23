// Pure locale primitives — NO React, NO next/navigation, so a SERVER
// component can import them safely. The client hooks that read the current
// URL (`useLocale`, `useLocalePath`) live in `src/lib/i18n.ts`, which
// re-exports everything here; importing THAT module from a server component
// pulls in `usePathname` and breaks (this is exactly why this split exists —
// the reader's crawler-nav links, built server-side in
// `(reader)/page.tsx`, need `localePath` without dragging in a client hook).
//
// Locale is derived from the URL prefix (`/es`, `/es/...`) rather than a
// cookie or Accept-Language header, so it never branches edge-cached HTML and
// every localized route is its own indexable page.
//
// To add a language: add it to Locale + SUPPORTED_LOCALES, extend the prefix
// check in localeFromPathname, add its route shapes to LOCALIZED_PATTERNS,
// and fill in the dictionaries (NAV_STRINGS in i18n.ts, HOME_STRINGS in
// home-i18n.ts, READER_UI_STRINGS in reader-strings.ts). Keep the prefixes
// disjoint from tenant slugs.

export type Locale = 'en' | 'es';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

/** Map a pathname to its locale by URL prefix. Defaults to English. */
export function localeFromPathname(pathname: string | null | undefined): Locale {
  if (pathname === '/es' || (pathname?.startsWith('/es/') ?? false)) return 'es';
  return 'en';
}

// ---------- Locale switching (sitewide EN/ES toggle, #2763) ----------

// EN base paths that have a real Spanish (`/es…`) twin route. Keep this in sync
// with the `src/app/es/**` route folders: the homepage plus the acquisition
// funnel (`/support`, `/auth/signin`). The header toggle is shown on EVERY page,
// but on a page with no twin the ES link falls back to the Spanish homepage
// (`/es`) as a front door rather than dead-ending on a 404 — the thin-i18n
// bargain (deep pages rely on the browser's own translate).
//
// This is an EXACT-MATCH registry — fine for static paths, but the reader is a
// dynamic route (`/book/<id>/page/<pageId>`), so it cannot live here as a
// literal string. See LOCALIZED_PATTERNS below for path SHAPES.
export const LOCALIZED_PATHS = new Set<string>(['/', '/support', '/auth/signin']);

// Path SHAPES with a Spanish twin, checked when no exact LOCALIZED_PATHS entry
// matches. One pattern per `src/app/es/**` route — deliberately the exact
// dynamic shape, not a bare `/book` prefix: `/book/<id>/page/<pageId>` has a
// twin while `/book/<id>/overview`, `/book/<id>/guide`, `/book/<id>` itself,
// etc. do not (yet) in this worktree. A missing pattern costs an English page
// (the safe direction — see hasLocalizedPath below); a wrong one costs a 404.
// Keep in sync with the route folders under `src/app/es/`.
const LOCALIZED_PATTERNS: RegExp[] = [
  /^\/book\/[^/]+\/page\/[^/]+$/,
];

/** True if `canonical` (already locale-stripped) has a real `/es` twin, by
 *  exact match or by shape. */
function hasLocalizedPath(canonical: string): boolean {
  if (LOCALIZED_PATHS.has(canonical)) return true;
  return LOCALIZED_PATTERNS.some((re) => re.test(canonical));
}

/** Strip the `/es` locale prefix to get the canonical English path. */
export function canonicalPath(pathname: string | null | undefined): string {
  if (!pathname || pathname === '/es') return '/';
  if (pathname.startsWith('/es/')) return pathname.slice(3); // '/es/x' → '/x'
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
 * - Spanish: the `/es` twin when one exists (exact path or a registered
 *   dynamic shape — see LOCALIZED_PATTERNS), else the Spanish homepage (`/es`).
 */
export function localeHref(target: Locale, pathname: string | null | undefined): string {
  const canonical = canonicalPath(pathname);
  if (target === 'en') return canonical;
  if (hasLocalizedPath(canonical)) return canonical === '/' ? '/es' : `/es${canonical}`;
  return '/es';
}

/**
 * Keep an internal link on the current locale. Unlike `localeHref` (which
 * always resolves relative to the CURRENT page), this prefixes an arbitrary
 * `href` — for server-rendered links (e.g. the reader's crawler-nav prev/next
 * links) that need to stay on `/es` once built under it.
 *
 * A path with no twin (`LOCALIZED_PATHS`/`LOCALIZED_PATTERNS`) is returned
 * UNTOUCHED rather than pointed at a 404 — same asymmetry as `localeHref`:
 * a Spanish reader following an unprefixed link lands on an honest English
 * page; following a prefixed one would land on nothing. Absolute URLs,
 * anchors, and already-prefixed paths pass through unchanged.
 */
export function localePath(href: string, lang: Locale): string {
  if (lang === 'en' || !href || !href.startsWith('/')) return href;
  const prefix = '/es';
  if (href === prefix || href.startsWith(`${prefix}/`)) return href;
  if (href === '/') return prefix;
  const path = href.split(/[?#]/)[0];
  return hasLocalizedPath(path) ? `${prefix}${href}` : href;
}
