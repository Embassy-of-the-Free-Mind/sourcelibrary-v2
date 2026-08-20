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

// ---------- Locale switching (sitewide EN/ES toggle, #2763) ----------

// EN base paths that have a real Spanish (`/es…`) twin route. Keep this in sync
// with the `src/app/es/**` route folders: the homepage plus the acquisition
// funnel (`/support`, `/auth/signin`). The header toggle is shown on EVERY page,
// but on a page with no twin the ES link falls back to the Spanish homepage
// (`/es`) as a front door rather than dead-ending on a 404 — the thin-i18n
// bargain (deep pages rely on the browser's own translate).
export const LOCALIZED_PATHS = new Set<string>(['/', '/support', '/auth/signin']);

// Path FAMILIES with a Spanish twin: `/collections` and every
// `/collections/<slug>` render under `/es/collections/…` (Spanish chrome, Spanish
// collection names; see src/app/es/collections). Kept separate from the exact-
// match set so a new deep route is not localized by accident.
const LOCALIZED_PREFIXES = ['/collections'];

function hasLocalizedPath(canonical: string): boolean {
  if (LOCALIZED_PATHS.has(canonical)) return true;
  return LOCALIZED_PREFIXES.some((p) => canonical === p || canonical.startsWith(`${p}/`));
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
 * - Spanish: the `/es` twin when one exists, else the Spanish homepage (`/es`).
 */
export function localeHref(target: Locale, pathname: string | null | undefined): string {
  const canonical = canonicalPath(pathname);
  if (target === 'en') return canonical;
  if (hasLocalizedPath(canonical)) return canonical === '/' ? '/es' : `/es${canonical}`;
  return '/es';
}

// ---------- Shared site-shell strings (header nav) ----------

export interface NavStrings {
  collections: string;
  gallery: string;
  browse: string;
  catalogue: string;
  works: string;
  explore: string;
  librarian: string;
  search: string;
  menu: string;
  support: string;
}

export const NAV_STRINGS: Record<Locale, NavStrings> = {
  en: {
    collections: 'Collections',
    gallery: 'Gallery',
    browse: 'Browse',
    catalogue: 'Catalogue',
    works: 'Works',
    explore: 'Explore',
    librarian: 'Librarian',
    search: 'Search',
    menu: 'Navigation menu',
    support: 'Support',
  },
  es: {
    collections: 'Colecciones',
    gallery: 'Galería',
    browse: 'Explorar',
    catalogue: 'Catálogo',
    works: 'Obras',
    // NOT 'Explorar' — that is already this nav's label for Browse. The hub is
    // a set of interactive visualizations, so name it for what it holds.
    explore: 'Visualizaciones',
    librarian: 'Bibliotecario',
    search: 'Buscar',
    menu: 'Menú de navegación',
    support: 'Donar',
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
  search: string;
  // Kept reachable here after the header nav item was retired — the podcast is
  // otherwise only linked from the homepage feature and its librarian thread.
  podcast: string;
  favorites: string;
  // About column
  about: string;
  vision: string;
  census: string;
  progress: string;
  research: string;
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
  checkPages: string;
  licenseLine: string;
}

/**
 * The feedback dialog. Localised because the footer link already was: a Spanish
 * reader clicked "Enviar comentarios" and got an entirely English form —
 * "Send feedback", "Spot an error? Have an idea?", "Send". Translating the door
 * and not the room is worse than translating neither, because it invites people
 * in and then asks them to read a language they told us they do not.
 *
 * NOTE ON REACH: locale comes from the URL prefix, so these apply on /es and
 * /es/support only. On a book page there is no prefix and the dialog is still
 * English. Giving a Spanish reader a Spanish dialog everywhere needs locale to
 * follow the USER rather than the path — a bigger decision, not made here.
 */
export interface FeedbackStrings {
  /** The band above the footer (FeedbackCallout), not the dialog. */
  calloutHeading: string;
  calloutIntro: string;
  calloutButton: string;
  calloutDismiss: string;
  heading: string;
  placeholder: string;
  namePlaceholder: string;
  sendingAs: string;
  helpLabel: string;
  helpHint: string;
  emailPlaceholder: string;
  sentFrom: string;
  send: string;
  sending: string;
  tryAgain: string;
  thanks: string;
  received: string;
}

export const FEEDBACK_STRINGS: Record<Locale, FeedbackStrings> = {
  en: {
    calloutHeading: 'Share your feedback.',
    calloutIntro: 'If you spot an error, have a suggestion, or just want to say hello \u2014 we\u2019d love to hear from you.',
    calloutButton: 'Give Feedback',
    calloutDismiss: 'Dismiss',
    heading: 'Send feedback',
    placeholder: 'Spot an error? Have an idea? Anything at all...',
    namePlaceholder: 'Your name (optional)',
    sendingAs: 'Sending as',
    helpLabel: 'I\u2019d like to help \u2014 translations, research, or suggesting books.',
    helpHint: 'We\u2019ll email you to learn more.',
    emailPlaceholder: 'Your email (so we can reach out)',
    sentFrom: 'Sent from',
    send: 'Send',
    sending: 'Sending...',
    tryAgain: 'Try again',
    thanks: 'Thank you!',
    received: 'Your feedback has been received.',
  },
  es: {
    calloutHeading: 'Comparte tus comentarios.',
    calloutIntro: 'Si encuentras un error, tienes una sugerencia o simplemente quieres saludar, nos encantar\u00eda saber de ti.',
    calloutButton: 'Enviar comentarios',
    calloutDismiss: 'Descartar',
    heading: 'Enviar comentarios',
    placeholder: '\u00bfHas visto un error? \u00bfTienes una idea? Lo que sea...',
    namePlaceholder: 'Tu nombre (opcional)',
    sendingAs: 'Enviando como',
    helpLabel: 'Me gustar\u00eda ayudar: traducciones, investigaci\u00f3n o sugerir libros.',
    helpHint: 'Te escribiremos para saber m\u00e1s.',
    emailPlaceholder: 'Tu correo (para poder responderte)',
    sentFrom: 'Enviado desde',
    send: 'Enviar',
    sending: 'Enviando...',
    tryAgain: 'Int\u00e9ntalo de nuevo',
    thanks: '\u00a1Gracias!',
    received: 'Hemos recibido tus comentarios.',
  },
};

export const FOOTER_STRINGS: Record<Locale, FooterStrings> = {
  en: {
    colLibrary: 'Library',
    colAbout: 'About',
    colParticipate: 'Participate',
    browseBooks: 'Browse Books',
    browseAZ: 'Browse A–Z',
    gallery: 'Gallery',
    collections: 'Collections',
    search: 'Search',
    podcast: 'Podcast',
    favorites: 'Favorites',
    about: 'About',
    vision: 'Our Vision',
    census: 'Translation Census',
    progress: 'Progress',
    research: 'Research',
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
    checkPages: 'Check a few pages',
    licenseLine: 'Public domain originals · Translations CC BY-SA 4.0 · AI training requires a license',
  },
  es: {
    colLibrary: 'Biblioteca',
    colAbout: 'Acerca de',
    colParticipate: 'Participar',
    browseBooks: 'Explorar libros',
    browseAZ: 'Índice A–Z',
    gallery: 'Galería',
    collections: 'Colecciones',
    search: 'Buscar',
    podcast: 'Pódcast',
    favorites: 'Favoritos',
    about: 'Acerca de',
    vision: 'Nuestra visión',
    census: 'Censo de traducciones',
    progress: 'Progreso',
    research: 'Investigación',
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
    checkPages: 'Revisar algunas páginas',
    licenseLine: 'Originales de dominio público · Traducciones CC BY-SA 4.0 · El entrenamiento de IA requiere licencia',
  },
};
