import type { Locale } from '@/lib/locale-path';

/**
 * Strings for the search page (`src/app/search/page.tsx`), which renders under
 * both `/search` and `/es/search` taking a `lang` prop — the same "one page,
 * two URLs" shape as the book page (#4082 phase 2, `.claude/docs/i18n.md`).
 *
 * There is no authored prose here: every entry is chrome. What is NOT chrome —
 * an index term, a gallery description, a book title — stays in whatever
 * language it was written in and is LABELLED where that could confuse
 * (`imagesEnglishNote`), per i18n.md rule 4. Nothing is machine-translated at
 * render time.
 *
 * Adding a language means adding a KEY, not a second dictionary; TypeScript
 * will list every string you missed.
 *
 * ---
 *
 * Which LANES a locale gets is decided in the page, not here, and is worth
 * knowing while editing these strings: `/api/search` (the Libros tab) is fully
 * language-keyed and narrows to books that HAVE that edition, so every result
 * is openable in the reader's language. `/api/search/unified` (the "All" tab),
 * `/api/search/index` and `/api/search/ai-expand` are not, so they are hidden
 * on a localized surface rather than left to return English under Spanish
 * chrome. The gallery lane keeps its own English description index and is
 * labelled instead of hidden, because the images themselves are the content.
 */
export interface SearchStrings {
  /** BCP-47 tag for `toLocaleString` — thousands separators differ per locale. */
  numberLocale: string;

  // ---- search bar ----
  searchPlaceholder: string;
  searchFailed: string;

  // ---- sort (query mode) ----
  sortRelevance: string;
  sortYearNewest: string;
  sortYearOldest: string;
  sortTitleAz: string;

  // ---- sort (browse mode) ----
  browseRecentTranslation: string;
  browseRecent: string;
  browseOldestFirst: string;
  browseNewestFirst: string;
  browseTitleAsc: string;
  browseTitleDesc: string;

  // ---- tabs ----
  tabAll: string;
  tabBooks: string;
  tabIndex: string;
  tabImages: string;

  // ---- index-type pills ----
  indexAllTypes: string;
  indexConcepts: string;
  indexPeople: string;
  indexPlaces: string;
  indexQuotes: string;
  indexKeywords: string;
  indexVocabulary: string;

  // ---- filters ----
  filters: string;
  clear: string;
  clearAll: string;
  done: string;
  filterLanguage: string;
  filterSubject: string;
  filterCollection: string;
  filterLibrary: string;
  filterPublishedAfter: string;
  filterPublishedBefore: string;
  allLanguages: string;
  allCategories: string;
  allCollections: string;
  allLibraries: string;
  yearFromPlaceholder: string;
  yearToPlaceholder: string;
  hasTranslation: string;
  firstTranslation: string;
  hasDoi: string;

  // ---- sign-in wall ----
  signInHeading: string;
  signInBody: string;
  signInCta: string;

  // ---- per-page + counts ----
  show: string;
  perPage: string;
  showingRange: (from: number, to: number) => string;
  imagesCount: (n: string) => string;
  booksCount: (n: string) => string;
  inCollection: string;
  browseFullCatalog: string;
  allBooks: string;
  andNMore: (n: number) => string;

  // ---- empty / error states ----
  noImagesFound: string;
  noImagesBody: string;
  somethingWentWrong: string;
  couldNotLoadLibrary: string;
  tryAgain: string;
  noBooksFound: string;
  adjustFilters: string;
  noResultsFound: string;
  didYouMean: string;
  corpusBlurb: string;
  browseAllBooks: string;

  // ---- known-entity capture ----
  kindReadingRoom: string;
  kindLibrary: string;
  kindCollection: string;

