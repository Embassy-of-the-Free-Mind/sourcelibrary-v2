import { usePathname } from 'next/navigation';

// Lightweight locale primitive shared across the site shell (header, footer,
// etc.). Locale is derived from the URL prefix (`/es`, `/es/...`) rather than a
// cookie or Accept-Language header, so it never branches edge-cached HTML and
// every localized route is its own indexable page. Client components read it
// with useLocale(); server components pass their known locale explicitly.
//
// To add a language: add it to Locale + SUPPORTED_LOCALES, extend the prefix
// check in localeFromPathname, and fill in the dictionaries (NAV_STRINGS here,
// HOME_STRINGS in home-i18n.ts). Keep the prefixes disjoint from tenant slugs.

export type Locale = 'en' | 'es';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

/** Map a pathname to its locale by URL prefix. Defaults to English. */
export function localeFromPathname(pathname: string | null | undefined): Locale {
  if (pathname === '/es' || (pathname?.startsWith('/es/') ?? false)) return 'es';
  return 'en';
}

// Base paths (English-canonical, no `/es` prefix) that have a Spanish twin
// route. The EN/ES toggle links to the twin for these; every other page has no
// `/es` equivalent (thin i18n) so the toggle there points at the Spanish front
// door and hints at browser translation. Keep in sync with the `/es/*` routes.
export const LOCALIZED_ROUTES = new Set<string>(['/', '/support', '/auth/signin']);

/** Strip a leading `/es` locale prefix to get the English-canonical base path. */
export function basePathFromPathname(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  if (pathname === '/es') return '/';
  if (pathname.startsWith('/es/')) return pathname.slice(3); // '/es/support' → '/support'
  return pathname;
}

/**
 * Resolve the EN and ES hrefs for the language toggle on a given page.
 * `hasTwin` is true when the current page has a real Spanish route, so callers
 * can hint that, on a non-twin page, ES jumps to the Spanish front door rather
 * than translating the current page in place.
 */
export function localeHrefs(pathname: string | null | undefined): { en: string; es: string; hasTwin: boolean } {
  const base = basePathFromPathname(pathname);
  const hasTwin = LOCALIZED_ROUTES.has(base);
  return {
    en: base,
    es: hasTwin ? (base === '/' ? '/es' : `/es${base}`) : '/es',
    hasTwin,
  };
}

/** Client hook: current locale from the URL. */
export function useLocale(): Locale {
  return localeFromPathname(usePathname());
}

// ---------- Shared site-shell strings (header nav) ----------

export interface NavStrings {
  collections: string;
  gallery: string;
  browse: string;
  catalogue: string;
  map: string;
  librarian: string;
  podcast: string;
  search: string;
  menu: string;
}

export const NAV_STRINGS: Record<Locale, NavStrings> = {
  en: {
    collections: 'Collections',
    gallery: 'Gallery',
    browse: 'Browse',
    catalogue: 'Catalogue',
    map: 'Map',
    librarian: 'Librarian',
    podcast: 'Podcast',
    search: 'Search',
    menu: 'Navigation menu',
  },
  es: {
    collections: 'Colecciones',
    gallery: 'Galería',
    browse: 'Explorar',
    catalogue: 'Catálogo',
    map: 'Mapa',
    librarian: 'Bibliotecario',
    podcast: 'Podcast',
    search: 'Buscar',
    menu: 'Menú de navegación',
  },
};

// ---------- Shared site-shell strings (global footer) ----------
// Labels only — hrefs are unchanged and still point at the English pages.
// The thin-i18n design localizes only the homepage front door (`/es`); deep
// pages have no `/es` route, so footer links must NOT be locale-prefixed.

export interface FooterStrings {
  // column titles
  colLibrary: string;
  colAbout: string;
  colParticipate: string;
  // Library column
  browseBooks: string;
  browseAZ: string;
  gallery: string;
  collections: string;
  explore: string;
  search: string;
  favorites: string;
  // About column
  about: string;
  vision: string;
  census: string;
  progress: string;
  researchNotes: string;
  privacy: string;
  cookieSettings: string;
  terms: string;
  copyright: string;
  // Participate column
  libraries: string;
  contribute: string;
  support: string;
  donate: string;
  sponsorship: string;
  developers: string;
  giveFeedback: string;
}

export const FOOTER_STRINGS: Record<Locale, FooterStrings> = {
  en: {
    colLibrary: 'Library',
    colAbout: 'About',
    colParticipate: 'Participate',
    browseBooks: 'Browse Books',
    browseAZ: 'Browse A–Z',
    gallery: 'Gallery',
    collections: 'Collections',
    explore: 'Explore',
    search: 'Search',
    favorites: 'Favorites',
    about: 'About',
    vision: 'Our Vision',
    census: 'Translation Census',
    progress: 'Progress',
    researchNotes: 'Research Notes',
    privacy: 'Privacy',
    cookieSettings: 'Cookie Settings',
    terms: 'Terms',
    copyright: 'Copyright & DMCA',
    libraries: 'Libraries',
    contribute: 'Contribute',
    support: 'Support',
    donate: 'Donate',
    sponsorship: 'Corporate Sponsorship',
    developers: 'Developers',
    giveFeedback: 'Give Feedback',
  },
  es: {
    colLibrary: 'Biblioteca',
    colAbout: 'Acerca de',
    colParticipate: 'Participar',
    browseBooks: 'Explorar libros',
    browseAZ: 'Índice A–Z',
    gallery: 'Galería',
    collections: 'Colecciones',
    explore: 'Descubrir',
    search: 'Buscar',
    favorites: 'Favoritos',
    about: 'Acerca de',
    vision: 'Nuestra visión',
    census: 'Censo de traducciones',
    progress: 'Progreso',
    researchNotes: 'Notas de investigación',
    privacy: 'Privacidad',
    cookieSettings: 'Preferencias de cookies',
    terms: 'Términos',
    copyright: 'Derechos de autor y DMCA',
    libraries: 'Bibliotecas',
    contribute: 'Contribuir',
    support: 'Apoyar',
    donate: 'Donar',
    sponsorship: 'Patrocinio corporativo',
    developers: 'Desarrolladores',
    giveFeedback: 'Enviar comentarios',
  },
};
