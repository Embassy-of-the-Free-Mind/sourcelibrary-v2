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
  /** For text editions, which have no page images at all. */
  pagesOfText: (n: number) => string;
  textEditionTooltip: string;
  textEditionBy: (who: string) => string;
  textEdition: string;
  /** Text edition whose page cards show CDLI witness-tablet photos (#4350). */
  textEditionWitnesses: (n: number) => string;
  images: (n: number) => string;
  notTranscribed: string;
  ocr: string;
  translated: string;
  /** Rung `complete` (#5287): every translatable page is translated. */
  translationComplete: string;
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
  /** Link to /book/[id]/read — the whole book as one reflowing document (#5115). */
  readAsOneDocument: string;
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
    pagesOfText: (n) => `${n} ${n === 1 ? 'page' : 'pages'} of text`,
    textEditionTooltip: 'This is a text edition. There are no page images for this work.',
    textEditionBy: (who) => `A text edition, transcribed and edited by ${who}. There are no page images for this work.`,
    textEdition: 'A text edition. There are no page images for this work.',
    textEditionWitnesses: (n) => `A text edition — no page scans exist. The photographs show the ${n === 1 ? 'clay tablet' : `${n} clay tablets`} on which the composition survives (via CDLI); the text is not read from them.`,
    images: (n) => `${n} image${n === 1 ? '' : 's'}`,
    notTranscribed: 'Scans only — not transcribed yet',
    ocr: 'OCR',
    translated: 'Translated',
    translationComplete: 'Complete',
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
    readAsOneDocument: 'Read as one document',
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
    pagesOfText: (n) => `${n} ${n === 1 ? 'página' : 'páginas'} de texto`,
    textEditionTooltip: 'Es una edición de texto. Esta obra no tiene imágenes de página.',
    textEditionBy: (who) => `Edición de texto, transcrita y editada por ${who}. Esta obra no tiene imágenes de página.`,
    textEdition: 'Edición de texto. Esta obra no tiene imágenes de página.',
    textEditionWitnesses: (n) => `Edición de texto — no existen escaneos de página. Las fotografías muestran ${n === 1 ? 'la tablilla de arcilla' : `las ${n} tablillas de arcilla`} en que sobrevive la composición (vía CDLI); el texto no se leyó de ellas.`,
    images: (n) => `${n} ${n === 1 ? 'imagen' : 'imágenes'}`,
    notTranscribed: 'Solo escaneos — todavía sin transcribir',
    ocr: 'OCR',
    translated: 'Traducido',
    translationComplete: 'Completo',
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
    readAsOneDocument: 'Leer como un solo documento',
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
  // Latin (#6254). Draft copy, to be read by a Latinist before launch.
  // "Conversio" throughout means the ENGLISH translation: nothing is translated
  // into Latin, and on `/la` the Latin text is the book itself.
  la: {
    backToCollection: 'Libri Latini',
    read: 'Lege',
    readInSpanish: 'Latine lege',
    readThisBook: 'Hunc librum lege',
    originalTitle: 'Titulus primigenius',
    originalLanguage: 'Lingua primigenia',
    published: 'Editus',
    written: 'Scriptus',
    pages: 'paginae',
    spanishEdition: 'Editio Latina',
    spanishEditionOf: (es, total) => `${es} ex ${total} paginis Latine`,
    firstTranslation: 'Prima conversio',
    noPriorTranslation: 'Nulla conversio prior reperta',
    author: 'Auctor',
    editedBy: 'edidit',
    scans: (n) => `${n} imagines photographicae`,
    scansTooltip: 'Imagines photographicae, tegumentis et paginis vacuis inclusis.',
    pagesOfText: (n) => `${n} ${n === 1 ? 'pagina' : 'paginae'} textus`,
    textEditionTooltip: 'Haec est editio textus. Imagines paginarum huius operis nullae sunt.',
    textEditionBy: (who) => `Editio textus, quam descripsit et edidit ${who}. Imagines paginarum huius operis nullae sunt.`,
    textEdition: 'Editio textus. Imagines paginarum huius operis nullae sunt.',
    textEditionWitnesses: (n) => `Editio textus: imagines paginarum nullae exstant. Photographemata ${n === 1 ? 'tabulam fictilem' : `${n} tabulas fictiles`} ostendunt ubi opus servatur (per CDLI); textus ex iis non legitur.`,
    images: (n) => `${n} ${n === 1 ? 'imago' : 'imagines'}`,
    notTranscribed: 'Imagines tantum: nondum transcriptus',
    ocr: 'OCR',
    translated: 'Conversio',
    translationComplete: 'Absoluta',
    ocrTooltip: (done, total) => `${done} ex ${total} paginis transcriptae`,
    translatedTooltip: (n) => `${n} paginae Anglice conversae`,
    notTranscribedTooltip: (total) => `${total} imagines praesto sunt; nulla pagina adhuc transcripta`,
    firstTranslationTooltip: 'Prima conversio Anglica',
    noPriorTranslationTooltip: 'Catalogos perscrutati nullam priorem conversionem Anglicam repperimus: hoc inquisitionis testimonium est, non argumentum nullam exstare',
    pageAbbrev: (n) => `p. ${n}`,

    summary: 'De hoc libro',
    summaryIsEnglish: 'Summarium Anglice praesto est.',
    readingGuide: 'Dux legendi',
    englishText: 'Anglice.',
    contents: 'Index capitum',
    contentsAsPrinted: 'Index capitum, ut impressus est',
    viewScan: 'Imaginem specta →',
    index: 'Index',
    indexTerms: (n) => `${n} vocabula`,
    majorThemes: 'Argumenta praecipua',
    filterIndex: (n) => `In ${n} lemmatis indicis quaere...`,
    indexShowing: (shown, total) => `${shown} ex ${total} lemmatis ostenduntur.`,
    indexHiddenHapax: (n) => ` ${n} vocabula semel memorata celantur.`,
    indexNoMatch: (q) => `Nullum lemma congruit cum “${q}”`,
    more: (n) => `+${n} plura`,
    bibliographicInformation: 'Notitia bibliographica',
    bookHistory: 'Historia libri',
    searchThisBook: 'In hoc libro quaere',
    searchPlaceholder: 'Verbum, nomen, locutionem quaere…',

    pagesHeading: 'Paginae',
    pagesShownOf: (shown, total) => `${shown} ex ${total}`,
    pagesDigitizedBy: (who) => `Omnes paginae ex exemplari photographice descriptae, cura ${who}.`,
    pagesInReadingOrder: 'Omnes paginae exemplaris, ordine legendi.',
    loadMore: (remaining) => `Plures ostende (${remaining} supersunt)`,
    overview: 'Conspectus',
    readAsOneDocument: 'Ut unum scriptum lege',
    noPagesYet: 'Nullae adhuc paginae',

    illustrations: 'Imagines',
    illustrationsNote: 'Tabulae, diagrammata, figurae in paginis repertae.',
    viewAllIllustrations: (n) => `Omnes ${n} imagines specta`,
    relatedBooks: 'Libri cognati',
    relatedBooksNote: 'Alia volumina huic auctore, argumento, loco, aetate propinqua.',

    tlEarlierEnglishTranslation: 'Conversio Anglica prior',
    tlFirstEnglishPublished: 'Prima conversio Anglica edita',
    tlEnglishEditionPublished: 'Editio Anglica edita',
    tlNewEditionPublished: 'Nova editio edita',
    tlEarlier: 'Prius',
    tlAiTranslationBy: 'Conversio Anglica textus primigenii, intellegentia artificiali adiuvante facta, quam confecit et edidit',
    tlVersion: (v) => `Versio ${v}`,
    tlDigitizedBy: (who) => `Photographice descripsit ${who}`,
    tlDigitized: 'Photographice descriptus',
    tlAddedToSourceLibrary: 'In Source Library receptus',
    tlEarlierTranslationExists: 'Prior huius operis conversio Anglica edita est.',
    view: 'Specta →',

    temporarilyUnavailable: 'Ad tempus non praesto',
    temporarilyUnavailableBody: 'Hic liber tardius quam exspectatum est aperitur. Paulo post iterum tempta, quaeso.',
    returnToLibrary: 'Ad bibliothecam redi',

    fullPage: 'Notitia plena (Anglice)',
    fullPageNote: 'bibliographia, editiones, imagines, citationes.',
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
  translationTab: string;
  modernizedTab: string;
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
  typeface: string;
  typeOriginal: string;
  typeModern: string;
  typeOriginalTitle: string;
  typeModernTitle: string;
  typeCaption: string;
  // footer + search
  likeThisPage: string;
  // The footer like line: "[♥ Like this page] to save it to your favorites"
  // (unliked) / "[♥] Saved to your favorites" (liked). The prefix and the
  // linked word are separate strings because "favorites" is an <a> to
  // /favorites rendered OUTSIDE the button (#4126).
  likeSavePrefix: string;
  likeSavedPrefix: string;
  likeFavoritesWord: string;
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
    translationTab: 'Translation',
    modernizedTab: 'Modernized',
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
    typeface: 'Type',
    typeOriginal: 'Original',
    typeModern: 'Modern',
    typeOriginalTitle: 'Set in the type this book was printed in',
    typeModernTitle: 'Set in the reading face used across the library',
    typeCaption: 'Griffo\u2019s roman for Aldus Manutius, traced from the 1496 De Aetna.',

    likeThisPage: 'Like this page',
    likeSavePrefix: 'to save it to your',
    likeSavedPrefix: 'Saved to your',
    likeFavoritesWord: 'favorites',
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
    translationTab: 'Traducción',
    modernizedTab: 'Modernizado',
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
    typeface: 'Letra',
    typeOriginal: 'Original',
    typeModern: 'Moderna',
    typeOriginalTitle: 'Compuesto con la letrería original del libro',
    typeModernTitle: 'Compuesto con la letra de lectura habitual de la biblioteca',
    typeCaption: 'La redonda de Griffo para Aldo Manucio, calcada del De Aetna de 1496.',

    likeThisPage: 'Me gusta esta página',
    likeSavePrefix: 'para guardarla en tus',
    likeSavedPrefix: 'Guardada en tus',
    likeFavoritesWord: 'favoritos',
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

    readingLanguage: 'Idioma de lectura',
    pageNavigation: 'Navegación por páginas',
    metaPageOf: (n, title) => `Página ${n} de «${title}»`,
    metaTitle: (title, n) => `${title} - Página ${n}`,
    prevPageLink: (n) => `\u2190 Página ${n}`,
    nextPageLink: (n) => `Página ${n} \u2192`,
    allPagesLink: (n) => `Las ${n} páginas`,
  },
  // Latin (#6254). Draft copy, to be read by a Latinist before launch. The
  // `panel*` labels are ACCUSATIVE: their one use is as the object of `toggle`.
  la: {
    previousPage: 'Pagina prior',
    nextPage: 'Pagina sequens',
    jumpToPage: 'Paginam pete',
    jumpToPageAria: (total) => `Paginam pete (1 ad ${total})`,
    pageOfAria: (n, total) => `Pagina ${n} ex ${total}. Preme ut ad paginam eas`,
    arrowKeysHint: 'Sagittis ← → naviga',
    swipeHint: 'Laevorsum vel dextrorsum trahe ut naviges',

    panelVisibility: 'Tabulae ostendendae',
    image: 'Imago',
    ocr: 'OCR',
    romanized: 'Litteris Latinis',
    german: 'Deutsch',
    translationTab: 'Conversio',
    modernizedTab: 'Sermone hodierno',
    toggle: (shown, what) => `${shown ? 'Cela' : 'Ostende'} ${what}`,
    panelSourceImage: 'imaginem fontis',
    panelOriginalText: 'textum primigenium',
    panelRomanized: 'textum litteris Latinis scriptum',
    panelGerman: 'conversionem Germanicam doctam',
    panelTranslation: 'conversionem',
    selectAPanel: 'Tabulam elige quam spectes',

    sourceImage: 'Imago fontis',
    tabletPhoto: 'Photographema tabulae',
    source: 'Fons',
    noImage: 'Imago nulla praesto est',
    download: 'Deprome',
    downloadFullRes: 'Imaginem plenae magnitudinis deprome',
    viewAt: (provider) => `Apud ${provider} specta`,

    notes: 'Notae',
    notesOff: 'Notae celatae',
    hideNotes: 'Notas et metadata cela',
    showNotes: 'Notas et metadata ostende',
    info: 'Notitia',
    viewPageMetadata: 'Metadata paginae specta',
    copy: 'Exscribe',
    copied: 'Exscriptum',

    readingSettings: 'Optiones legendi',
    fontSize: 'Magnitudo litterarum',
    smaller: 'Minores (Cmd+-)',
    resetSize: 'Ad solitam magnitudinem redi (Cmd+0)',
    larger: 'Maiores (Cmd+=)',
    theme: 'Color',
    themePaper: 'Charta',
    themeSepia: 'Sepia',
    themeNight: 'Nox',
    typeface: 'Typi',
    typeOriginal: 'Prisci',
    typeModern: 'Hodierni',
    typeOriginalTitle: 'Typis quibus hic liber impressus est',
    typeModernTitle: 'Typis quibus tota bibliotheca utitur',
    typeCaption: 'Typi Romani Francisci Griffi pro Aldo Manutio, ex libro De Aetna anni 1496 expressi.',

    likeThisPage: 'Hanc paginam proba',
    likeSavePrefix: 'ut eam serves inter',
    likeSavedPrefix: 'Servata inter',
    likeFavoritesWord: 'dilecta',
    searchThisBook: 'In hoc libro quaere...',
    searchWithinBook: 'In hoc libro quaere',
    clearSearch: 'Quaestionem dele',
    translationIssue: 'Mendum in conversione animadvertisti? Fac nos certiores.',
    feedbackThanks: 'Gratias agimus: monitis tuis haec conversio emendatur.',
    feedbackWhat: 'Quid animadvertisti?',
    feedbackPlaceholder: 'Verbum falsum, locutio dura, aliquid omissum...',
    cancel: 'Omitte',
    send: 'Mitte',
    sending: 'Mittitur...',

    contents: 'Index capitum',
    tableOfContents: 'Index capitum',
    chapterCount: (n) => `${n} capita`,
    chapterAria: (title) => `Caput: ${title}`,
    chapterShort: (n) => `Cap. ${n}`,
    toc: 'Index',
    close: 'Claude',
    pageAbbrev: (n) => `p. ${n}`,

    readingLanguage: 'Lingua legendi',
    pageNavigation: 'Navigatio paginarum',
    metaPageOf: (n, title) => `Pagina ${n} libri "${title}"`,
    metaTitle: (title, n) => `${title} - Pagina ${n}`,
    prevPageLink: (n) => `← Pagina ${n}`,
    nextPageLink: (n) => `Pagina ${n} →`,
    allPagesLink: (n) => `Omnes ${n} paginae`,
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

/**
 * Latin names (#6254), as the feminine adjective that agrees with `lingua`:
 * "Lingua primigenia: Latina". An unlisted value is shown as stored.
 */
const LANGUAGE_NAMES_LA: Record<string, string> = {
  latin: 'Latina', greek: 'Graeca', 'ancient greek': 'Graeca antiqua', german: 'Germanica', french: 'Francogallica',
  english: 'Anglica', italian: 'Italica', spanish: 'Hispanica', portuguese: 'Lusitana', dutch: 'Batava',
  hebrew: 'Hebraica', arabic: 'Arabica', persian: 'Persica', sanskrit: 'Sanscrita', chinese: 'Sinica',
  russian: 'Russica', akkadian: 'Accadica', sumerian: 'Sumerica', syriac: 'Syriaca', coptic: 'Coptica', tibetan: 'Tibetana',
};

const LANGUAGE_NAMES: Partial<Record<Locale, Record<string, string>>> = { es: LANGUAGE_NAMES_ES, la: LANGUAGE_NAMES_LA };

export function languageName(lang: string | undefined | null, locale: Locale): string {
  if (!lang) return '';
  return LANGUAGE_NAMES[locale]?.[lang.toLowerCase()] || lang;
}