  // ---- unified-view section headings ----
  illustrations: string;
  seeAllImages: string;
  semanticDegraded: string;
  weakMatchTitle: (q: string) => string;
  weakMatchBody: string;
  conceptualMatches: string;
  textMatches: string;
  seeAllResults: (n: string) => string;
  passages: string;
  searchingPageContent: string;
  catalogMatches: string;
  works: (n: number) => string;
  searchingCatalog: string;
  openAllCatalogueMatches: (n: string) => string;
  relatedFromAi: string;
  relatedInLibrary: string;

  // ---- drill-down result counts ----
  foundBooksAndPages: (n: string, q: string) => string;
  foundIndexEntries: (n: string, q: string) => string;
  foundImages: (n: string, q: string) => string;

  // ---- librarian CTA ----
  askLibrarian: string;
  askLibrarianBody: (scope: string) => string;
  askLibrarianScopeResults: (n: string) => string;
  askLibrarianScopeCollection: string;

  // ---- result cards ----
  editedByAbbrev: string;
  pageAbbrev: (n: number) => string;
  pagesCount: (n: number) => string;
  translatedCount: (n: number) => string;
  /**
   * Fan-out under a result that stands in for other editions/copies (#4300).
   * `n` is the count `/work/[id]` renders — the set this link reaches — so the
   * wording must promise the destination, not the rows we collapsed.
   */
  workEditionsLink: (n: number) => string;
  findPassages: string;
  hidePassages: string;
  searchingEllipsis: string;
  searchingPages: string;
  noMatchingPassages: string;
  untitled: string;
  /**
   * Subtitle under an illustration in the Images strip. The strip mixes details
   * cropped from books we hold with standalone artworks held by museums, and
   * the two used to wear the same bare title. This says the image is a detail
   * FROM something. The page number is rendered separately so a long book title
   * can truncate without taking the page number with it.
   */
  imageFromBook: (title: string) => string;
  digitized: string;
  catalogOnly: string;
  collectionBooks: (n: string) => string;
  /** Alt text for a collection card's plate — read aloud, so it localizes. */
  illustrationFromCollection: (name: string) => string;

  // ---- pagination ----
  previous: string;
  next: string;
  pageXofY: (x: string, y: string) => string;

  /**
   * Shown above gallery results on a localized surface: the illustration
   * descriptions are an English index, so a Spanish query searches English
   * words. Labelling beats hiding here — the images are the content, and the
   * reader can still browse them (i18n.md rule 4).
   */
  imagesEnglishNote: string;
}

/**
 * Example queries offered on the empty-results screen. Proper nouns
 * (`Hermes`, `Paracelsus`, `Kabbalah`, `rasayana`, `Ficino`) are names and are
 * NOT translated in any locale; only the common noun leading the row is.
 */
export const EXAMPLE_QUERY_PROPER_NOUNS = ['Hermes', 'Paracelsus', 'Kabbalah', 'rasayana', 'Ficino'] as const;

