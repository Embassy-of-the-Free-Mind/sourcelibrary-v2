import type { Locale } from '@/lib/locale-path';

/**
 * Strings for the book page and its reader-facing furniture.
 *
 * Since #4082 phase 2 there is ONE book page: `src/app/book/[id]/page.tsx`
 * renders under both `/book/…` and `/es/book/…`, taking a `lang` prop. These
 * are the words it writes, plus the chrome of the child components it mounts
 * (pages grid, index, timeline). Anything still hard-coded in English is
 * listed in the "Not localized yet" note at the bottom of this file — a
 * component that has not been threaded stays English on purpose; nothing is
 * machine-translated at render time (see `.claude/docs/i18n.md` rule 4).
 *
 * Adding a language means adding a KEY here, not a second dictionary.
 */
export interface BookStrings {
  // ---- identity / hero ----
  backToCollection: string;
  read: string;
  readInSpanish: string;
  readThisBook: string;
  originalTitle: string;
  originalLanguage: string;
  published: string;
  written: string;
  pages: string;
  spanishEdition: string;
  spanishEditionOf: (es: number, total: number) => string;
  firstTranslation: string;
  noPriorTranslation: string;
  author: string;
  editedBy: string;
  scans: (n: number) => string;
  scansTooltip: string;
  images: (n: number) => string;
  notTranscribed: string;
  ocr: string;
  translated: string;
  ocrTooltip: (done: number, total: number) => string;
  translatedTooltip: (n: number) => string;
  notTranscribedTooltip: (total: number) => string;
  firstTranslationTooltip: string;
  noPriorTranslationTooltip: string;
  pageAbbrev: (n: number) => string;

  // ---- about / dropdowns ----
  summary: string;
  summaryIsEnglish: string;
  readingGuide: string;
  englishText: string;
  contents: string;
  contentsAsPrinted: string;
  viewScan: string;
  index: string;
  indexTerms: (n: number) => string;
  majorThemes: string;
  filterIndex: (n: number) => string;
  indexShowing: (shown: number, total: number) => string;
  indexHiddenHapax: (n: number) => string;
  indexNoMatch: (q: string) => string;
  more: (n: number) => string;
  bibliographicInformation: string;
  bookHistory: string;
  searchThisBook: string;
  searchPlaceholder: string;

  // ---- pages grid ----
  pagesHeading: string;
  pagesShownOf: (shown: number, total: number) => string;
  pagesDigitizedBy: (who: string) => string;
  pagesInReadingOrder: string;
  loadMore: (remaining: number) => string;
  overview: string;
  noPagesYet: string;

  // ---- sections ----
  illustrations: string;
  illustrationsNote: string;
  viewAllIllustrations: (n: number) => string;
  relatedBooks: string;
  relatedBooksNote: string;

  // ---- book-history timeline ----
  tlEarlierEnglishTranslation: string;
  tlFirstEnglishPublished: string;
  tlEnglishEditionPublished: string;
  tlNewEditionPublished: string;
  tlEarlier: string;
  tlAiTranslationBy: string;
  tlVersion: (v: string) => string;
  tlDigitizedBy: (who: string) => string;
  tlDigitized: string;
  tlAddedToSourceLibrary: string;
  tlEarlierTranslationExists: string;
  view: string;

  // ---- failure / fallback ----
  temporarilyUnavailable: string;
  temporarilyUnavailableBody: string;
  returnToLibrary: string;

  // ---- the thin-twin footer (kept: still used where a page has no twin) ----
  fullPage: string;
  fullPageNote: string;
}

