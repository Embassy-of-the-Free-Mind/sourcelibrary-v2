import type { Locale } from '@/lib/i18n';

/**
 * Strings for the thin book-page twin (`/es/book/[id]`, #4082 phase 1). The
 * English book page (`/book/[id]`) still carries its own literal copy; these
 * are the words the TWIN needs. When the big page's strings are extracted
 * (phase 2) they merge into this dictionary, not a second one.
 */
export interface BookStrings {
  backToCollection: string;
  read: string;
  readInSpanish: string;
  originalTitle: string;
  originalLanguage: string;
  published: string;
  pages: string;
  spanishEdition: string;
  spanishEditionOf: (es: number, total: number) => string;
  summary: string;
  summaryIsEnglish: string;
  contents: string;
  fullPage: string;
  fullPageNote: string;
  firstTranslation: string;
  author: string;
  editedBy: string;
}

export const BOOK_STRINGS: Record<Locale, BookStrings> = {
  en: {
    backToCollection: 'Books in Spanish',
    read: 'Read',
    readInSpanish: 'Read in Spanish',
    originalTitle: 'Original title',
    originalLanguage: 'Original language',
    published: 'Published',
    pages: 'pages',
    spanishEdition: 'Spanish edition',
    spanishEditionOf: (es, total) => `${es} of ${total} pages in Spanish`,
    summary: 'About this book',
    summaryIsEnglish: 'Summary available in English.',
    contents: 'Contents',
    fullPage: 'Full record (in English)',
    fullPageNote: 'bibliography, editions, illustrations, citations.',
    firstTranslation: 'First translation',
    author: 'Author',
    editedBy: 'edited by',
  },
  es: {
    backToCollection: 'Libros en español',
    read: 'Leer',
    readInSpanish: 'Leer en español',
    originalTitle: 'Título original',
    originalLanguage: 'Lengua original',
    published: 'Publicado',
    pages: 'páginas',
    spanishEdition: 'Edición en español',
    spanishEditionOf: (es, total) => `${es} de ${total} páginas en español`,
    summary: 'Sobre este libro',
    summaryIsEnglish: 'Resumen disponible en inglés.',
    contents: 'Contenido',
    fullPage: 'Ficha completa (en inglés)',
    fullPageNote: 'bibliografía, ediciones, ilustraciones, citas.',
    firstTranslation: 'Primera traducción',
    author: 'Autor',
    editedBy: 'editado por',
  },
};

/** Spanish names for the `books.language` values a Spanish reader will meet most. */
const LANGUAGE_NAMES_ES: Record<string, string> = {
  latin: 'latín', greek: 'griego', 'ancient greek': 'griego antiguo', german: 'alemán', french: 'francés',
  english: 'inglés', italian: 'italiano', spanish: 'español', portuguese: 'portugués', dutch: 'neerlandés',
  hebrew: 'hebreo', arabic: 'árabe', persian: 'persa', sanskrit: 'sánscrito', hindi: 'hindi', chinese: 'chino',
  russian: 'ruso', akkadian: 'acadio', sumerian: 'sumerio', syriac: 'siríaco', coptic: 'copto', tibetan: 'tibetano',
  nahuatl: 'náhuatl', 'yucatec maya': 'maya yucateco', "k'iche' maya": "maya k'iche'", mixtec: 'mixteco',
  'maya hieroglyphs': 'jeroglíficos mayas', 'nahuatl-spanish': 'náhuatl y español', 'spanish / latin': 'español y latín',
};

export function languageName(lang: string | undefined | null, locale: Locale): string {
  if (!lang) return '';
  if (locale !== 'es') return lang;
  return LANGUAGE_NAMES_ES[lang.toLowerCase()] || lang;
}