export const SEARCH_STRINGS: Record<Locale, SearchStrings> = {
  en: {
    numberLocale: 'en-US',

    searchPlaceholder: 'Search books, concepts, people, images...',
    searchFailed: 'Search failed. Please try again.',

    sortRelevance: 'Relevance',
    sortYearNewest: 'Year (newest)',
    sortYearOldest: 'Year (oldest)',
    sortTitleAz: 'Title A-Z',

    browseRecentTranslation: 'Recently translated',
    browseRecent: 'Recently added',
    browseOldestFirst: 'Oldest first',
    browseNewestFirst: 'Newest first',
    browseTitleAsc: 'Title A-Z',
    browseTitleDesc: 'Title Z-A',

    tabAll: 'All',
    tabBooks: 'Books',
    tabIndex: 'Index',
    tabImages: 'Images',

    indexAllTypes: 'All Types',
    indexConcepts: 'Concepts',
    indexPeople: 'People',
    indexPlaces: 'Places',
    indexQuotes: 'Quotes',
    indexKeywords: 'Keywords',
    indexVocabulary: 'Vocabulary',

    filters: 'Filters',
    clear: 'Clear',
    clearAll: 'Clear all',
    done: 'Done',
    filterLanguage: 'Language',
    filterSubject: 'Subject',
    filterCollection: 'Collection',
    filterLibrary: 'Library',
    filterPublishedAfter: 'Published after',
    filterPublishedBefore: 'Published before',
    allLanguages: 'All Languages',
    allCategories: 'All Categories',
    allCollections: 'All Collections',
    allLibraries: 'All Libraries',
    yearFromPlaceholder: 'e.g., 1500',
    yearToPlaceholder: 'e.g., 1700',
    hasTranslation: 'Has translation',
    firstTranslation: 'First translation',
    hasDoi: 'Has DOI',

    signInHeading: 'Sign in to keep searching',
    signInBody: 'You’ve used your free searches for now. Sign in — it’s free — to keep exploring over 10,000 primary sources.',
    signInCta: 'Sign in — free',

    show: 'Show',
    perPage: 'per page',
    showingRange: (from, to) => `(showing ${from}–${to})`,
    imagesCount: (n) => `${n} images`,
    booksCount: (n) => `${n} books`,
    inCollection: 'in',
    browseFullCatalog: 'Browse Full Catalog',
    allBooks: 'All books',
    andNMore: (n) => `+${n} more`,

    noImagesFound: 'No images found',
    noImagesBody: 'Try searching for a subject, figure, or symbol.',
    somethingWentWrong: 'Something went wrong',
    couldNotLoadLibrary: 'We couldn’t load the library right now.',
    tryAgain: 'Try again',
    noBooksFound: 'No books found',
    adjustFilters: 'Try adjusting your filters.',
    noResultsFound: 'No results found',
    didYouMean: 'Did you mean',
    corpusBlurb: 'Over 10,000 primary sources spanning alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit rasayana, Chinese classics, Arabic philosophy, and more.',
    browseAllBooks: 'Browse all books',

    kindReadingRoom: 'Reading room',
    kindLibrary: 'Library partner',
    kindCollection: 'Collection',

    illustrations: 'Illustrations',
    seeAllImages: 'See all images',
    semanticDegraded: 'Related results couldn’t be loaded just now — you may be seeing fewer matches than we hold. Try again in a moment.',
    weakMatchTitle: (q) => `No strong matches for “${q}”`,
    weakMatchBody: 'Nothing in the library matches all of your search words. The results below match only part of your search.',
    conceptualMatches: 'Conceptual matches',
    textMatches: 'Text matches',
    seeAllResults: (n) => `See all ${n} results`,
    passages: 'Passages',
    searchingPageContent: 'Searching page content...',
    catalogMatches: 'Catalog matches',
    works: (n) => (n === 1 ? 'work' : 'works'),
    searchingCatalog: 'Searching catalog...',
    openAllCatalogueMatches: (n) => `Open all ${n} catalogue matches`,
    relatedFromAi: 'Related results from AI-expanded search:',
    relatedInLibrary: 'Related in the Library',

    foundBooksAndPages: (n, q) => `Found ${n} books & pages for “${q}”`,
    foundIndexEntries: (n, q) => `Found ${n} index entries for “${q}”`,
    foundImages: (n, q) => `Found ${n} images for “${q}”`,

    askLibrarian: 'Ask the Librarian',
    askLibrarianBody: (scope) => `Want deeper analysis? The Librarian will search across ${scope}, cross-reference sources, and build a research notebook you can export.`,
    askLibrarianScopeResults: (n) => `these ${n} results`,
    askLibrarianScopeCollection: 'the collection',

    editedByAbbrev: 'ed.',
    pageAbbrev: (n) => `p. ${n}`,
    pagesCount: (n) => `${n} pages`,
    translatedCount: (n) => `${n} translated`,
    workEditionsLink: (n) => `${n} editions & copies of this work`,
    findPassages: 'Find passages',
    hidePassages: 'Hide passages',
    searchingEllipsis: 'Searching...',
    searchingPages: 'Searching pages...',
    noMatchingPassages: 'No matching passages found in this book.',
    untitled: '(untitled)',
    imageFromBook: (title) => `from ${title}`,
    digitized: 'Digitized',
    catalogOnly: 'Catalog only',
    collectionBooks: (n) => `${n} books`,
    illustrationFromCollection: (name) => `Illustration from ${name}`,

    previous: 'Previous',
    next: 'Next',
    pageXofY: (x, y) => `Page ${x} of ${y}`,

    imagesEnglishNote: '',
  },

  es: {
    numberLocale: 'es-ES',

    searchPlaceholder: 'Busca libros, conceptos, personas, imágenes...',
    searchFailed: 'La búsqueda ha fallado. Vuelve a intentarlo.',

    sortRelevance: 'Relevancia',
    sortYearNewest: 'Año (más reciente)',
    sortYearOldest: 'Año (más antiguo)',
    sortTitleAz: 'Título A-Z',

    browseRecentTranslation: 'Traducidos recientemente',
    browseRecent: 'Añadidos recientemente',
    browseOldestFirst: 'Más antiguos primero',
    browseNewestFirst: 'Más recientes primero',
    browseTitleAsc: 'Título A-Z',
    browseTitleDesc: 'Título Z-A',

    tabAll: 'Todo',
    tabBooks: 'Libros',
    tabIndex: 'Índice',
    tabImages: 'Imágenes',

    indexAllTypes: 'Todos los tipos',
    indexConcepts: 'Conceptos',
    indexPeople: 'Personas',
    indexPlaces: 'Lugares',
    indexQuotes: 'Citas',
    indexKeywords: 'Palabras clave',
    indexVocabulary: 'Vocabulario',

    filters: 'Filtros',
    clear: 'Borrar',
    clearAll: 'Borrar todo',
    done: 'Listo',
    filterLanguage: 'Idioma',
    filterSubject: 'Materia',
    filterCollection: 'Colección',
    filterLibrary: 'Biblioteca',
    filterPublishedAfter: 'Publicado después de',
    filterPublishedBefore: 'Publicado antes de',
    allLanguages: 'Todos los idiomas',
    allCategories: 'Todas las materias',
    allCollections: 'Todas las colecciones',
    allLibraries: 'Todas las bibliotecas',
    yearFromPlaceholder: 'p. ej., 1500',
    yearToPlaceholder: 'p. ej., 1700',
    hasTranslation: 'Con traducción',
    firstTranslation: 'Primera traducción',
    hasDoi: 'Con DOI',

    signInHeading: 'Inicia sesión para seguir buscando',
    signInBody: 'Has agotado tus búsquedas gratuitas por ahora. Inicia sesión — es gratis — para seguir explorando más de 10.000 fuentes primarias.',
    signInCta: 'Inicia sesión — es gratis',

    show: 'Mostrar',
    perPage: 'por página',
    showingRange: (from, to) => `(mostrando ${from}–${to})`,
    imagesCount: (n) => `${n} imágenes`,
    booksCount: (n) => `${n} libros`,
    inCollection: 'en',
    browseFullCatalog: 'Ver el catálogo completo',
    allBooks: 'Todos los libros',
    andNMore: (n) => `+${n} más`,

    noImagesFound: 'No se han encontrado imágenes',
    noImagesBody: 'Prueba a buscar un tema, una figura o un símbolo.',
    somethingWentWrong: 'Algo ha ido mal',
    couldNotLoadLibrary: 'No hemos podido cargar la biblioteca en este momento.',
    tryAgain: 'Volver a intentarlo',
    noBooksFound: 'No se han encontrado libros',
    adjustFilters: 'Prueba a ajustar los filtros.',
    noResultsFound: 'No se han encontrado resultados',
    didYouMean: '¿Quisiste decir',
    corpusBlurb: 'Más de 10.000 fuentes primarias: alquimia, hermetismo, cábala, filosofía natural, rasayana sánscrito, clásicos chinos, filosofía árabe y mucho más.',
    browseAllBooks: 'Ver todos los libros',

    kindReadingRoom: 'Sala de lectura',
    kindLibrary: 'Biblioteca asociada',
    kindCollection: 'Colección',

    illustrations: 'Ilustraciones',
    seeAllImages: 'Ver todas las imágenes',
    semanticDegraded: 'No se han podido cargar los resultados relacionados — puede que veas menos coincidencias de las que tenemos. Inténtalo de nuevo en un momento.',
    weakMatchTitle: (q) => `No hay coincidencias exactas para «${q}»`,
    weakMatchBody: 'Nada en la biblioteca coincide con todas las palabras de tu búsqueda. Los resultados siguientes coinciden solo con una parte.',
    conceptualMatches: 'Coincidencias conceptuales',
    textMatches: 'Coincidencias en el texto',
    seeAllResults: (n) => `Ver los ${n} resultados`,
    passages: 'Pasajes',
    searchingPageContent: 'Buscando en el texto de las páginas...',
    catalogMatches: 'Coincidencias en el catálogo',
    works: (n) => (n === 1 ? 'obra' : 'obras'),
    searchingCatalog: 'Buscando en el catálogo...',
    openAllCatalogueMatches: (n) => `Ver las ${n} coincidencias del catálogo`,
    relatedFromAi: 'Resultados relacionados de la búsqueda ampliada con IA:',
    relatedInLibrary: 'Relacionado en la biblioteca',

    foundBooksAndPages: (n, q) => `${n} libros y páginas para «${q}»`,
    foundIndexEntries: (n, q) => `${n} entradas del índice para «${q}»`,
    foundImages: (n, q) => `${n} imágenes para «${q}»`,

    askLibrarian: 'Pregunta a la fuente',
    askLibrarianBody: (scope) => `¿Quieres un análisis más profundo? El Bibliotecario buscará en ${scope}, contrastará las fuentes y armará un cuaderno de investigación que podrás exportar.`,
    askLibrarianScopeResults: (n) => `estos ${n} resultados`,
    askLibrarianScopeCollection: 'la colección',

    editedByAbbrev: 'ed.',
    pageAbbrev: (n) => `p. ${n}`,
    pagesCount: (n) => `${n} páginas`,
    translatedCount: (n) => `${n} traducidas`,
    workEditionsLink: (n) => `${n} ediciones y ejemplares de esta obra`,
    findPassages: 'Buscar pasajes',
    hidePassages: 'Ocultar pasajes',
    searchingEllipsis: 'Buscando...',
    searchingPages: 'Buscando en las páginas...',
    noMatchingPassages: 'No se han encontrado pasajes coincidentes en este libro.',
    untitled: '(sin título)',
    imageFromBook: (title) => `de ${title}`,
    digitized: 'Digitalizado',
    catalogOnly: 'Solo en catálogo',
    collectionBooks: (n) => `${n} libros`,
    illustrationFromCollection: (name) => `Ilustración de ${name}`,

    previous: 'Anterior',
    next: 'Siguiente',
    pageXofY: (x, y) => `Página ${x} de ${y}`,

    imagesEnglishNote: 'Las descripciones de las ilustraciones están indexadas en inglés, así que la búsqueda de imágenes usa palabras inglesas. Las imágenes se pueden explorar en cualquier idioma.',
  },
};

/**
 * Example queries for the empty-results screen, per locale: the leading common
 * noun translated, the names left alone.
 */
export const EXAMPLE_QUERIES: Record<Locale, string[]> = {
  en: ['alchemy', ...EXAMPLE_QUERY_PROPER_NOUNS],
  es: ['alquimia', ...EXAMPLE_QUERY_PROPER_NOUNS],
};