export const BOOK_STRINGS: Record<Locale, BookStrings> = {
  en: {
    backToCollection: 'Books in Spanish',
    read: 'Read',
    readInSpanish: 'Read in Spanish',
    readThisBook: 'Read this book',
    originalTitle: 'Original title',
    originalLanguage: 'Original language',
    published: 'Published',
    written: 'Written',
    pages: 'pages',
    spanishEdition: 'Spanish edition',
    spanishEditionOf: (es, total) => `${es} of ${total} pages in Spanish`,
    firstTranslation: 'First translation',
    noPriorTranslation: 'No prior translation found',
    author: 'Author',
    editedBy: 'edited by',
    scans: (n) => `${n} scans`,
    scansTooltip: 'Scanned images, including covers and blanks.',
    images: (n) => `${n} image${n === 1 ? '' : 's'}`,
    notTranscribed: 'Scans only — not transcribed yet',
    ocr: 'OCR',
    translated: 'Translated',
    ocrTooltip: (done, total) => `${done} of ${total} pages transcribed`,
    translatedTooltip: (n) => `${n} pages translated to English`,
    notTranscribedTooltip: (total) => `${total} scans available; no pages transcribed yet`,
    firstTranslationTooltip: 'First translation into English',
    noPriorTranslationTooltip: 'We searched the catalogues and found no earlier English translation — a record of the search, not proof none exists',
    pageAbbrev: (n) => `p. ${n}`,

    summary: 'About this book',
    summaryIsEnglish: 'Summary available in English.',
    readingGuide: 'Reading guide',
    englishText: 'In English.',
    contents: 'Contents',
    contentsAsPrinted: 'Contents — as printed',
    viewScan: 'View scan →',
    index: 'Index',
    indexTerms: (n) => `${n} terms`,
    majorThemes: 'Major Themes',
    filterIndex: (n) => `Filter ${n} index entries...`,
    indexShowing: (shown, total) => `Showing ${shown} of ${total} entries.`,
    indexHiddenHapax: (n) => ` ${n} single-mention terms hidden.`,
    indexNoMatch: (q) => `No entries matching “${q}”`,
    more: (n) => `+${n} more`,
    bibliographicInformation: 'Bibliographic information',
    bookHistory: 'Book history',
    searchThisBook: 'Search this book',
    searchPlaceholder: 'Find a word, name, or phrase…',

    pagesHeading: 'Pages',
    pagesShownOf: (shown, total) => `${shown} of ${total}`,
    pagesDigitizedBy: (who) => `Every page scanned from the original, digitized by ${who}.`,
    pagesInReadingOrder: 'Every page of the original scan, in reading order.',
    loadMore: (remaining) => `Load more (${remaining} remaining)`,
    overview: 'Overview',
    noPagesYet: 'No pages yet',

    illustrations: 'Illustrations',
    illustrationsNote: 'Plates, diagrams, and figures detected in the scanned pages.',
    viewAllIllustrations: (n) => `View all ${n} illustrations`,
    relatedBooks: 'Related books',
    relatedBooksNote: 'Other volumes close to this one by author, subject, place, and period.',

    tlEarlierEnglishTranslation: 'Earlier English translation',
    tlFirstEnglishPublished: 'First English translation published',
    tlEnglishEditionPublished: 'English edition published',
    tlNewEditionPublished: 'New edition published',
    tlEarlier: 'Earlier',
    tlAiTranslationBy: 'An AI-assisted English translation of the original, produced and published by',
    tlVersion: (v) => `Version ${v}`,
    tlDigitizedBy: (who) => `Digitized by ${who}`,
    tlDigitized: 'Digitized',
    tlAddedToSourceLibrary: 'Added to Source Library',
    tlEarlierTranslationExists: 'An earlier English translation of this work has been published.',
    view: 'View →',

    temporarilyUnavailable: 'Temporarily Unavailable',
    temporarilyUnavailableBody: 'This book is taking longer than expected to load. Please try again in a moment.',
    returnToLibrary: 'Return to Library',

    fullPage: 'Full record (in English)',
    fullPageNote: 'bibliography, editions, illustrations, citations.',
  },
  es: {
    backToCollection: 'Libros en español',
    read: 'Leer',
    readInSpanish: 'Leer en español',
    readThisBook: 'Leer este libro',
    originalTitle: 'Título original',
    originalLanguage: 'Lengua original',
    published: 'Publicado',
    written: 'Escrito',
    pages: 'páginas',
    spanishEdition: 'Edición en español',
    spanishEditionOf: (es, total) => `${es} de ${total} páginas en español`,
    firstTranslation: 'Primera traducción',
    noPriorTranslation: 'No se ha encontrado ninguna traducción anterior',
    author: 'Autor',
    editedBy: 'editado por',
    scans: (n) => `${n} escaneos`,
    scansTooltip: 'Imágenes escaneadas, incluidas cubiertas y páginas en blanco.',
    images: (n) => `${n} ${n === 1 ? 'imagen' : 'imágenes'}`,
    notTranscribed: 'Solo escaneos — todavía sin transcribir',
    ocr: 'OCR',
    translated: 'Traducido',
    ocrTooltip: (done, total) => `${done} de ${total} páginas transcritas`,
    translatedTooltip: (n) => `${n} páginas traducidas al inglés`,
    notTranscribedTooltip: (total) => `${total} escaneos disponibles; ninguna página transcrita todavía`,
    firstTranslationTooltip: 'Primera traducción al inglés',
    noPriorTranslationTooltip: 'Hemos buscado en los catálogos y no hemos encontrado ninguna traducción al inglés anterior — es el registro de una búsqueda, no la prueba de que no exista',
    pageAbbrev: (n) => `pág. ${n}`,

    summary: 'Sobre este libro',
    summaryIsEnglish: 'Resumen disponible en inglés.',
    readingGuide: 'Guía de lectura',
    englishText: 'En inglés.',
    contents: 'Contenido',
    contentsAsPrinted: 'Índice — tal como está impreso',
    viewScan: 'Ver el escaneo →',
    index: 'Índice analítico',
    indexTerms: (n) => `${n} términos`,
    majorThemes: 'Temas principales',
    filterIndex: (n) => `Filtrar ${n} entradas del índice...`,
    indexShowing: (shown, total) => `Se muestran ${shown} de ${total} entradas.`,
    indexHiddenHapax: (n) => ` ${n} términos con una sola mención ocultos.`,
    indexNoMatch: (q) => `Ninguna entrada coincide con «${q}»`,
    more: (n) => `+${n} más`,
    bibliographicInformation: 'Información bibliográfica',
    bookHistory: 'Historia del ejemplar',
    searchThisBook: 'Buscar en este libro',
    searchPlaceholder: 'Busca una palabra, un nombre o una frase…',

    pagesHeading: 'Páginas',
    pagesShownOf: (shown, total) => `${shown} de ${total}`,
    pagesDigitizedBy: (who) => `Todas las páginas escaneadas del original, digitalizadas por ${who}.`,
    pagesInReadingOrder: 'Todas las páginas del escaneo original, en orden de lectura.',
    loadMore: (remaining) => `Cargar más (quedan ${remaining})`,
    overview: 'Vista general',
    noPagesYet: 'Todavía no hay páginas',

    illustrations: 'Ilustraciones',
    illustrationsNote: 'Láminas, diagramas y figuras detectadas en las páginas escaneadas.',
    viewAllIllustrations: (n) => `Ver las ${n} ilustraciones`,
    relatedBooks: 'Libros relacionados',
    relatedBooksNote: 'Otros volúmenes cercanos a este por autor, materia, lugar y época.',

    tlEarlierEnglishTranslation: 'Traducción al inglés anterior',
    tlFirstEnglishPublished: 'Primera traducción al inglés publicada',
    tlEnglishEditionPublished: 'Edición en inglés publicada',
    tlNewEditionPublished: 'Nueva edición publicada',
    tlEarlier: 'Anterior',
    tlAiTranslationBy: 'Una traducción al inglés del original, asistida por IA, producida y publicada por',
    tlVersion: (v) => `Versión ${v}`,
    tlDigitizedBy: (who) => `Digitalizado por ${who}`,
    tlDigitized: 'Digitalizado',
    tlAddedToSourceLibrary: 'Incorporado a Source Library',
    tlEarlierTranslationExists: 'Ya se ha publicado una traducción al inglés anterior de esta obra.',
    view: 'Ver →',

    temporarilyUnavailable: 'No disponible por el momento',
    temporarilyUnavailableBody: 'Este libro está tardando más de lo previsto en cargarse. Inténtalo de nuevo en un momento.',
    returnToLibrary: 'Volver a la biblioteca',

    fullPage: 'Ficha completa (en inglés)',
    fullPageNote: 'bibliografía, ediciones, ilustraciones, citas.',
  },
};

