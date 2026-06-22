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
