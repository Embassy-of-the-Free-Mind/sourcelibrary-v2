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
    textEditionWitnesses: (n) => `A text edition: no page scans exist. The photographs show the ${n === 1 ? 'clay tablet' : `${n} clay tablets`} on which the composition survives (via CDLI); the text is not read from them.`,
    images: (n) => `${n} image${n === 1 ? '' : 's'}`,
    notTranscribed: 'Scans only, not transcribed yet',
    ocr: 'OCR',
    translated: 'Translated',
    translationComplete: 'Complete',
    ocrTooltip: (done, total) => `${done} of ${total} pages transcribed`,
    translatedTooltip: (n) => `${n} pages translated to English`,
    notTranscribedTooltip: (total) => `${total} scans available; no pages transcribed yet`,
    firstTranslationTooltip: 'First translation into English',
    noPriorTranslationTooltip: 'We searched the catalogues and found no earlier English translation. This is a record of the search, not proof none exists',
    pageAbbrev: (n) => `p. ${n}`,

    summary: 'About this book',
    summaryIsEnglish: 'Summary available in English.',
    readingGuide: 'Reading guide',
    englishText: 'In English.',
    contents: 'Contents',
    contentsAsPrinted: 'Contents (as printed)',
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
    textEditionWitnesses: (n) => `Edición de texto: no existen escaneos de página. Las fotografías muestran ${n === 1 ? 'la tablilla de arcilla' : `las ${n} tablillas de arcilla`} en que sobrevive la composición (vía CDLI); el texto no se leyó de ellas.`,
    images: (n) => `${n} ${n === 1 ? 'imagen' : 'imágenes'}`,
    notTranscribed: 'Solo escaneos, todavía sin transcribir',
    ocr: 'OCR',
    translated: 'Traducido',
    translationComplete: 'Completo',
    ocrTooltip: (done, total) => `${done} de ${total} páginas transcritas`,
    translatedTooltip: (n) => `${n} páginas traducidas al inglés`,
    notTranscribedTooltip: (total) => `${total} escaneos disponibles; ninguna página transcrita todavía`,
    firstTranslationTooltip: 'Primera traducción al inglés',
    noPriorTranslationTooltip: 'Hemos buscado en los catálogos y no hemos encontrado ninguna traducción al inglés anterior. Es el registro de una búsqueda, no la prueba de que no exista',
    pageAbbrev: (n) => `pág. ${n}`,

    summary: 'Sobre este libro',
    summaryIsEnglish: 'Resumen disponible en inglés.',
    readingGuide: 'Guía de lectura',
    englishText: 'En inglés.',
    contents: 'Contenido',
    contentsAsPrinted: 'Índice (tal como está impreso)',
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
  // Dutch (#6382). Draft copy, to be read by a native speaker before launch.
  // "Vertaling" throughout means the ENGLISH translation: nothing is translated
  // into Dutch, and on `/nl` the Dutch text is the book itself.
  nl: {
    backToCollection: 'Nederlandstalige boeken',
    read: 'Lezen',
    readInSpanish: 'Lees in het Nederlands',
    readThisBook: 'Dit boek lezen',
    originalTitle: 'Oorspronkelijke titel',
    originalLanguage: 'Oorspronkelijke taal',
    published: 'Uitgegeven',
    written: 'Geschreven',
    pages: 'pagina’s',
    spanishEdition: 'Nederlandse editie',
    spanishEditionOf: (es, total) => `${es} van ${total} pagina’s in het Nederlands`,
    firstTranslation: 'Eerste vertaling',
    noPriorTranslation: 'Geen eerdere vertaling gevonden',
    author: 'Auteur',
    editedBy: 'bezorgd door',
    scans: (n) => `${n} scans`,
    scansTooltip: 'Gescande afbeeldingen, inclusief omslagen en lege pagina’s.',
    pagesOfText: (n) => `${n} ${n === 1 ? 'pagina' : 'pagina’s'} tekst`,
    textEditionTooltip: 'Dit is een tekstuitgave. Van dit werk zijn geen pagina-afbeeldingen beschikbaar.',
    textEditionBy: (who) => `Een tekstuitgave, getranscribeerd en bezorgd door ${who}. Van dit werk zijn geen pagina-afbeeldingen beschikbaar.`,
    textEdition: 'Een tekstuitgave. Van dit werk zijn geen pagina-afbeeldingen beschikbaar.',
    textEditionWitnesses: (n) => `Een tekstuitgave: er bestaan geen paginascans. De foto’s tonen ${n === 1 ? 'het kleitablet' : `de ${n} kleitabletten`} waarop de tekst bewaard is gebleven (via CDLI); de tekst is er niet van afgelezen.`,
    images: (n) => `${n} ${n === 1 ? 'afbeelding' : 'afbeeldingen'}`,
    notTranscribed: 'Alleen scans, nog niet getranscribeerd',
    ocr: 'OCR',
    translated: 'Vertaald',
    translationComplete: 'Volledig',
    ocrTooltip: (done, total) => `${done} van ${total} pagina’s getranscribeerd`,
    translatedTooltip: (n) => `${n} pagina’s naar het Engels vertaald`,
    notTranscribedTooltip: (total) => `${total} scans beschikbaar; nog geen pagina’s getranscribeerd`,
    firstTranslationTooltip: 'Eerste vertaling in het Engels',
    noPriorTranslationTooltip: 'We hebben de catalogi doorzocht en geen eerdere Engelse vertaling gevonden. Dit is een verslag van die zoektocht, geen bewijs dat er geen bestaat',
    pageAbbrev: (n) => `p. ${n}`,

    summary: 'Over dit boek',
    summaryIsEnglish: 'Samenvatting beschikbaar in het Engels.',
    readingGuide: 'Leeswijzer',
    englishText: 'In het Engels.',
    contents: 'Inhoud',
    contentsAsPrinted: 'Inhoud (zoals gedrukt)',
    viewScan: 'Scan bekijken →',
    index: 'Register',
    indexTerms: (n) => `${n} termen`,
    majorThemes: 'Hoofdthema’s',
    filterIndex: (n) => `Filter ${n} trefwoorden...`,
    indexShowing: (shown, total) => `${shown} van ${total} trefwoorden getoond.`,
    indexHiddenHapax: (n) => ` ${n} termen die maar één keer voorkomen zijn verborgen.`,
    indexNoMatch: (q) => `Geen trefwoorden gevonden voor “${q}”`,
    more: (n) => `+${n} meer`,
    bibliographicInformation: 'Bibliografische gegevens',
    bookHistory: 'Geschiedenis van het boek',
    searchThisBook: 'Zoeken in dit boek',
    searchPlaceholder: 'Zoek een woord, naam of zinsdeel…',

    pagesHeading: 'Pagina’s',
    pagesShownOf: (shown, total) => `${shown} van ${total}`,
    pagesDigitizedBy: (who) => `Elke pagina gescand van het origineel, gedigitaliseerd door ${who}.`,
    pagesInReadingOrder: 'Elke pagina van de originele scan, in leesvolgorde.',
    loadMore: (remaining) => `Meer laden (nog ${remaining})`,
    overview: 'Overzicht',
    readAsOneDocument: 'Lezen als één document',
    noPagesYet: 'Nog geen pagina’s',

    illustrations: 'Illustraties',
    illustrationsNote: 'Platen, diagrammen en figuren die in de gescande pagina’s zijn gevonden.',
    viewAllIllustrations: (n) => `Alle ${n} illustraties bekijken`,
    relatedBooks: 'Verwante boeken',
    relatedBooksNote: 'Andere banden die qua auteur, onderwerp, plaats en periode dicht bij dit boek liggen.',

    tlEarlierEnglishTranslation: 'Eerdere Engelse vertaling',
    tlFirstEnglishPublished: 'Eerste Engelse vertaling verschenen',
    tlEnglishEditionPublished: 'Engelse editie verschenen',
    tlNewEditionPublished: 'Nieuwe editie verschenen',
    tlEarlier: 'Eerder',
    tlAiTranslationBy: 'Een met hulp van AI gemaakte Engelse vertaling van het origineel, vervaardigd en gepubliceerd door',
    tlVersion: (v) => `Versie ${v}`,
    tlDigitizedBy: (who) => `Gedigitaliseerd door ${who}`,
    tlDigitized: 'Gedigitaliseerd',
    tlAddedToSourceLibrary: 'Toegevoegd aan Source Library',
    tlEarlierTranslationExists: 'Er is al eerder een Engelse vertaling van dit werk verschenen.',
    view: 'Bekijken →',

    temporarilyUnavailable: 'Tijdelijk niet beschikbaar',
    temporarilyUnavailableBody: 'Dit boek laadt langzamer dan verwacht. Probeer het zo nog eens.',
    returnToLibrary: 'Terug naar de bibliotheek',

    fullPage: 'Volledige beschrijving (in het Engels)',
    fullPageNote: 'bibliografie, edities, illustraties, citaten.',
  },
  // Chinese (#6382). Draft copy, to be read by a native editor before launch.
  // "翻译/译文" throughout means the ENGLISH translation: nothing is translated
  // into Chinese, and on `/zh` the Chinese text is the book itself.
  zh: {
    backToCollection: '中文书籍',
    read: '阅读',
    readInSpanish: '阅读中文原文',
    readThisBook: '阅读本书',
    originalTitle: '原书名',
    originalLanguage: '原文语言',
    published: '出版',
    written: '成书',
    pages: '页',
    spanishEdition: '中文版',
    spanishEditionOf: (es, total) => `共 ${total} 页，其中 ${es} 页为中文`,
    firstTranslation: '首个译本',
    noPriorTranslation: '未发现更早的译本',
    author: '作者',
    editedBy: '编者',
    scans: (n) => `${n} 张扫描图`,
    scansTooltip: '扫描图像，含封面和空白页。',
    pagesOfText: (n) => `${n} 页文本`,
    textEditionTooltip: '这是文本版，本作品没有页面图像。',
    textEditionBy: (who) => `文本版，由${who}录入并校订。本作品没有页面图像。`,
    textEdition: '文本版，本作品没有页面图像。',
    textEditionWitnesses: (n) => `文本版：没有页面扫描。照片展示的是保存这部作品的${n === 1 ? '泥板' : ` ${n} 块泥板`}（来自 CDLI）；文本并非从照片中识读。`,
    images: (n) => `${n} 幅图像`,
    notTranscribed: '仅有扫描图，尚未转录',
    ocr: 'OCR',
    translated: '已翻译',
    translationComplete: '已全部翻译',
    ocrTooltip: (done, total) => `共 ${total} 页，已转录 ${done} 页`,
    translatedTooltip: (n) => `已有 ${n} 页译成英文`,
    notTranscribedTooltip: (total) => `有 ${total} 张扫描图；尚无页面转录`,
    firstTranslationTooltip: '首个英文译本',
    noPriorTranslationTooltip: '我们检索了各家书目，未找到更早的英文译本。这是检索记录，并不能证明确实不存在',
    pageAbbrev: (n) => `第 ${n} 页`,

    summary: '关于本书',
    summaryIsEnglish: '提供英文简介。',
    readingGuide: '阅读指南',
    englishText: '英文。',
    contents: '目录',
    contentsAsPrinted: '目录（据原书）',
    viewScan: '查看扫描图 →',
    index: '索引',
    indexTerms: (n) => `${n} 个词条`,
    majorThemes: '主要主题',
    filterIndex: (n) => `在 ${n} 个索引条目中筛选……`,
    indexShowing: (shown, total) => `显示 ${total} 个条目中的 ${shown} 个。`,
    indexHiddenHapax: (n) => `已隐藏 ${n} 个仅出现一次的词条。`,
    indexNoMatch: (q) => `没有与“${q}”匹配的条目`,
    more: (n) => `另有 ${n} 个`,
    bibliographicInformation: '书目信息',
    bookHistory: '本书沿革',
    searchThisBook: '在本书中搜索',
    searchPlaceholder: '查找字词、人名或短语……',

    pagesHeading: '页面',
    pagesShownOf: (shown, total) => `${shown} / ${total}`,
    pagesDigitizedBy: (who) => `每一页均扫描自原书，由${who}数字化。`,
    pagesInReadingOrder: '原书扫描的每一页，按阅读顺序排列。',
    loadMore: (remaining) => `加载更多（还有 ${remaining} 页）`,
    overview: '概览',
    readAsOneDocument: '作为单一文档阅读',
    noPagesYet: '暂无页面',

    illustrations: '插图',
    illustrationsNote: '从扫描页中识别出的图版、图表和图形。',
    viewAllIllustrations: (n) => `查看全部 ${n} 幅插图`,
    relatedBooks: '相关书籍',
    relatedBooksNote: '在作者、主题、地点和时代上与本书相近的其他书籍。',

    tlEarlierEnglishTranslation: '较早的英文译本',
    tlFirstEnglishPublished: '首个英文译本出版',
    tlEnglishEditionPublished: '英文版出版',
    tlNewEditionPublished: '新版出版',
    tlEarlier: '更早',
    tlAiTranslationBy: '原文的 AI 辅助英文译本，制作与发布者：',
    tlVersion: (v) => `版本 ${v}`,
    tlDigitizedBy: (who) => `由${who}数字化`,
    tlDigitized: '已数字化',
    tlAddedToSourceLibrary: '收入 Source Library',
    tlEarlierTranslationExists: '本作品已有较早的英文译本出版。',
    view: '查看 →',

    temporarilyUnavailable: '暂时无法访问',
    temporarilyUnavailableBody: '本书加载时间比预期长，请稍后再试。',
    returnToLibrary: '返回图书馆',

    fullPage: '完整记录（英文）',
    fullPageNote: '书目、版本、插图、引用。',
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
    feedbackThanks: 'Thank you. Your feedback helps improve this translation.',
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
    feedbackThanks: 'Gracias. Tus comentarios ayudan a mejorar esta traducción.',
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
  // Dutch (#6382). Draft copy, to be read by a native speaker before launch.
  // The `panel*` labels are the object of `toggle` ("Toon de vertaling").
  nl: {
    previousPage: 'Vorige pagina',
    nextPage: 'Volgende pagina',
    jumpToPage: 'Naar pagina',
    jumpToPageAria: (total) => `Naar pagina (1 tot ${total})`,
    pageOfAria: (n, total) => `Pagina ${n} van ${total}. Klik om naar een pagina te gaan`,
    arrowKeysHint: 'Gebruik de pijltjestoetsen ← → om te bladeren',
    swipeHint: 'Veeg naar links of rechts om te bladeren',

    panelVisibility: 'Zichtbare panelen',
    image: 'Afbeelding',
    ocr: 'OCR',
    romanized: 'Latijns schrift',
    german: 'Deutsch',
    translationTab: 'Vertaling',
    modernizedTab: 'Gemoderniseerd',
    toggle: (shown, what) => `${shown ? 'Verberg' : 'Toon'} ${what}`,
    panelSourceImage: 'de bronafbeelding',
    panelOriginalText: 'de oorspronkelijke tekst',
    panelRomanized: 'de tekst in Latijns schrift',
    panelGerman: 'de Duitse wetenschappelijke vertaling',
    panelTranslation: 'de vertaling',
    selectAPanel: 'Kies een paneel om te bekijken',

    sourceImage: 'Bronafbeelding',
    tabletPhoto: 'Foto van het tablet',
    source: 'Bron',
    noImage: 'Geen afbeelding beschikbaar',
    download: 'Downloaden',
    downloadFullRes: 'Downloaden in volledige resolutie',
    viewAt: (provider) => `Bekijken bij ${provider}`,

    notes: 'Noten',
    notesOff: 'Noten uit',
    hideNotes: 'Noten en metadata verbergen',
    showNotes: 'Noten en metadata tonen',
    info: 'Info',
    viewPageMetadata: 'Metadata van de pagina bekijken',
    copy: 'Kopiëren',
    copied: 'Gekopieerd',

    readingSettings: 'Leesinstellingen',
    fontSize: 'Lettergrootte',
    smaller: 'Kleiner (Cmd+-)',
    resetSize: 'Standaardgrootte (Cmd+0)',
    larger: 'Groter (Cmd+=)',
    theme: 'Thema',
    themePaper: 'Papier',
    themeSepia: 'Sepia',
    themeNight: 'Nacht',
    typeface: 'Letter',
    typeOriginal: 'Origineel',
    typeModern: 'Modern',
    typeOriginalTitle: 'Gezet in de letter waarin dit boek gedrukt is',
    typeModernTitle: 'Gezet in de leesletter van de hele bibliotheek',
    typeCaption: 'De romein van Griffo voor Aldus Manutius, overgenomen uit De Aetna van 1496.',

    likeThisPage: 'Deze pagina liken',
    likeSavePrefix: 'om hem te bewaren bij je',
    likeSavedPrefix: 'Bewaard bij je',
    likeFavoritesWord: 'favorieten',
    searchThisBook: 'Zoeken in dit boek...',
    searchWithinBook: 'Zoeken binnen dit boek',
    clearSearch: 'Zoekopdracht wissen',
    translationIssue: 'Zie je een fout in de vertaling? Laat het ons weten.',
    feedbackThanks: 'Dank je. Je feedback helpt deze vertaling te verbeteren.',
    feedbackWhat: 'Wat viel je op?',
    feedbackPlaceholder: 'Verkeerd woord, stroeve formulering, ontbrekende context...',
    cancel: 'Annuleren',
    send: 'Versturen',
    sending: 'Bezig met versturen...',

    contents: 'Inhoud',
    tableOfContents: 'Inhoudsopgave',
    chapterCount: (n) => `${n} hoofdstukken`,
    chapterAria: (title) => `Hoofdstuk: ${title}`,
    chapterShort: (n) => `Hfst. ${n}`,
    toc: 'Inhoud',
    close: 'Sluiten',
    pageAbbrev: (n) => `p. ${n}`,

    readingLanguage: 'Leestaal',
    pageNavigation: 'Paginanavigatie',
    metaPageOf: (n, title) => `Pagina ${n} van “${title}”`,
    metaTitle: (title, n) => `${title} - Pagina ${n}`,
    prevPageLink: (n) => `← Pagina ${n}`,
    nextPageLink: (n) => `Pagina ${n} →`,
    allPagesLink: (n) => `Alle ${n} pagina’s`,
  },
  // Chinese (#6382). Draft copy, to be read by a native editor before launch.
  // `toggle` joins verb and object with no space, as Chinese does.
  zh: {
    previousPage: '上一页',
    nextPage: '下一页',
    jumpToPage: '跳转到页',
    jumpToPageAria: (total) => `跳转到页（1 至 ${total}）`,
    pageOfAria: (n, total) => `第 ${n} 页，共 ${total} 页。点击跳转到指定页`,
    arrowKeysHint: '使用 ← → 方向键翻页',
    swipeHint: '左右滑动翻页',

    panelVisibility: '显示面板',
    image: '图像',
    ocr: 'OCR',
    romanized: '罗马字',
    german: 'Deutsch',
    translationTab: '译文',
    modernizedTab: '现代文',
    toggle: (shown, what) => `${shown ? '隐藏' : '显示'}${what}`,
    panelSourceImage: '原始图像',
    panelOriginalText: '原文',
    panelRomanized: '罗马字转写',
    panelGerman: '德文学术译本',
    panelTranslation: '译文',
    selectAPanel: '选择要查看的面板',

    sourceImage: '原始图像',
    tabletPhoto: '泥板照片',
    source: '来源',
    noImage: '暂无图像',
    download: '下载',
    downloadFullRes: '下载原始分辨率图像',
    viewAt: (provider) => `在 ${provider} 查看`,

    notes: '注释',
    notesOff: '注释已关闭',
    hideNotes: '隐藏注释和元数据',
    showNotes: '显示注释和元数据',
    info: '信息',
    viewPageMetadata: '查看页面元数据',
    copy: '复制',
    copied: '已复制',

    readingSettings: '阅读设置',
    fontSize: '字号',
    smaller: '缩小（Cmd+-）',
    resetSize: '恢复默认（Cmd+0）',
    larger: '放大（Cmd+=）',
    theme: '主题',
    themePaper: '纸张',
    themeSepia: '暖黄',
    themeNight: '夜间',
    typeface: '字体',
    typeOriginal: '原版',
    typeModern: '现代',
    typeOriginalTitle: '使用本书印刷时所用的字体',
    typeModernTitle: '使用全馆统一的阅读字体',
    typeCaption: 'Griffo 为 Aldus Manutius 刻制的罗马体，据 1496 年《De Aetna》描摹。',

    likeThisPage: '赞这一页',
    likeSavePrefix: '即可保存到您的',
    likeSavedPrefix: '已保存到您的',
    likeFavoritesWord: '收藏夹',
    searchThisBook: '在本书中搜索……',
    searchWithinBook: '在本书中搜索',
    clearSearch: '清除搜索',
    translationIssue: '发现译文有问题？请告诉我们。',
    feedbackThanks: '谢谢。您的反馈有助于改进这份译文。',
    feedbackWhat: '您发现了什么问题？',
    feedbackPlaceholder: '用词错误、表达生硬、缺少上下文……',
    cancel: '取消',
    send: '发送',
    sending: '正在发送……',

    contents: '目录',
    tableOfContents: '目录',
    chapterCount: (n) => `${n} 章`,
    chapterAria: (title) => `章节：${title}`,
    chapterShort: (n) => `第 ${n} 章`,
    toc: '目录',
    close: '关闭',
    pageAbbrev: (n) => `第 ${n} 页`,

    readingLanguage: '阅读语言',
    pageNavigation: '页面导航',
    metaPageOf: (n, title) => `《${title}》第 ${n} 页`,
    metaTitle: (title, n) => `${title} - 第 ${n} 页`,
    prevPageLink: (n) => `← 第 ${n} 页`,
    nextPageLink: (n) => `第 ${n} 页 →`,
    allPagesLink: (n) => `全部 ${n} 页`,
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

/** Dutch names (#6382). Dutch capitalises language names. An unlisted value is shown as stored. */
const LANGUAGE_NAMES_NL: Record<string, string> = {
  latin: 'Latijn', greek: 'Grieks', 'ancient greek': 'Oudgrieks', german: 'Duits', french: 'Frans',
  english: 'Engels', italian: 'Italiaans', spanish: 'Spaans', portuguese: 'Portugees', dutch: 'Nederlands',
  hebrew: 'Hebreeuws', arabic: 'Arabisch', persian: 'Perzisch', sanskrit: 'Sanskriet', hindi: 'Hindi', chinese: 'Chinees',
  russian: 'Russisch', akkadian: 'Akkadisch', sumerian: 'Sumerisch', syriac: 'Syrisch', coptic: 'Koptisch', tibetan: 'Tibetaans',
  nahuatl: 'Nahuatl', 'yucatec maya': 'Yucateeks Maya', "k'iche' maya": "K'iche' Maya", mixtec: 'Mixteeks',
  'maya hieroglyphs': 'Mayahiërogliefen', 'nahuatl-spanish': 'Nahuatl en Spaans', 'spanish / latin': 'Spaans en Latijn',
};
/**
 * Chinese names (#6382) for the `books.language` values. An unlisted value is
 * shown as stored.
 */
const LANGUAGE_NAMES_ZH: Record<string, string> = {
  latin: '拉丁文', greek: '希腊文', 'ancient greek': '古希腊文', german: '德文', french: '法文',
  english: '英文', italian: '意大利文', spanish: '西班牙文', portuguese: '葡萄牙文', dutch: '荷兰文',
  hebrew: '希伯来文', arabic: '阿拉伯文', persian: '波斯文', sanskrit: '梵文', hindi: '印地文', chinese: '中文',
  russian: '俄文', akkadian: '阿卡德文', sumerian: '苏美尔文', syriac: '叙利亚文', coptic: '科普特文', tibetan: '藏文',
  nahuatl: '纳瓦特尔文', 'yucatec maya': '尤卡坦玛雅文', "k'iche' maya": '基切玛雅文', mixtec: '米斯特克文',
  'maya hieroglyphs': '玛雅象形文字', 'nahuatl-spanish': '纳瓦特尔文和西班牙文', 'spanish / latin': '西班牙文和拉丁文',
};

const LANGUAGE_NAMES: Partial<Record<Locale, Record<string, string>>> = { es: LANGUAGE_NAMES_ES, la: LANGUAGE_NAMES_LA, nl: LANGUAGE_NAMES_NL, zh: LANGUAGE_NAMES_ZH };

export function languageName(lang: string | undefined | null, locale: Locale): string {
  if (!lang) return '';
  return LANGUAGE_NAMES[locale]?.[lang.toLowerCase()] || lang;
}