/**
 * Reader chrome (`/es/book/<id>/page/<pageId>`, #4082 phase 2b).
 *
 * Kept separate from BOOK_STRINGS because it is a different screen with a
 * different job — the words around a page of text, not the words around a
 * record. The reader is a CLIENT component, so it reads its locale from the
 * pathname (`useLocale()`) rather than taking a prop.
 *
 * EDITOR tooling (Run OCR, Edit Prompt, Translate, the settings dialogs, the
 * edit-mode panes) is deliberately NOT here: it is staff-only, English is its
 * working language, and translating it would imply a Spanish editing workflow
 * we do not offer.
 */
export interface ReaderStrings {
  // page navigation
  previousPage: string;
  nextPage: string;
  jumpToPage: string;
  jumpToPageAria: (total: number) => string;
  pageOfAria: (n: number, total: number) => string;
  arrowKeysHint: string;
  swipeHint: string;
  // panel toggles
  panelVisibility: string;
  image: string;
  ocr: string;
  romanized: string;
  german: string;
  toggle: (shown: boolean, what: string) => string;
  panelSourceImage: string;
  panelOriginalText: string;
  panelRomanized: string;
  panelGerman: string;
  panelTranslation: string;
  selectAPanel: string;
  // source-image panel
  sourceImage: string;
  tabletPhoto: string;
  source: string;
  noImage: string;
  download: string;
  downloadFullRes: string;
  viewAt: (provider: string) => string;
  // translation panel toolbar
  notes: string;
  notesOff: string;
  hideNotes: string;
  showNotes: string;
  info: string;
  viewPageMetadata: string;
  copy: string;
  copied: string;
  // reading settings
  readingSettings: string;
  fontSize: string;
  smaller: string;
  resetSize: string;
  larger: string;
  theme: string;
  themePaper: string;
  themeSepia: string;
  themeNight: string;
  // footer + search
  likeThisPage: string;
  searchThisBook: string;
  searchWithinBook: string;
  clearSearch: string;
  translationIssue: string;
  feedbackThanks: string;
  feedbackWhat: string;
  feedbackPlaceholder: string;
  cancel: string;
  send: string;
  sending: string;
  // chapters
  contents: string;
  tableOfContents: string;
  chapterCount: (n: number) => string;
  chapterAria: (title: string) => string;
  chapterShort: (n: number) => string;
  toc: string;
  close: string;
  pageAbbrev: (n: number) => string;
  // reading language
  readIn: string;
  readingLanguage: string;
  pageNavigation: string;
  metaPageOf: (n: number, title: string) => string;
  metaTitle: (title: string, n: number) => string;
  prevPageLink: (n: number) => string;
  nextPageLink: (n: number) => string;
  allPagesLink: (n: number) => string;
}

