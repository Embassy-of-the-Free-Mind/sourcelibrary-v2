import { withEnglishFallback, type Locale } from '@/lib/locale-path';

/**
 * Strings for the search page (`src/app/search/page.tsx`), which renders under
 * `/search`, `/es/search`, `/la/search` and `/zh/search` taking a `lang` prop — the same "one page,
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
  /** When the WORK was written, as opposed to when the copy was printed (#6873). */
  filterWrittenIn: string;
  anyTime: string;
  writtenInNote: (period: string) => string;
  browseByCentury: string;
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
  kindFeature: string;
  kindCollection: string;

  // ---- "Which Bacon?" — people who share a surname (#5950) ----
  whichName: (surname: string) => string;
  whichNameBody: string;
  namedInBooks: (n: number) => string;
  whichNameAuthor: string;

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
  fromTheSite: string;
  sitePageType: (type: 'blog' | 'collection' | 'page' | 'feature' | 'author') => string;
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
  /**
   * Under a book a reader cannot yet read, the way to a translated edition of
   * the same work (#5975). English requests only: the API does not send the
   * field on a localized one, so the other locales' strings are not rendered.
   */
  translatedEditionLink: (title: string, published?: string) => string;
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

// Latin and Chinese have their own (#7175). Dutch has no `/nl/search` twin and
// reads the English copy, which is never rendered under a Dutch URL. See
// `withEnglishFallback`.
export const SEARCH_STRINGS: Record<Locale, SearchStrings> = withEnglishFallback({
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
    filterWrittenIn: 'Work written',
    anyTime: 'Any time',
    writtenInNote: (period) => `Works written: ${period}. The year on each card is when that copy was made.`,
    browseByCentury: 'Browse works by century',
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
    signInBody: 'You’ve used your free searches for now. Sign in (it’s free) to keep exploring over 10,000 primary sources.',
    signInCta: 'Sign in for free',

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
    kindFeature: 'Tool',
    kindCollection: 'Collection',

    whichName: (surname) => `Which ${surname}?`,
    whichNameBody: 'More than one person in the library has this name.',
    namedInBooks: (n) => (n === 1 ? 'named in 1 book' : `named in ${n.toLocaleString('en')} books`),
    whichNameAuthor: 'Author page',

    illustrations: 'Illustrations',
    seeAllImages: 'See all images',
    semanticDegraded: 'Related results couldn’t be loaded just now, so you may be seeing fewer matches than we hold. Try again in a moment.',
    weakMatchTitle: (q) => `No strong matches for “${q}”`,
    weakMatchBody: 'Nothing in the library matches all of your search words. The results below match only part of your search.',
    conceptualMatches: 'Conceptual matches',
    textMatches: 'Text matches',
    seeAllResults: (n) => `See all ${n} results`,
    passages: 'Passages',
    searchingPageContent: 'Searching page content...',
    catalogMatches: 'Catalog matches',
    fromTheSite: 'From the site',
    sitePageType: (type) => (type === 'blog' ? 'Essay' : type === 'collection' ? 'Collection' : type === 'feature' ? 'Tool' : type === 'author' ? 'Author' : 'Page'),
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
    translatedEditionLink: (title, published) => `Translated edition: ${title}${published ? `, ${published}` : ''}`,
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
    filterWrittenIn: 'Obra escrita',
    anyTime: 'Cualquier época',
    writtenInNote: (period) => `Obras escritas: ${period}. El año de cada tarjeta es el de esa copia.`,
    browseByCentury: 'Obras por siglo',
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
    signInBody: 'Has agotado tus búsquedas gratuitas por ahora. Inicia sesión (es gratis) para seguir explorando más de 10.000 fuentes primarias.',
    signInCta: 'Inicia sesión gratis',

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
    kindFeature: 'Herramienta',
    kindCollection: 'Colección',

    whichName: (surname) => `¿Qué ${surname}?`,
    whichNameBody: 'Más de una persona en la biblioteca lleva este nombre.',
    namedInBooks: (n) => (n === 1 ? 'nombrado en 1 libro' : `nombrado en ${n.toLocaleString('es')} libros`),
    whichNameAuthor: 'Página del autor',

    illustrations: 'Ilustraciones',
    seeAllImages: 'Ver todas las imágenes',
    semanticDegraded: 'No se han podido cargar los resultados relacionados, así que puede que veas menos coincidencias de las que tenemos. Inténtalo de nuevo en un momento.',
    weakMatchTitle: (q) => `No hay coincidencias exactas para «${q}»`,
    weakMatchBody: 'Nada en la biblioteca coincide con todas las palabras de tu búsqueda. Los resultados siguientes coinciden solo con una parte.',
    conceptualMatches: 'Coincidencias conceptuales',
    textMatches: 'Coincidencias en el texto',
    seeAllResults: (n) => `Ver los ${n} resultados`,
    passages: 'Pasajes',
    searchingPageContent: 'Buscando en el texto de las páginas...',
    catalogMatches: 'Coincidencias en el catálogo',
    fromTheSite: 'En el sitio',
    sitePageType: (type) => (type === 'blog' ? 'Ensayo' : type === 'collection' ? 'Colección' : type === 'feature' ? 'Herramienta' : type === 'author' ? 'Autor' : 'Página'),
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
    translatedEditionLink: (title, published) => `Edición traducida: ${title}${published ? `, ${published}` : ''}`,
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

  // Latin (#7175). An original-text locale: the results are books written in
  // Latin and the excerpts are their own text, so the chrome says "Latin
  // books", not "translations". Plain Latin: no macrons, no Roman numerals.
  la: {
    numberLocale: 'en-US',

    searchPlaceholder: 'Quaere verbum in libris Latinis...',
    searchFailed: 'Quaestio non successit. Iterum tempta.',

    sortRelevance: 'Congruentia',
    sortYearNewest: 'Annus (recentissimi)',
    sortYearOldest: 'Annus (antiquissimi)',
    sortTitleAz: 'Titulus A-Z',

    browseRecentTranslation: 'Nuper conversi',
    browseRecent: 'Nuper additi',
    browseOldestFirst: 'Antiquissimi primi',
    browseNewestFirst: 'Recentissimi primi',
    browseTitleAsc: 'Titulus A-Z',
    browseTitleDesc: 'Titulus Z-A',

    tabAll: 'Omnia',
    tabBooks: 'Libri',
    tabIndex: 'Index',
    tabImages: 'Imagines',

    indexAllTypes: 'Omnia genera',
    indexConcepts: 'Notiones',
    indexPeople: 'Homines',
    indexPlaces: 'Loca',
    indexQuotes: 'Sententiae',
    indexKeywords: 'Verba praecipua',
    indexVocabulary: 'Vocabula',

    filters: 'Filtra',
    clear: 'Dele',
    clearAll: 'Omnia dele',
    done: 'Factum',
    filterLanguage: 'Lingua',
    filterSubject: 'Argumentum',
    filterCollection: 'Collectio',
    filterLibrary: 'Bibliotheca',
    filterPublishedAfter: 'Editum post annum',
    filterPublishedBefore: 'Editum ante annum',
    filterWrittenIn: 'Opus scriptum',
    anyTime: 'Quolibet tempore',
    writtenInNote: (period) => `Opera scripta: ${period}. Annus in quaque tabella est annus huius exemplaris.`,
    browseByCentury: 'Opera per saecula',
    allLanguages: 'Omnes linguae',
    allCategories: 'Omnia argumenta',
    allCollections: 'Omnes collectiones',
    allLibraries: 'Omnes bibliothecae',
    yearFromPlaceholder: 'ex. gr. 1500',
    yearToPlaceholder: 'ex. gr. 1700',
    hasTranslation: 'Conversionem habet',
    firstTranslation: 'Prima conversio',
    hasDoi: 'DOI habet',

    signInHeading: 'Nomen tuum inscribe ut quaerere pergas',
    signInBody: 'Quaestiones gratuitas in praesens consumpsisti. Nomen tuum inscribe (gratis est) ut plus quam decem milia fontium perscruteris.',
    signInCta: 'Gratis inscribe',

    show: 'Ostende',
    perPage: 'in pagina',
    showingRange: (from, to) => `(${from}–${to} ostenduntur)`,
    imagesCount: (n) => `${n} imagines`,
    booksCount: (n) => `${n} libri`,
    inCollection: 'in',
    browseFullCatalog: 'Totum catalogum percurre',
    allBooks: 'Omnes libri',
    andNMore: (n) => `+${n} alii`,

    noImagesFound: 'Nullae imagines inventae',
    noImagesBody: 'Tempta rem, figuram vel signum quaerere.',
    somethingWentWrong: 'Aliquid erravit',
    couldNotLoadLibrary: 'Bibliothecam nunc aperire non potuimus.',
    tryAgain: 'Iterum tempta',
    noBooksFound: 'Nulli libri inventi',
    adjustFilters: 'Filtra mutare tempta.',
    noResultsFound: 'Nihil inventum',
    didYouMean: 'An voluisti',
    corpusBlurb: 'Milia librorum Latine scriptorum: alchemia, Hermetica, Cabbala, philosophia naturalis, medicina, astronomia. Loci ex ipso textu Latino afferuntur.',
    browseAllBooks: 'Omnes libros percurre',

    kindReadingRoom: 'Conclave lectionis',
    kindLibrary: 'Bibliotheca socia',
    kindFeature: 'Instrumentum',
    kindCollection: 'Collectio',

    whichName: (surname) => `Quis ${surname}?`,
    whichNameBody: 'Plures in bibliotheca hoc nomen habent.',
    namedInBooks: (n) => (n === 1 ? 'in uno libro nominatur' : `in ${n.toLocaleString('en-US')} libris nominatur`),
    whichNameAuthor: 'Pagina auctoris',

    illustrations: 'Imagines',
    seeAllImages: 'Omnes imagines vide',
    semanticDegraded: 'Eventus cognati nunc afferri non potuerunt, itaque fortasse pauciora vides quam habemus. Mox iterum tempta.',
    weakMatchTitle: (q) => `Nihil plane congruit cum “${q}”`,
    weakMatchBody: 'Nihil in bibliotheca omnia verba tua continet. Quae infra sunt, partim tantum congruunt.',
    conceptualMatches: 'Sententia congruentes',
    textMatches: 'In textu inventa',
    seeAllResults: (n) => `Omnes ${n} eventus vide`,
    passages: 'Loci',
    searchingPageContent: 'In paginis quaeritur...',
    catalogMatches: 'In catalogo inventa',
    fromTheSite: 'Ex hoc situ',
    sitePageType: (type) => (type === 'blog' ? 'Commentarius' : type === 'collection' ? 'Collectio' : type === 'feature' ? 'Instrumentum' : type === 'author' ? 'Auctor' : 'Pagina'),
    works: (n) => (n === 1 ? 'opus' : 'opera'),
    searchingCatalog: 'In catalogo quaeritur...',
    openAllCatalogueMatches: (n) => `Omnia ${n} in catalogo inventa aperi`,
    relatedFromAi: 'Cognata ab intellegentia artificiosa inventa:',
    relatedInLibrary: 'Cognata in bibliotheca',

    foundBooksAndPages: (n, q) => `${n} libri et paginae pro “${q}”`,
    foundIndexEntries: (n, q) => `${n} lemmata indicis pro “${q}”`,
    foundImages: (n, q) => `${n} imagines pro “${q}”`,

    askLibrarian: 'Bibliothecarium interroga',
    askLibrarianBody: (scope) => `Altius inquirere vis? Bibliothecarius in ${scope} quaeret, fontes inter se conferet et commentarium conficiet quod exportare potes.`,
    askLibrarianScopeResults: (n) => `his ${n} eventibus`,
    askLibrarianScopeCollection: 'collectione',

    editedByAbbrev: 'ed.',
    pageAbbrev: (n) => `p. ${n}`,
    pagesCount: (n) => `${n} paginae`,
    translatedCount: (n) => `${n} Anglice conversae`,
    workEditionsLink: (n) => `${n} editiones et exemplaria huius operis`,
    translatedEditionLink: (title, published) => `Editio conversa: ${title}${published ? `, ${published}` : ''}`,
    findPassages: 'Locos quaere',
    hidePassages: 'Locos cela',
    searchingEllipsis: 'Quaeritur...',
    searchingPages: 'In paginis quaeritur...',
    noMatchingPassages: 'Nulli loci congruentes in hoc libro inventi.',
    untitled: '(sine titulo)',
    imageFromBook: (title) => `ex ${title}`,
    digitized: 'Photographice descriptus',
    catalogOnly: 'In catalogo tantum',
    collectionBooks: (n) => `${n} libri`,
    illustrationFromCollection: (name) => `Imago ex collectione ${name}`,

    previous: 'Prior',
    next: 'Sequens',
    pageXofY: (x, y) => `Pagina ${x} ex ${y}`,

    imagesEnglishNote: 'Imagines Anglice describuntur, itaque quaestio imaginum verbis Anglicis utitur. Imagines tamen quavis lingua percurri possunt.',
  },

  // Chinese (#7175), simplified script like the rest of the /zh chrome. The
  // results are books written in Chinese, quoted in their own text.
  zh: {
    numberLocale: 'zh-CN',

    searchPlaceholder: '在中文古籍中搜索字词……',
    searchFailed: '搜索失败，请重试。',

    sortRelevance: '相关度',
    sortYearNewest: '年份（由新到旧）',
    sortYearOldest: '年份（由旧到新）',
    sortTitleAz: '书名排序',

    browseRecentTranslation: '最近翻译',
    browseRecent: '最近添加',
    browseOldestFirst: '最早的在前',
    browseNewestFirst: '最新的在前',
    browseTitleAsc: '书名（正序）',
    browseTitleDesc: '书名（倒序）',

    tabAll: '全部',
    tabBooks: '书籍',
    tabIndex: '索引',
    tabImages: '图像',

    indexAllTypes: '全部类型',
    indexConcepts: '概念',
    indexPeople: '人物',
    indexPlaces: '地点',
    indexQuotes: '引文',
    indexKeywords: '关键词',
    indexVocabulary: '词汇',

    filters: '筛选',
    clear: '清除',
    clearAll: '全部清除',
    done: '完成',
    filterLanguage: '语言',
    filterSubject: '主题',
    filterCollection: '专题',
    filterLibrary: '藏书机构',
    filterPublishedAfter: '出版晚于',
    filterPublishedBefore: '出版早于',
    filterWrittenIn: '成书年代',
    anyTime: '不限',
    writtenInNote: (period) => `成书年代：${period}。每张卡片上的年份是该版本的刊印年份。`,
    browseByCentury: '按世纪浏览',
    allLanguages: '全部语言',
    allCategories: '全部主题',
    allCollections: '全部专题',
    allLibraries: '全部藏书机构',
    yearFromPlaceholder: '如 1500',
    yearToPlaceholder: '如 1700',
    hasTranslation: '有译文',
    firstTranslation: '首次翻译',
    hasDoi: '有 DOI',

    signInHeading: '登录后继续搜索',
    signInBody: '您暂时已用完免费搜索次数。登录（免费）即可继续浏览一万多部原始文献。',
    signInCta: '免费登录',

    show: '每页显示',
    perPage: '条',
    showingRange: (from, to) => `（显示第 ${from}–${to} 条）`,
    imagesCount: (n) => `${n} 幅图像`,
    booksCount: (n) => `${n} 部书`,
    inCollection: '· 专题',
    browseFullCatalog: '浏览完整目录',
    allBooks: '全部书籍',
    andNMore: (n) => `另有 ${n} 项`,

    noImagesFound: '未找到图像',
    noImagesBody: '试试搜索某个主题、人物或符号。',
    somethingWentWrong: '出错了',
    couldNotLoadLibrary: '暂时无法加载书库。',
    tryAgain: '重试',
    noBooksFound: '未找到书籍',
    adjustFilters: '请尝试调整筛选条件。',
    noResultsFound: '未找到结果',
    didYouMean: '您是不是要找',
    corpusBlurb: '以中文写成的古籍：医学、本草、易学、天文、道教、炼丹等。摘录取自原书文字。',
    browseAllBooks: '浏览全部书籍',

    kindReadingRoom: '阅览室',
    kindLibrary: '合作图书馆',
    kindFeature: '工具',
    kindCollection: '专题',

    whichName: (surname) => `哪一位${surname}？`,
    whichNameBody: '书库中有不止一人使用这个名字。',
    namedInBooks: (n) => `见于 ${n.toLocaleString('zh-CN')} 部书`,
    whichNameAuthor: '作者页面',

    illustrations: '插图',
    seeAllImages: '查看全部图像',
    semanticDegraded: '相关结果暂时无法加载，您看到的结果可能少于实际馆藏。请稍后再试。',
    weakMatchTitle: (q) => `没有与“${q}”完全匹配的结果`,
    weakMatchBody: '书库中没有同时包含所有搜索词的内容。以下结果仅部分匹配。',
    conceptualMatches: '语义相关',
    textMatches: '文本匹配',
    seeAllResults: (n) => `查看全部 ${n} 条结果`,
    passages: '段落',
    searchingPageContent: '正在搜索页面内容……',
    catalogMatches: '目录匹配',
    fromTheSite: '本站内容',
    sitePageType: (type) => (type === 'blog' ? '文章' : type === 'collection' ? '专题' : type === 'feature' ? '工具' : type === 'author' ? '作者' : '页面'),
    works: () => '部作品',
    searchingCatalog: '正在搜索目录……',
    openAllCatalogueMatches: (n) => `打开全部 ${n} 条目录匹配`,
    relatedFromAi: 'AI 扩展搜索的相关结果：',
    relatedInLibrary: '书库中的相关内容',

    foundBooksAndPages: (n, q) => `找到 ${n} 条与“${q}”相关的书籍和页面`,
    foundIndexEntries: (n, q) => `找到 ${n} 条与“${q}”相关的索引条目`,
    foundImages: (n, q) => `找到 ${n} 幅与“${q}”相关的图像`,

    askLibrarian: '询问图书馆员',
    askLibrarianBody: (scope) => `想深入研究？图书馆员会在${scope}中检索、对照各种来源，并整理成可导出的研究笔记。`,
    askLibrarianScopeResults: (n) => `这 ${n} 条结果`,
    askLibrarianScopeCollection: '该专题',

    editedByAbbrev: '编',
    pageAbbrev: (n) => `第 ${n} 页`,
    pagesCount: (n) => `${n} 页`,
    translatedCount: (n) => `已译 ${n} 页`,
    workEditionsLink: (n) => `此作品的 ${n} 个版本与副本`,
    translatedEditionLink: (title, published) => `译本：${title}${published ? `，${published}` : ''}`,
    findPassages: '查找段落',
    hidePassages: '收起段落',
    searchingEllipsis: '正在搜索……',
    searchingPages: '正在搜索页面……',
    noMatchingPassages: '本书中未找到匹配的段落。',
    untitled: '（无题）',
    imageFromBook: (title) => `出自 ${title}`,
    digitized: '已数字化',
    catalogOnly: '仅有目录',
    collectionBooks: (n) => `${n} 部书`,
    illustrationFromCollection: (name) => `${name}中的插图`,

    previous: '上一页',
    next: '下一页',
    pageXofY: (x, y) => `第 ${x} 页，共 ${y} 页`,

    imagesEnglishNote: '插图说明以英文编入索引，因此图像搜索使用英文词语。图像本身可以用任何语言浏览。',
  },
});

/**
 * Example queries for the empty-results screen, per locale: the leading common
 * noun translated, the names left alone.
 */
export const EXAMPLE_QUERIES: Record<Locale, string[]> = withEnglishFallback({
  en: ['alchemy', ...EXAMPLE_QUERY_PROPER_NOUNS],
  es: ['alquimia', ...EXAMPLE_QUERY_PROPER_NOUNS],
  // An original-text locale searches books written in its language, so its
  // examples are words those books print (#7175), not the English list's names.
  la: ['alchemia', 'lapis philosophorum', 'anima mundi', 'Hermes', 'Paracelsus'],
  zh: ['陰陽', '五行', '本草', '周易', '丹'],
});