export const READER_STRINGS: Record<Locale, ReaderStrings> = {
  en: {
    previousPage: 'Previous page',
    nextPage: 'Next page',
    jumpToPage: 'Jump to page',
    jumpToPageAria: (total) => `Jump to page (1 to ${total})`,
    pageOfAria: (n, total) => `Page ${n} of ${total}. Click to jump to a page`,
    arrowKeysHint: 'Use \u2190 \u2192 arrow keys to navigate',
    swipeHint: 'Swipe left/right to navigate',

    panelVisibility: 'Panel visibility',
    image: 'Image',
    ocr: 'OCR',
    romanized: 'Romanized',
    german: 'Deutsch',
    toggle: (shown, what) => `${shown ? 'Hide' : 'Show'} ${what}`,
    panelSourceImage: 'source image',
    panelOriginalText: 'original text',
    panelRomanized: 'romanized text',
    panelGerman: 'German scholarly translation',
    panelTranslation: 'translation',
    selectAPanel: 'Select a panel to view',

    sourceImage: 'Source Image',
    tabletPhoto: 'Tablet Photo',
    source: 'Source',
    noImage: 'No image available',
    download: 'Download',
    downloadFullRes: 'Download full resolution',
    viewAt: (provider) => `View at ${provider}`,

    notes: 'Notes',
    notesOff: 'Notes Off',
    hideNotes: 'Hide notes and metadata',
    showNotes: 'Show notes and metadata',
    info: 'Info',
    viewPageMetadata: 'View page metadata',
    copy: 'Copy',
    copied: 'Copied',

    readingSettings: 'Reading settings',
    fontSize: 'Font Size',
    smaller: 'Smaller (Cmd+-)',
    resetSize: 'Reset to default (Cmd+0)',
    larger: 'Larger (Cmd+=)',
    theme: 'Theme',
    themePaper: 'Paper',
    themeSepia: 'Sepia',
    themeNight: 'Night',

    likeThisPage: 'Like this page',
    searchThisBook: 'Search this book...',
    searchWithinBook: 'Search within this book',
    clearSearch: 'Clear search',
    translationIssue: 'Notice a translation issue? Let us know.',
    feedbackThanks: 'Thank you — your feedback helps improve this translation.',
    feedbackWhat: 'What did you notice?',
    feedbackPlaceholder: 'Wrong word, awkward phrasing, missing context...',
    cancel: 'Cancel',
    send: 'Send',
    sending: 'Sending...',

    contents: 'Contents',
    tableOfContents: 'Table of contents',
    chapterCount: (n) => `${n} chapters`,
    chapterAria: (title) => `Chapter: ${title}`,
    chapterShort: (n) => `Ch. ${n}`,
    toc: 'ToC',
    close: 'Close',
    pageAbbrev: (n) => `p.\u00A0${n}`,

    readIn: 'Read in:',
    readingLanguage: 'Reading language',
    pageNavigation: 'Page navigation',
    metaPageOf: (n, title) => `Page ${n} of "${title}"`,
    metaTitle: (title, n) => `${title} - Page ${n}`,
    prevPageLink: (n) => `\u2190 Page ${n}`,
    nextPageLink: (n) => `Page ${n} \u2192`,
    allPagesLink: (n) => `All ${n} pages`,
  },
  es: {
    previousPage: 'Página anterior',
    nextPage: 'Página siguiente',
    jumpToPage: 'Ir a una página',
    jumpToPageAria: (total) => `Ir a una página (1 a ${total})`,
    pageOfAria: (n, total) => `Página ${n} de ${total}. Pulsa para ir a otra página`,
    arrowKeysHint: 'Usa las flechas \u2190 \u2192 para pasar de página',
    swipeHint: 'Desliza a izquierda o derecha para pasar de página',

    panelVisibility: 'Paneles visibles',
    image: 'Imagen',
    ocr: 'OCR',
    romanized: 'Romanizado',
    german: 'Alemán',
    toggle: (shown, what) => `${shown ? 'Ocultar' : 'Mostrar'} ${what}`,
    panelSourceImage: 'la imagen original',
    panelOriginalText: 'el texto original',
    panelRomanized: 'el texto romanizado',
    panelGerman: 'la traducción académica alemana',
    panelTranslation: 'la traducción',
    selectAPanel: 'Elige un panel para verlo',

    sourceImage: 'Imagen original',
    tabletPhoto: 'Foto de la tablilla',
    source: 'Original',
    noImage: 'No hay imagen disponible',
    download: 'Descargar',
    downloadFullRes: 'Descargar en alta resolución',
    viewAt: (provider) => `Ver en ${provider}`,

    notes: 'Notas',
    notesOff: 'Notas ocultas',
    hideNotes: 'Ocultar notas y metadatos',
    showNotes: 'Mostrar notas y metadatos',
    info: 'Info',
    viewPageMetadata: 'Ver los metadatos de la página',
    copy: 'Copiar',
    copied: 'Copiado',

    readingSettings: 'Ajustes de lectura',
    fontSize: 'Tamaño de letra',
    smaller: 'Más pequeña (Cmd+-)',
    resetSize: 'Volver al tamaño normal (Cmd+0)',
    larger: 'Más grande (Cmd+=)',
    theme: 'Tema',
    themePaper: 'Papel',
    themeSepia: 'Sepia',
    themeNight: 'Noche',

    likeThisPage: 'Me gusta esta página',
    searchThisBook: 'Buscar en este libro...',
    searchWithinBook: 'Buscar dentro de este libro',
    clearSearch: 'Borrar la búsqueda',
    translationIssue: '¿Has visto un problema en la traducción? Cuéntanoslo.',
    feedbackThanks: 'Gracias — tus comentarios ayudan a mejorar esta traducción.',
    feedbackWhat: '¿Qué has visto?',
    feedbackPlaceholder: 'Una palabra equivocada, una frase forzada, un contexto que falta...',
    cancel: 'Cancelar',
    send: 'Enviar',
    sending: 'Enviando...',

    contents: 'Contenido',
    tableOfContents: 'Índice',
    chapterCount: (n) => `${n} capítulos`,
    chapterAria: (title) => `Capítulo: ${title}`,
    chapterShort: (n) => `Cap. ${n}`,
    toc: 'Índ.',
    close: 'Cerrar',
    pageAbbrev: (n) => `pág.\u00A0${n}`,

    readIn: 'Leer en:',
    readingLanguage: 'Idioma de lectura',
    pageNavigation: 'Navegación por páginas',
    metaPageOf: (n, title) => `Página ${n} de «${title}»`,
    metaTitle: (title, n) => `${title} - Página ${n}`,
    prevPageLink: (n) => `\u2190 Página ${n}`,
    nextPageLink: (n) => `Página ${n} \u2192`,
    allPagesLink: (n) => `Las ${n} páginas`,
  },
};

/**
 * Not localized yet (stays English under `/es`, deliberately — #4082):
 * the bibliographic panel (`BookBiblioPanel`, `TranslationCardPanel`,
 * `RelatedEditions`), the reading guide's own prose, the processing log
 * (`PublicBookHistory`), the citation / download / share menus, the
 * contributing-library section, the sign-up call to action, the index TERMS
 * themselves (English entity labels), and the reader's EDITOR tooling (see
 * READER_STRINGS below). Each is a component with its own strings; thread
 * `lang` (or `useLocale()` for client components) and move its words into the
 * dictionary above when it is done.
 */

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
