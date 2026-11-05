// Full homepage localization dictionary. Unlike the old hero-only client swap,
// this drives a real, server-rendered, indexable page at `/es` (and the English
// `/` page reads the `en` branch). Both routes render the same <HomeView>, so
// the chrome can never silently diverge between languages.
//
// Scope note: this localizes the homepage *chrome* (headings, copy, CTAs, the
// footer essay). Book titles and translations themselves remain in their stored
// language — the corpus is overwhelmingly translated to English, so `/es` is an
// honest Spanish gateway into the library, not a promise of Spanish content.

import type { Locale } from './i18n';

export type HomeLang = Locale;

export interface HomeStrings {
  // <html lang> + number formatting
  locale: string;

  // Hero
  heroTitle: string;
  heroSubtitleLine1: string;
  heroSubtitleLine2: string;
  emailPlaceholder: string;
  join: string;
  sending: string;
  checkEmail: string;
  differentEmail: string;
  google: string;
  googleBlockedNote: string;
  emailError: string;
  didYouMean: (suggestion: string) => string;
  haveAccount: string;
  explore: string;
  langEnglish: string;
  langSpanish: string;
  // Banner shown on `/` to es-locale visitors, linking to `/es`
  suggestSpanish: string;
  dismiss: string;
  // Librarian hero prompt — primary front-door action (#3059 follow-on)
  librarianPlaceholder: string;
  librarianHint: string;
  librarianAsk: string;
  heroSignupLead: string;
  heroSignupCta: string;
  heroSearchInstead: string;
  // "Ask the source" librarian band (below the hero)
  askSourceHeading: string;
  askSourceSubtitle: string;

  // Collections section
  collectionsHeading: string;
  translationsLabel: string;
  firstTimeLabel: string;
  artworksLabel: string;
  illustrationsLabel: string;
  browseCatalog: string;
  booksLabel: string;
  /**
   * Suffix on a collection card's second count: "1.234 libros · 57 en español".
   * Never rendered on the English homepage — every book there is already in the
   * page's language — but it lives in both dictionaries so the two editions keep
   * one shape (the rule at the top of this file).
   */
  inThisLanguage: string;
  seeMore: (n: number) => string;
  collectionsWord: string;
  curatedExhibitions: string;
  allCollections: string;
  /** Small caps line above the Collections heading: what the showcase IS. */
  showcaseEyebrow: string;
  /** One sentence under the heading saying why an exhibition is worth opening. */
  showcaseSubtitle: string;
  /** "All 60 exhibitions" — the link to /curated. */
  allExhibitions: (n: number) => string;
  /** Featured Collection band (`EditorialSpread`, #7076). */
  featuredCollectionEyebrow: string;
  exploreCollectionBooks: (n: number) => string;
  /** The subject index heading under the showcase. */
  bySubjectHeading: string;
  /** The stats line's lead-in: "Everything in the library:" */
  bySubjectLead: string;

  // Recently translated slider
  recentlyTranslatedHeading: string;
  recentlyTranslatedSubtitle: string;

  // Most liked slider
  mostLikedHeading: string;
  mostLikedSubtitle: string;

  // "Read in Spanish" slider — rendered on /es only (HomeData.spanishBooks is
  // empty on the English homepage), but the strings live in both dictionaries
  // so the two editions keep one shape.
  spanishHeading: string;
  /** The shelf of books WRITTEN in the page's language. Rendered on `/la` only (#6254). */
  nativeShelfHeading: string;
  nativeShelfSubtitle: string;
  /** The subtitle with the live count of books in the page's language, when the count loaded. */
  nativeShelfTotal?: (n: number) => string;
  nativeShelfAll: string;
  /** The beginner's shelf under it (`/la` only): readable Latin a teacher can assign. */
  beginnerShelfHeading: string;
  beginnerShelfSubtitle: string;
  /** The `/la` "Nondum conversi" band (#6278): Latin books not readable in English. Rendered on `/la` only. */
  untranslatedShelfHeading: string;
  /** `n` is the live count, measured when the page is rendered. */
  untranslatedShelfSubtitle: (n: number) => string;
  spanishSubtitle: string;

  // Gallery masonry (homepage)
  galleryHeading: string;
  gallerySubtitle: string;
  galleryViewAll: (n: number) => string;

  // Discover section
  discoverHeading: string;
  discoverSubtitle: string;
  discoverEmpty: string;

  // Blog section
  blogHeading: string;
  blogSubtitle: string;
  blogAllPosts: string;
  tagDeepDive: string;
  tagCollection: string;

  // About section

  // Be part of this
  // The about wall and the support section under it (home-about/).
  wallTitle: string;
  wallBody: string;
  wallCta: string;
  joinTitle: string;
  joinBody: string;
  joinDonate: string;
  joinAccount: string;
  joinAccountBody: string;
  joinVolunteer: string;
  joinVolunteerBody: string;
  joinBuild: string;
  joinBuildBody: string;
  contribute: string;
  developers: string;

  // Search section
  searchHeading: string;
  searchPlaceholder: string;
  browseBy: string;
  byTitle: string;
  byAuthor: string;
  byYear: string;
  byImages: string;

  // Footer essay
}

const en: HomeStrings = {
  locale: 'en-US',

  heroTitle: 'A New Renaissance of Ancient Wisdom',
  heroSubtitleLine1: 'Welcome to the world’s largest library',
  heroSubtitleLine2: 'of AI-translated ancient sources.',
  emailPlaceholder: 'Your email address',
  join: 'Join us',
  sending: 'Sending…',
  checkEmail: 'Check your email. We sent a sign-in link to',
  differentEmail: 'Use a different email',
  google: 'Or continue with Google',
  googleBlockedNote: 'Google sign-in is usually blocked in in-app browsers. Use email above, or open this page in Safari/Chrome.',
  emailError: 'Could not send the sign-in link. Please try again.',
  didYouMean: (suggestion) => `Did you mean ${suggestion}?`,
  haveAccount: 'Already have an account?',
  explore: 'Explore the collection',
  langEnglish: 'English',
  langSpanish: 'Español',
  suggestSpanish: 'Ver esta página en español',
  dismiss: 'Dismiss',
  librarianPlaceholder: 'Ask the source anything…',
  librarianHint: 'e.g. “What did Newton write about prophecy?”',
  librarianAsk: 'Ask',
  heroSignupLead: 'New here? Sign up to save your reading.',
  heroSignupCta: 'Sign up to save your reading →',
  heroSearchInstead: 'Or search the collection →',
  askSourceHeading: 'Ask the source',
  askSourceSubtitle: 'Put a question to thousands of primary sources and get an answer, with citations to the originals you can read for yourself.',

  collectionsHeading: 'Collections',
  translationsLabel: 'readable in English',
  firstTimeLabel: 'for the first time',
  artworksLabel: 'artworks',
  illustrationsLabel: 'illustrations',
  browseCatalog: 'Browse Catalog',
  booksLabel: 'books',
  inThisLanguage: 'in English',
  seeMore: (n) => `See ${n} more`,
  collectionsWord: 'collections',
  curatedExhibitions: 'Browse curated exhibitions',
  allCollections: 'All collections',
  showcaseEyebrow: 'Curated exhibitions',
  showcaseSubtitle: 'One subject per shelf, a few dozen books each, with a short introduction to what you will find.',
  allExhibitions: (n) => `All ${n} exhibitions`,
  featuredCollectionEyebrow: 'Featured Collection',
  exploreCollectionBooks: (n) => `Explore ${n} books`,
  bySubjectHeading: 'Browse by subject',
  bySubjectLead: 'The whole library:',

  recentlyTranslatedHeading: 'Recently translated',
  recentlyTranslatedSubtitle: 'The latest works Source Library has brought into a modern, readable translation.',
  mostLikedHeading: 'Readers’ favorites',
  mostLikedSubtitle: 'The books readers have liked most. Found one you love? Tap the ♥ on its page to add your vote.',
  spanishHeading: 'Read in Spanish',
  nativeShelfHeading: 'Latin books',
  nativeShelfSubtitle: 'Books written in Latin, read here in the original.',
  nativeShelfAll: 'All Latin books',
  beginnerShelfHeading: 'For beginners',
  beginnerShelfSubtitle: 'Easier Latin: the schoolbooks, dialogues, fables and short histories that generations of pupils learned from.',
  untranslatedShelfHeading: 'Not yet translated',
  untranslatedShelfSubtitle: (n) => `Here are ${n.toLocaleString('en-US')} Latin books we have not yet translated into English, the most read first. Each opens on its page scans, and on its Latin text where that has been transcribed.`,
  spanishSubtitle: 'The works in the library that already have a Spanish edition, page by page beside the original.',
  galleryHeading: 'Gallery',
  gallerySubtitle: 'Plates, figures, and engravings from rare books across the library.',
  galleryViewAll: (n) => `View all ${n.toLocaleString('en-US')} illustrations`,
  discoverHeading: 'Discover',
  discoverSubtitle: 'Translated primary sources from the collection.',
  discoverEmpty: 'Browse the collection to discover translated primary sources.',

  blogHeading: 'Articles',
  blogSubtitle: 'Stories, reading tours and research drawn from the books in the library, each quotation linked to the page it comes from',
  blogAllPosts: 'All articles',
  tagDeepDive: 'Deep dive',
  tagCollection: 'Collection',


  wallTitle: 'We think it is time for another Renaissance',
  wallBody: 'In the 1400s, translating Plato and other ancient writers helped spark the Renaissance. Today, fewer than 1 in 100 historical texts can be read in English. Our mission is to translate humanity’s written heritage, with help from AI, so anyone can read it.',
  wallCta: 'Read our story',
  joinTitle: 'Help fund the next first translation',
  joinBody: 'The translations are free to read. Donations fund the scanning, the translating and keeping the library online.',
  joinDonate: 'Donate',
  joinAccount: 'Create a free account',
  joinAccountBody: 'Save books and keep track of your reading.',
  joinVolunteer: 'Volunteer',
  joinVolunteerBody: 'Help translate, review or improve the collection.',
  joinBuild: 'Build on it',
  joinBuildBody: 'An API, a CLI and an MCP server for research tools and AI.',
  contribute: 'Contribute',
  developers: 'Developers',

  searchHeading: 'Search the collection',
  searchPlaceholder: 'Try “Hermes Trismegistus” or “prima materia”...',
  browseBy: 'or browse by',
  byTitle: 'title',
  byAuthor: 'author',
  byYear: 'year',
  byImages: 'images',


};

const es: HomeStrings = {
  locale: 'es-ES',

  heroTitle: 'Un nuevo Renacimiento de la sabiduría antigua',
  heroSubtitleLine1: 'Bienvenido a la mayor biblioteca del mundo',
  heroSubtitleLine2: 'de fuentes antiguas traducidas con IA.',
  emailPlaceholder: 'Tu correo electrónico',
  join: 'Únete',
  sending: 'Enviando…',
  checkEmail: 'Revisa tu correo. Enviamos un enlace de acceso a',
  differentEmail: 'Usar otro correo',
  google: 'O continúa con Google',
  googleBlockedNote: 'El acceso con Google suele estar bloqueado en navegadores internos. Usa el correo de arriba, o abre esta página en Safari/Chrome.',
  emailError: 'No se pudo enviar el enlace de acceso. Inténtalo de nuevo.',
  didYouMean: (suggestion) => `¿Quisiste decir ${suggestion}?`,
  haveAccount: '¿Ya tienes una cuenta?',
  explore: 'Explora la colección',
  langEnglish: 'English',
  langSpanish: 'Español',
  suggestSpanish: 'View this page in English',
  dismiss: 'Cerrar',
  librarianPlaceholder: 'Pregúntale a la fuente lo que quieras…',
  librarianHint: 'p. ej. «¿Qué escribió Newton sobre la profecía?»',
  librarianAsk: 'Preguntar',
  heroSignupLead: '¿Primera vez aquí? Regístrate para guardar tu lectura.',
  heroSignupCta: 'Regístrate para guardar tu lectura →',
  heroSearchInstead: 'O busca en la colección →',
  askSourceHeading: 'Pregúntale a la fuente',
  askSourceSubtitle: 'Haz una pregunta a miles de fuentes primarias y recibe una respuesta, con citas a los originales que puedes leer por ti mismo.',

  collectionsHeading: 'Colecciones',
  translationsLabel: 'legibles en inglés',
  firstTimeLabel: 'por primera vez',
  artworksLabel: 'obras de arte',
  illustrationsLabel: 'ilustraciones',
  browseCatalog: 'Explorar el catálogo',
  booksLabel: 'libros',
  inThisLanguage: 'en español',
  seeMore: (n) => `Ver ${n} más`,
  collectionsWord: 'colecciones',
  curatedExhibitions: 'Explorar exposiciones comisariadas',
  allCollections: 'Todas las colecciones',
  showcaseEyebrow: 'Exposiciones comisariadas',
  showcaseSubtitle: 'Un tema por estante, unas docenas de libros cada uno, con una breve introducción a lo que contiene.',
  allExhibitions: (n) => `Las ${n} exposiciones`,
  featuredCollectionEyebrow: 'Colección destacada',
  exploreCollectionBooks: (n) => `Explorar ${n} libros`,
  bySubjectHeading: 'Explorar por tema',
  bySubjectLead: 'Toda la biblioteca:',

  recentlyTranslatedHeading: 'Para leer en español',
  recentlyTranslatedSubtitle: 'Las obras más leídas de la biblioteca que ya tienen edición en español, traducidas por Source Library o escritas en castellano.',
  mostLikedHeading: 'Las favoritas de los lectores',
  mostLikedSubtitle: 'Los libros que más les han gustado a los lectores. ¿Encontraste uno que te encanta? Pulsa el ♥ en su página para sumar tu voto.',
  spanishHeading: 'Leer en español',
  nativeShelfHeading: 'Libros en latín',
  nativeShelfSubtitle: 'Libros escritos en latín, para leer aquí en el original.',
  nativeShelfAll: 'Todos los libros en latín',
  beginnerShelfHeading: 'Para principiantes',
  beginnerShelfSubtitle: 'Latín más fácil: los manuales, diálogos, fábulas e historias breves con que aprendieron generaciones de alumnos.',
  untranslatedShelfHeading: 'Aún sin traducir',
  untranslatedShelfSubtitle: (n) => `${n.toLocaleString('es-ES')} libros en latín que aún no hemos traducido al inglés, primero los más leídos.`,
  spanishSubtitle: 'Las obras de la biblioteca que ya cuentan con una edición en español, página a página junto al original.',
  galleryHeading: 'Galería',
  gallerySubtitle: 'Láminas, figuras y grabados de libros raros de toda la biblioteca.',
  galleryViewAll: (n) => `Ver las ${n.toLocaleString('es-ES')} ilustraciones`,
  discoverHeading: 'Descubre',
  discoverSubtitle: 'Fuentes primarias traducidas de la colección.',
  discoverEmpty: 'Explora la colección para descubrir fuentes primarias traducidas.',

  blogHeading: 'Artículos (en inglés)',
  blogSubtitle: 'Historias, recorridos de lectura e investigación a partir de los libros de la biblioteca, cada cita enlazada a la página de la que procede',
  blogAllPosts: 'Todos los artículos',
  tagDeepDive: 'Análisis',
  tagCollection: 'Colección',


  wallTitle: 'Creemos que es hora de otro Renacimiento',
  wallBody: 'En el siglo XV, traducir a Platón y a otros clásicos ayudó a encender el Renacimiento. Hoy, menos de 1 de cada 100 textos históricos puede leerse en inglés. Nuestra misión: traducir el legado escrito humano, con ayuda de la IA, para que todos lo lean.',
  wallCta: 'Conócenos',
  joinTitle: 'Apoya la próxima primera traducción',
  joinBody: 'Leer las traducciones es gratis. Las donaciones pagan el escaneo, la traducción y la biblioteca en línea.',
  joinDonate: 'Donar',
  joinAccount: 'Crea tu cuenta gratis',
  joinAccountBody: 'Guarda libros y sigue tus lecturas.',
  joinVolunteer: 'Colabora',
  joinVolunteerBody: 'Ayuda a traducir, revisar o mejorar la colección.',
  joinBuild: 'Desarrolla',
  joinBuildBody: 'API, CLI y servidor MCP para investigación e IA.',
  contribute: 'Contribuye',
  developers: 'Desarrolladores',

  searchHeading: 'Busca en la colección',
  searchPlaceholder: 'Prueba «Hermes Trismegisto» o «prima materia»...',
  browseBy: 'o explora por',
  byTitle: 'título',
  byAuthor: 'autor',
  byYear: 'año',
  byImages: 'imágenes',


};

// Latin (#6254). The corpus is the reverse of the Spanish case: nothing is
// translated INTO Latin, but Latin is the largest ORIGINAL language we hold, so
// `/la` is a Latin front door onto books that are already Latin. Draft copy —
// read by a Latinist before launch (see the issue); corrections go here.
const la: HomeStrings = {
  // Number formatting only. There is no dependable `la` data in ICU, and an
  // unknown tag falls back to the RUNTIME default, which differs between the
  // server and a reader's browser: a hydration mismatch. Pin it.
  locale: 'en-US',

  heroTitle: 'Nova Antiquae Sapientiae Renascentia',
  heroSubtitleLine1: 'Intrate maximam orbis terrarum bibliothecam',
  heroSubtitleLine2: 'fontium antiquorum intellegentia artificiali conversorum.',
  emailPlaceholder: 'Inscriptio electronica tua',
  join: 'Nomen da',
  sending: 'Mittitur…',
  checkEmail: 'Epistulas tuas inspice: nexum ad intrandum misimus ad',
  differentEmail: 'Alia inscriptione utere',
  google: 'Vel per Google perge',
  googleBlockedNote: 'Aditus per Google in navigatris intra applicationes plerumque impeditur: inscriptione electronica supra utere, vel hanc paginam in Safari aut Chrome aperi.',
  emailError: 'Nexus mitti non potuit. Iterum tempta, quaeso.',
  didYouMean: (suggestion) => `Num ${suggestion} voluisti?`,
  haveAccount: 'Iam rationem habes?',
  explore: 'Bibliothecam perlustra',
  langEnglish: 'English',
  langSpanish: 'Español',
  suggestSpanish: 'Ver esta página en español',
  dismiss: 'Dimitte',
  librarianPlaceholder: 'Fontes quidlibet roga…',
  librarianHint: 'exempli gratia: «Quid Newtonus de prophetiis scripsit?»',
  librarianAsk: 'Roga',
  heroSignupLead: 'Novus hic es? Nomen da, ut lecta serves.',
  heroSignupCta: 'Nomen da, ut lecta serves →',
  heroSearchInstead: 'Vel in bibliotheca quaere →',
  askSourceHeading: 'Fontes interroga',
  askSourceSubtitle: 'Quaestionem milibus fontium primariorum propone et responsum accipe, locis ex ipsis libris allatis quos tute legere potes.',

  collectionsHeading: 'Collectiones',
  translationsLabel: 'Anglice legibiles',
  firstTimeLabel: 'nunc primum',
  artworksLabel: 'opera artis',
  illustrationsLabel: 'imagines',
  browseCatalog: 'Catalogum perlustra',
  booksLabel: 'libri',
  inThisLanguage: 'Latine',
  seeMore: (n) => `Plura ostende (${n})`,
  collectionsWord: 'collectiones',
  curatedExhibitions: 'Expositiones curatas perlustra',
  allCollections: 'Omnes collectiones',
  showcaseEyebrow: 'Expositiones curatae',
  showcaseSubtitle: 'Una materia in quoque pluteo, libri aliquot decades, cum brevi praefatione.',
  allExhibitions: (n) => `Omnes expositiones (${n})`,
  featuredCollectionEyebrow: 'Collectio insignis',
  exploreCollectionBooks: (n) => `Omnes libri (${n})`,
  bySubjectHeading: 'Per argumenta perlustra',
  bySubjectLead: 'Tota bibliotheca:',

  recentlyTranslatedHeading: 'Nuper conversa',
  recentlyTranslatedSubtitle: 'Opera quae Source Library novissime in sermonem hodiernum convertit.',
  mostLikedHeading: 'Lectoribus gratissima',
  mostLikedSubtitle: 'Libri quos lectores maxime probaverunt. Si quem amas, signum ♥ in eius pagina tange, ut suffragium addas.',
  spanishHeading: 'Hispanice lege',
  nativeShelfHeading: 'Libri Latini',
  nativeShelfSubtitle: 'Libri Latine scripti, quos hic in ipso textu Latino legere potes.',
  nativeShelfAll: 'Omnes libri Latini',
  beginnerShelfHeading: 'Tironibus',
  beginnerShelfSubtitle: 'Libri faciliores, e quibus discipuli olim linguam Latinam discebant: libelli scholastici, colloquia, fabulae, historiae breves.',
  untranslatedShelfHeading: 'Nondum conversi',
  untranslatedShelfSubtitle: (n) => `Hic sunt ${n.toLocaleString('en-US')} libri Latini quos nondum Anglice convertimus. Primi stant qui plurimum leguntur. Quisque in imaginibus paginarum aperitur, et in textu Latino ubi iam transcriptus est.`,
  spanishSubtitle: 'Opera quae iam editionem Hispanicam habent, paginatim iuxta textum primigenium.',
  galleryHeading: 'Pinacotheca',
  gallerySubtitle: 'Tabulae, figurae, imagines aere incisae ex libris raris totius bibliothecae.',
  galleryViewAll: (n) => `Omnes ${n.toLocaleString('en-US')} imagines specta`,
  discoverHeading: 'Inveni',
  discoverSubtitle: 'Fontes primarii conversi ex bibliotheca.',
  discoverEmpty: 'Bibliothecam perlustra, ut fontes primarios conversos invenias.',

  // The posts themselves are English, so the heading says so (i18n.md rule 4:
  // what is not in the page's language is labelled, never passed off).
  blogHeading: 'Commentarii (Anglice)',
  blogSubtitle: 'Historiae, itinera legendi et investigationes ex libris bibliothecae, singulis locis ad paginam suam coniunctis',
  blogAllPosts: 'Omnes commentarii',
  tagDeepDive: 'Disquisitio',
  tagCollection: 'Collectio',


  wallTitle: 'Tempus novae Renascentiae adesse putamus',
  wallBody: 'Saeculo XV Plato aliique antiqui conversi Renascentiam accendere adiuverunt. Hodie minus quam unum e centum scriptis historicis Anglice legi potest. Propositum est hereditatem hominum, intellegentia artificiali adiuvante, convertere, ut omnes legant.',
  wallCta: 'Historiam lege',
  joinTitle: 'Proximam primam conversionem adiuva',
  joinBody: 'Conversiones gratis leguntur. Dona sustentant imagines, conversiones, bibliothecam in rete servatam.',
  joinDonate: 'Dona',
  joinAccount: 'Rationem gratis crea',
  joinAccountBody: 'Libros serva et lecta tua sequere.',
  joinVolunteer: 'Adiuva',
  joinVolunteerBody: 'Converte, recense, bibliothecam emenda.',
  joinBuild: 'Aedifica',
  joinBuildBody: 'API, CLI, servus MCP ad instrumenta investigationis.',
  contribute: 'Operam confer',
  developers: 'Programmatores',

  searchHeading: 'In bibliotheca quaere',
  searchPlaceholder: 'Tempta “Hermes Trismegistus” vel “prima materia”...',
  browseBy: 'vel perlustra per',
  byTitle: 'titulos',
  byAuthor: 'auctores',
  byYear: 'annos',
  byImages: 'imagines',


};

// Dutch (#6382). The mirror of the Latin case: nothing is translated INTO
// Dutch, so `/nl` is a Dutch front door onto books that are already written in
// Dutch. Draft copy, to be read by a native speaker before launch.
const nl: HomeStrings = {
  locale: 'nl-NL',

  heroTitle: 'Een nieuwe renaissance van oude wijsheid',
  heroSubtitleLine1: 'Welkom in ’s werelds grootste bibliotheek',
  heroSubtitleLine2: 'van met AI vertaalde oude bronnen.',
  emailPlaceholder: 'Je e-mailadres',
  join: 'Doe mee',
  sending: 'Bezig met versturen…',
  checkEmail: 'Kijk in je mail. We hebben een inloglink gestuurd naar',
  differentEmail: 'Een ander e-mailadres gebruiken',
  google: 'Of ga verder met Google',
  googleBlockedNote: 'Inloggen met Google werkt meestal niet in de browser binnen een app. Gebruik hierboven je e-mailadres, of open deze pagina in Safari/Chrome.',
  emailError: 'De inloglink kon niet worden verstuurd. Probeer het opnieuw.',
  didYouMean: (suggestion) => `Bedoelde je ${suggestion}?`,
  haveAccount: 'Heb je al een account?',
  explore: 'Verken de collectie',
  langEnglish: 'English',
  langSpanish: 'Español',
  suggestSpanish: 'Ver esta página en español',
  dismiss: 'Sluiten',
  librarianPlaceholder: 'Vraag de bronnen wat je wilt…',
  librarianHint: 'bijv. “Wat schreef Newton over profetieën?”',
  librarianAsk: 'Vraag',
  heroSignupLead: 'Nieuw hier? Meld je aan en bewaar wat je leest.',
  heroSignupCta: 'Meld je aan en bewaar wat je leest →',
  heroSearchInstead: 'Of doorzoek de collectie →',
  askSourceHeading: 'Vraag het de bronnen',
  askSourceSubtitle: 'Leg een vraag voor aan duizenden primaire bronnen en krijg een antwoord, met verwijzingen naar de originelen die je zelf kunt lezen.',

  collectionsHeading: 'Collecties',
  translationsLabel: 'leesbaar in het Engels',
  firstTimeLabel: 'voor het eerst',
  artworksLabel: 'kunstwerken',
  illustrationsLabel: 'illustraties',
  browseCatalog: 'Blader door de catalogus',
  booksLabel: 'boeken',
  // Short, as 'Latine' is: the subject index has room for "1.236 boeken · 14 Nederlands" and no more.
  inThisLanguage: 'Nederlands',
  seeMore: (n) => `Nog ${n} bekijken`,
  collectionsWord: 'collecties',
  curatedExhibitions: 'Bekijk de samengestelde tentoonstellingen',
  allCollections: 'Alle collecties',
  showcaseEyebrow: 'Samengestelde tentoonstellingen',
  showcaseSubtitle: 'Eén onderwerp per plank, elk enkele tientallen boeken, met een korte inleiding.',
  allExhibitions: (n) => `Alle ${n} tentoonstellingen`,
  featuredCollectionEyebrow: 'Uitgelichte collectie',
  exploreCollectionBooks: (n) => `Bekijk ${n} boeken`,
  bySubjectHeading: 'Bladeren per onderwerp',
  bySubjectLead: 'De hele bibliotheek:',

  recentlyTranslatedHeading: 'Onlangs vertaald',
  recentlyTranslatedSubtitle: 'De nieuwste werken die Source Library in een moderne, leesbare vertaling heeft gebracht.',
  mostLikedHeading: 'Favorieten van lezers',
  mostLikedSubtitle: 'De boeken die lezers het meest waarderen. Een favoriet gevonden? Tik op de ♥ op de pagina van het boek om je stem toe te voegen.',
  spanishHeading: 'Lees in het Spaans',
  nativeShelfHeading: 'Nederlandstalige boeken',
  nativeShelfSubtitle: 'Boeken die in het Nederlands zijn geschreven, hier te lezen in het origineel.',
  nativeShelfAll: 'Alle Nederlandstalige boeken',
  beginnerShelfHeading: 'Om mee te beginnen',
  beginnerShelfSubtitle: 'Toegankelijk ouder Nederlands: de schoolboeken, samenspraken, fabels en korte geschiedenissen waaruit generaties leerlingen leerden lezen.',
  untranslatedShelfHeading: 'Nog niet vertaald',
  untranslatedShelfSubtitle: (n) => `${n.toLocaleString('nl-NL')} Latijnse boeken die we nog niet in het Engels hebben vertaald, de meest gelezen eerst.`,
  spanishSubtitle: 'De werken in de bibliotheek die al een Spaanse editie hebben, pagina voor pagina naast het origineel.',
  galleryHeading: 'Galerij',
  gallerySubtitle: 'Platen, figuren en gravures uit zeldzame boeken in de hele bibliotheek.',
  galleryViewAll: (n) => `Alle ${n.toLocaleString('nl-NL')} illustraties bekijken`,
  discoverHeading: 'Ontdekken',
  discoverSubtitle: 'Vertaalde primaire bronnen uit de collectie.',
  discoverEmpty: 'Blader door de collectie om vertaalde primaire bronnen te ontdekken.',

  // The posts themselves are English, so the heading says so (i18n.md rule 4:
  // what is not in the page's language is labelled, never passed off).
  blogHeading: 'Artikelen (in het Engels)',
  blogSubtitle: 'Verhalen, leesrondleidingen en onderzoek uit de boeken van de bibliotheek, elk citaat gekoppeld aan de pagina waar het vandaan komt',
  blogAllPosts: 'Alle artikelen',
  tagDeepDive: 'Verdieping',
  tagCollection: 'Collectie',


  wallTitle: 'Het is tijd voor een nieuwe renaissance',
  wallBody: 'In de 15e eeuw hielpen vertalingen van Plato en andere antieken de renaissance op gang. Nu is minder dan 1 op de 100 historische teksten in het Engels te lezen. Onze missie: het geschreven erfgoed van de mensheid vertalen, met hulp van AI, voor iedereen.',
  wallCta: 'Ons verhaal',
  joinTitle: 'Steun de volgende eerste vertaling',
  joinBody: 'De vertalingen zijn gratis te lezen. Donaties betalen scannen, vertalen en de online bibliotheek.',
  joinDonate: 'Doneer',
  joinAccount: 'Gratis account maken',
  joinAccountBody: 'Bewaar boeken en houd je lezen bij.',
  joinVolunteer: 'Help mee',
  joinVolunteerBody: 'Help vertalen, controleren of verbeteren.',
  joinBuild: 'Bouw mee',
  joinBuildBody: 'Een API, CLI en MCP-server voor onderzoek en AI.',
  contribute: 'Bijdragen',
  developers: 'Ontwikkelaars',

  searchHeading: 'Doorzoek de collectie',
  searchPlaceholder: 'Probeer “Hermes Trismegistus” of “prima materia”...',
  browseBy: 'of blader op',
  byTitle: 'titel',
  byAuthor: 'auteur',
  byYear: 'jaar',
  byImages: 'afbeeldingen',


};

// Chinese (#6382). The mirror of the Latin case: nothing is translated INTO
// Chinese, but the library holds many books written in Chinese, so `/zh` is a
// Chinese front door onto books that are already Chinese. Draft copy — read by
// a native editor before launch; corrections go here. Count labels carry their
// measure word ("1,234 部书"), because HomeView joins number and label with a space.
const zh: HomeStrings = {
  locale: 'zh-CN',

  heroTitle: '对照原书，阅读古籍原文',
  heroSubtitleLine1: '一万多册中文古籍，原文可检索，每页附书影。',
  heroSubtitleLine2: '中文与欧洲典籍同在一库，可对照研读。',
  emailPlaceholder: '您的邮箱地址',
  join: '加入我们',
  sending: '正在发送…',
  checkEmail: '请查收邮件。我们已将登录链接发送至',
  differentEmail: '使用其他邮箱',
  google: '或使用 Google 继续',
  googleBlockedNote: '应用内置浏览器通常会拦截 Google 登录。请使用上方的邮箱登录，或在 Safari/Chrome 中打开此页面。',
  emailError: '登录链接发送失败，请重试。',
  didYouMean: (suggestion) => `您是不是要输入 ${suggestion}？`,
  haveAccount: '已有账户？',
  explore: '浏览馆藏',
  langEnglish: 'English',
  langSpanish: 'Español',
  suggestSpanish: 'Ver esta página en español',
  dismiss: '关闭',
  librarianPlaceholder: '向原典提问，什么都可以…',
  librarianHint: '例如：“牛顿关于预言写了什么？”',
  librarianAsk: '提问',
  heroSignupLead: '第一次来？注册即可保存阅读记录。',
  heroSignupCta: '注册以保存阅读记录 →',
  heroSearchInstead: '或搜索馆藏 →',
  askSourceHeading: '向原典提问',
  askSourceSubtitle: '向数千部原始文献提出问题，得到附有出处的回答，出处指向您可以亲自阅读的原书。',

  collectionsHeading: '专题',
  translationsLabel: '部可读英文',
  firstTimeLabel: '部首次译成英文',
  artworksLabel: '件艺术作品',
  illustrationsLabel: '幅插图',
  browseCatalog: '浏览目录',
  booksLabel: '部书',
  inThisLanguage: '部中文',
  seeMore: (n) => `查看其余 ${n} 个`,
  collectionsWord: '个专题',
  curatedExhibitions: '浏览策展',
  allCollections: '全部专题',
  showcaseEyebrow: '专题精选',
  showcaseSubtitle: '中西典籍，对照而读：每部书都附原书影像。',
  allExhibitions: (n) => `全部 ${n} 个策展`,
  featuredCollectionEyebrow: '精选专题',
  exploreCollectionBooks: (n) => `浏览 ${n} 本书`,
  bySubjectHeading: '按主题浏览',
  bySubjectLead: '全部馆藏：',

  recentlyTranslatedHeading: '最新译出的中文书',
  recentlyTranslatedSubtitle: '最近译成英文的中文古籍，原文与英译逐页对照。',
  mostLikedHeading: '读者最爱',
  mostLikedSubtitle: '读者点赞最多的书。遇到喜欢的书？在它的页面上点 ♥，投上您的一票。',
  spanishHeading: '西班牙文阅读',
  nativeShelfHeading: '中文书籍',
  nativeShelfSubtitle: '以中文写成的书，在这里阅读原文。',
  nativeShelfTotal: (n) => `馆藏中文书籍 ${n.toLocaleString('zh-CN')} 册，均可对照原书影像阅读原文。`,
  nativeShelfAll: '全部中文书籍',
  beginnerShelfHeading: '入门读物',
  beginnerShelfSubtitle: '较易读的中文：世世代代学童用来启蒙的蒙学读本、对话、寓言和简史。',
  untranslatedShelfHeading: '尚未翻译',
  untranslatedShelfSubtitle: (n) => `${n.toLocaleString('zh-CN')} 部拉丁文书籍，我们尚未译成英文，按阅读量排列。`,
  spanishSubtitle: '馆内已有西班牙文版的作品，与原文逐页对照。',
  galleryHeading: '图库',
  gallerySubtitle: '中文古籍中的木刻插图与图版。',
  galleryViewAll: (n) => `查看全部 ${n.toLocaleString('zh-CN')} 幅插图`,
  discoverHeading: '发现',
  discoverSubtitle: '馆藏中已翻译的原始文献。',
  discoverEmpty: '浏览馆藏，发现已翻译的原始文献。',

  // The posts themselves are English, so the heading says so (i18n.md rule 4:
  // what is not in the page's language is labelled, never passed off).
  blogHeading: '文章（英文）',
  blogSubtitle: '取材于馆藏图书的故事、阅读导览与研究，每段引文都链接到其所在的原页',
  blogAllPosts: '全部文章',
  tagDeepDive: '深度解读',
  tagCollection: '专题',


  wallTitle: '我们认为，又一次文艺复兴的时候到了',
  wallBody: '十五世纪，柏拉图等古代作家著作的翻译，助力点燃了文艺复兴。如今，能用英文阅读的历史文献不足百分之一。我们的使命是借助人工智能翻译人类的文字遗产，让每个人都能读到。',
  wallCta: '阅读我们的故事',
  joinTitle: '资助下一部首译作品',
  joinBody: '译本可免费阅读。捐款用于扫描、翻译和维持图书馆在线运行。',
  joinDonate: '捐赠',
  joinAccount: '免费注册账户',
  joinAccountBody: '收藏书籍、记录阅读进度。',
  joinVolunteer: '成为志愿者',
  joinVolunteerBody: '帮助翻译、审校或改进馆藏。',
  joinBuild: '在此基础上开发',
  joinBuildBody: '面向研究工具和人工智能的 API、CLI 和 MCP 服务器。',
  contribute: '贡献',
  developers: '开发者',

  searchHeading: '搜索馆藏',
  searchPlaceholder: '试试“Hermes Trismegistus”或“prima materia”……',
  browseBy: '或按以下方式浏览：',
  byTitle: '书名',
  byAuthor: '作者',
  byYear: '年代',
  byImages: '图像',


};

export const HOME_STRINGS: Record<HomeLang, HomeStrings> = { en, es, la, nl, zh };

// Spanish display names for the known top-level collections. Unknown slugs fall
// back to the stored English name.
export const ES_COLLECTION_NAMES: Record<string, string> = {
  'natural-philosophy': 'Filosofía natural y ciencia',
  theology: 'Teología y pensamiento religioso',
  'classical-philosophy': 'Filosofía clásica',
  alchemy: 'Alquimia',
  'indic-traditions': 'Tradiciones índicas',
  'chinese-classics': 'Clásicos chinos',
  magic: 'Magia y artes ocultas',
  medicine: 'Medicina e historia natural',
  'art-illustrated': 'Arte y libros ilustrados',
  'secret-societies': 'Sociedades secretas',
  'leonardo-da-vinci': 'Leonardo da Vinci',
  hermetica: 'Hermética',
  kabbalah: 'Cábala',
  astrology: 'Astrología y adivinación',
  mysticism: 'Misticismo',
  'sacred-texts': 'Textos sagrados',
  'renaissance-philosophy': 'Filosofía renacentista',
  demonology: 'Demonología y brujería',
  literature: 'Literatura y poesía',
  herbalism: 'Herbolaria y botánica',
  'music-sound': 'Música y sonido',
  'en-espanol': 'Libros en español',
};

// Latin display names, hand-written (#6278). Two groups: the top-level
// collections of the subject index, then the curated exhibitions the showcase
// draws from. Where a traditional Latin name exists it is used (Theatra
// machinarum, Antiquitates Septentrionales, Philosophia perennis). On `/la` the
// showcase draws only from exhibitions named here, so adding a curated
// exhibition without a Latin name keeps it off the Latin homepage instead of
// showing it in English.
export const LA_COLLECTION_NAMES: Record<string, string> = {
  // Older top-level slugs the homepage's fallback list still uses when the
  // collections query times out (FALLBACK_COLLECTIONS in home-data.ts).
  'indic-traditions': 'Traditiones Indicae',
  'chinese-classics': 'Libri classici Sinenses',
  'leonardo-da-vinci': 'Leonardus Vincius',
  'kabbalah': 'Cabbala',
  'herbalism': 'Herbaria et res botanica',
  'music-sound': 'Musica et sonus',
  'natural-philosophy': 'Philosophia naturalis et scientiae',
  theology: 'Theologia Christiana',
  literature: 'Litterae et poesis',
  'classical-philosophy': 'Philosophia antiqua',
  astrology: 'Astrologia et divinatio',
  'sacred-texts': 'Libri sacri',
  medicine: 'Medicina et historia naturalis',
  alchemy: 'Alchemia',
  mysticism: 'Theologia mystica',
  hermetica: 'Hermetica',
  'renaissance-philosophy': 'Philosophia Renascentiae',
  'east-asia': 'Asia orientalis',
  magic: 'Magia et artes occultae',
  'art-illustrated': 'Ars et libri imaginibus ornati',
  'south-asia': 'Asia meridiana',
  'secret-societies': 'Sodalitates arcanae',
  'history-political-thought': 'Historia et doctrina civilis',
  psychology: 'Psychologia',
  demonology: 'Daemonologia et maleficia',
  'cannabis-western-record': 'Cannabis: plantae historia',
  'american-founding': 'Origines rei publicae Americanae',
  'signs-in-the-sky': 'Signa in caelo',
  'gardens-festivals-ephemeral': 'Horti, festa, artes caducae',
  'druids-megaliths': 'Druidae et monumenta megalithica',
  'sacred-plants': 'Herbae sacrae et ebrietas ritualis',
  'norse-antiquities': 'Antiquitates Septentrionales',
  'the-human-condition': 'Condicio humana',
  'book-of-the-dead': 'Liber mortuorum',
  sibyls: 'Sibyllae',
  nalanda: 'Nālandā: fontes Sanscritici canonis Tibetani',
  'alchemists-studio': 'Officina alchemistae',
  'venetian-mystery': 'Mysterium Venetum',
  'art-of-altdorfer-baldung': 'Maleficae et res mirae',
  'leonardo-drawings': 'Leonardi Vincii codices',

  // Curated exhibitions (the showcase pool).
  manichaeism: 'Manichaeorum religio',
  'ancient-egyptian': 'Aegyptus antiqua',
  'indigenous-traditions': 'Traditiones gentium indigenarum',
  'music-of-the-spheres': 'Musica sphaerarum',
  'sympathy-of-all-things': 'Sympathia rerum',
  'perennial-philosophy': 'Philosophia perennis',
  'art-of-memory': 'Ars memoriae',
  'forbidden-books': 'Libri prohibiti',
  'star-science': 'Scientia astrorum',
  'making-things-visible': 'Invisibilia detecta',
  'invention-of-method': 'Methodus inventa',
  'letters-from-the-desert': 'Scripta e deserto',
  'kepler-fludd-debate': 'Kepleri et Fluddi controversia',
  'newtons-other-science': 'Altera Newtoni scientia',
  'courts-of-wonder': 'Aulae mirabilium',
  'agrippas-world': 'Orbis Agrippae',
  'behmenist-underground': 'Boehmii sectatores',
  'robert-hooke-polymath': 'Robertus Hooke polyhistor',
  encyclopedists: 'Encyclopaedici',
  'women-of-the-secret-tradition': 'Feminae traditionis arcanae',
  'theatres-of-machines': 'Theatra machinarum',
  'bestiary-tradition': 'Bestiaria',
  'alchemical-emblem': 'Emblemata alchemica',
  'maps-of-the-invisible': 'Tabulae rerum invisibilium',
  'byzantine-bridge': 'Pons Byzantinus',
  'rhineland-mystics': 'Mystici Rhenani',
  'syriac-church': 'Ecclesia Syriaca',
  'armenian-golden-age': 'Aetas aurea Armeniorum',
  'islamic-philosophy-meets-christian-mysticism': 'Philosophia Islamica et theologia mystica Christiana',
  'sacred-objects': 'Res sacrae',
  'indigenous-sacred-narratives': 'Narrationes sacrae gentium indigenarum',
  apocrypha: 'Apocrypha',
  'sacred-books-of-the-east': 'Libri sacri Orientis',
  'dutch-golden-age-of-science': 'Aetas aurea scientiae Batavae',
  'anatomical-revolution': 'Anatomia renovata',
  'mining-metals-and-fire': 'Metalla, fodinae, ignis',
  'canon-of-avicenna': 'Canon Avicennae',
  'nova-reperta': 'Nova Reperta',
  'herculaneum-papyri': 'Papyri Herculanenses',
  'rosicrucian-moment': 'Fraternitas Rosae Crucis',
  'global-demonology': 'Daemonologia omnium gentium',
  'printing-press-revolution': 'Ars typographica',
  ayurveda: 'Ayurveda: scientia vitae',
  'grimoire-tradition': 'Libri magici',
  'ancient-engineering': 'Ars machinalis antiquorum',
  'renaissance-literary-imagination': 'Litterae Renascentiae',
  'ancient-papyri': 'Papyri antiquae',
  'great-manuscripts': 'Codices insignes',
  'theosophical-society': 'Societates theosophicae et occultae',
  'blavatsky-mahatmas': 'Blavatsky et Mahatmae',
  'index-librorum-prohibitorum': 'Index Librorum Prohibitorum',
  'hogwarts-library': 'Bibliotheca Hogvartensis',
  yoga: 'Yoga',
  'javanese-kraton': 'Aula Iavanica',
  'indonesian-manuscripts': 'Codices Indonesici',
  'baltic-paganism': 'Religio pagana Baltica',
  seafaring: 'Navigatio et ars navium aedificandarum',
};

// Dutch display names (#6382), translated from each collection's English name.
// Same two groups and the same rule as LA_COLLECTION_NAMES: on `/nl` the
// showcase draws only from exhibitions named here.
export const NL_COLLECTION_NAMES: Record<string, string> = {
  // Older top-level slugs the homepage's fallback list still uses when the
  // collections query times out (FALLBACK_COLLECTIONS in home-data.ts).
  'indic-traditions': 'Indiase tradities',
  'chinese-classics': 'Chinese klassieken',
  'leonardo-da-vinci': 'Leonardo da Vinci',
  'kabbalah': 'Kabbala',
  'herbalism': 'Kruidkunde en plantkunde',
  'music-sound': 'Muziek en klank',
  'natural-philosophy': 'Natuurfilosofie en wetenschap',
  theology: 'Christelijke theologie',
  literature: 'Literatuur en poëzie',
  'classical-philosophy': 'Klassieke filosofie',
  astrology: 'Astrologie en waarzeggerij',
  'sacred-texts': 'Heilige teksten',
  medicine: 'Geneeskunde en natuurlijke historie',
  alchemy: 'Alchemie',
  mysticism: 'Mystiek',
  hermetica: 'Hermetica',
  'renaissance-philosophy': 'Renaissancefilosofie',
  'east-asia': 'Oost-Azië',
  magic: 'Magie en occulte kunsten',
  'art-illustrated': 'Kunst en geïllustreerde boeken',
  'south-asia': 'Zuid-Azië',
  'secret-societies': 'Geheime genootschappen',
  'history-political-thought': 'Geschiedenis en politiek denken',
  psychology: 'Psychologie',
  demonology: 'Demonologie en hekserij',
  'cannabis-western-record': 'Een verslag van de plant',
  'american-founding': 'De stichting van Amerika',
  'signs-in-the-sky': 'Tekenen aan de hemel',
  'gardens-festivals-ephemeral': 'Tuinen, feesten en vergankelijke kunsten',
  'druids-megaliths': 'Druïden en megalieten',
  'sacred-plants': 'Heilige planten en rituele roes',
  'norse-antiquities': 'Noordse en Scandinavische oudheden',
  'the-human-condition': 'De menselijke conditie',
  'book-of-the-dead': 'Het dodenboek',
  sibyls: 'De sibyllen',
  nalanda: 'Nālandā: Sanskrietbronnen van de Tibetaanse canon',
  'alchemists-studio': 'De werkplaats van de alchemist',
  'venetian-mystery': 'Het Venetiaanse mysterie',
  'art-of-altdorfer-baldung': 'Hekserij en het onheilspellende',
  'leonardo-drawings': 'De notitieboeken van Leonardo',

  // Curated exhibitions (the showcase pool).
  manichaeism: 'Manicheïsme',
  'ancient-egyptian': 'Het oude Egypte',
  'indigenous-traditions': 'Inheemse tradities',
  'music-of-the-spheres': 'De muziek der sferen',
  'sympathy-of-all-things': 'De sympathie van alle dingen',
  'perennial-philosophy': 'De eeuwige filosofie',
  'art-of-memory': 'De geheugenkunst',
  'forbidden-books': 'Verboden boeken',
  'star-science': 'Sterrenkunde',
  'making-things-visible': 'Het onzichtbare zichtbaar maken',
  'invention-of-method': 'De uitvinding van de methode',
  'letters-from-the-desert': 'Brieven uit de woestijn',
  'kepler-fludd-debate': 'Het debat tussen Kepler en Fludd',
  'newtons-other-science': 'Newtons andere wetenschap',
  'courts-of-wonder': 'Hoven vol wonderen',
  'agrippas-world': 'De wereld van Agrippa',
  'behmenist-underground': 'De ondergrondse volgelingen van Böhme',
  'robert-hooke-polymath': 'Robert Hooke, homo universalis',
  encyclopedists: 'De encyclopedisten',
  'women-of-the-secret-tradition': 'Vrouwen van de geheime traditie',
  'theatres-of-machines': 'Machinetheaters',
  'bestiary-tradition': 'De bestiariumtraditie',
  'alchemical-emblem': 'Het alchemistische embleem',
  'maps-of-the-invisible': 'Kaarten van het onzichtbare',
  'byzantine-bridge': 'De Byzantijnse brug',
  'rhineland-mystics': 'De Rijnlandse mystici',
  'syriac-church': 'De Syrische kerk',
  'armenian-golden-age': 'De Armeense gouden eeuw',
  'islamic-philosophy-meets-christian-mysticism': 'Islamitische filosofie en christelijke mystiek',
  'sacred-objects': 'Heilige voorwerpen',
  'indigenous-sacred-narratives': 'Heilige verhalen van inheemse volken',
  apocrypha: 'Apocriefen',
  'sacred-books-of-the-east': 'Heilige boeken van het Oosten',
  'dutch-golden-age-of-science': 'De Gouden Eeuw van de Nederlandse wetenschap',
  'anatomical-revolution': 'De anatomische revolutie',
  'mining-metals-and-fire': 'Mijnbouw, metalen en vuur',
  'canon-of-avicenna': 'De Canon van Avicenna',
  'nova-reperta': 'Nova Reperta',
  'herculaneum-papyri': 'De papyri van Herculaneum',
  'rosicrucian-moment': 'Het moment van de rozenkruisers',
  'global-demonology': 'Demonologie wereldwijd',
  'printing-press-revolution': 'De revolutie van de drukpers',
  ayurveda: 'Ayurveda',
  'grimoire-tradition': 'De traditie van de grimoires',
  'ancient-engineering': 'Techniek in de oudheid',
  'renaissance-literary-imagination': 'De literaire verbeelding van de renaissance',
  'ancient-papyri': 'Oude papyri',
  'great-manuscripts': 'Grote handschriften',
  'theosophical-society': 'De Theosofische Vereniging',
  'blavatsky-mahatmas': 'Blavatsky en de mahatma’s',
  'index-librorum-prohibitorum': 'Index Librorum Prohibitorum',
  'hogwarts-library': 'De bibliotheek van Zweinstein',
  yoga: 'Yoga',
  'javanese-kraton': 'De Javaanse kraton',
  'indonesian-manuscripts': 'Indonesische handschriften',
  'baltic-paganism': 'Baltisch heidendom',
  seafaring: 'Zeevaart',
};

// Chinese display names, hand-written (#6382), translated from each
// collection's English name. Same two groups and the same rule as
// LA_COLLECTION_NAMES: on `/zh` the showcase draws only from exhibitions named
// here, so an exhibition without a Chinese name stays off the Chinese homepage.
export const ZH_COLLECTION_NAMES: Record<string, string> = {
  // Older top-level slugs the homepage's fallback list still uses when the
  // collections query times out (FALLBACK_COLLECTIONS in home-data.ts).
  'indic-traditions': '印度传统',
  'chinese-classics': '中国经典',
  // The /zh showcase (NATIVE_SHOWCASE_SLUGS).
  'harmony-east-west': '律吕与和谐',
  'china-through-european-eyes': '中学西传',
  'chinese-natural-knowledge': '中国自然知识',
  'chinese-divination-cosmology': '术数与宇宙论',
  'confucian-classics': '儒家经典',
  'chinese-astrology': '天文与星占',
  'leonardo-da-vinci': '达·芬奇',
  'kabbalah': '卡巴拉',
  'herbalism': '本草与植物学',
  'music-sound': '音乐与声音',
  'natural-philosophy': '自然哲学与科学',
  theology: '基督教神学',
  literature: '文学与诗歌',
  'classical-philosophy': '古典哲学',
  astrology: '占星与占卜',
  'sacred-texts': '圣典',
  medicine: '医学与博物学',
  alchemy: '炼金术',
  mysticism: '神秘主义',
  hermetica: '赫尔墨斯文献',
  'renaissance-philosophy': '文艺复兴哲学',
  'east-asia': '东亚',
  magic: '魔法与秘术',
  'art-illustrated': '艺术与插图本',
  'south-asia': '南亚',
  'secret-societies': '秘密社团',
  'history-political-thought': '历史与政治思想',
  psychology: '心理学',
  demonology: '恶魔学与巫术',
  'cannabis-western-record': '大麻：西方文献中的一种植物',
  'american-founding': '美国的建国',
  'signs-in-the-sky': '天象异兆',
  'gardens-festivals-ephemeral': '园林、节庆与短暂的艺术',
  'druids-megaliths': '德鲁伊与巨石遗迹',
  'sacred-plants': '神圣植物与仪式致幻',
  'norse-antiquities': '北欧与斯堪的纳维亚古物',
  'the-human-condition': '人的境况',
  'book-of-the-dead': '《亡灵书》',
  sibyls: '西比尔女先知',
  nalanda: '那烂陀：藏传经典的梵文源头',
  'alchemists-studio': '炼金术士的工作室',
  'venetian-mystery': '威尼斯之谜',
  'art-of-altdorfer-baldung': '巫术与怪异',
  'leonardo-drawings': '达·芬奇笔记',

  // Curated exhibitions (the showcase pool).
  manichaeism: '摩尼教',
  'ancient-egyptian': '古埃及',
  'indigenous-traditions': '原住民传统',
  'music-of-the-spheres': '天球音乐',
  'sympathy-of-all-things': '万物感应',
  'perennial-philosophy': '长青哲学',
  'art-of-memory': '记忆术',
  'forbidden-books': '禁书',
  'star-science': '星辰之学',
  'making-things-visible': '让不可见者可见',
  'invention-of-method': '方法的发明',
  'letters-from-the-desert': '来自沙漠的书信',
  'kepler-fludd-debate': '开普勒与弗拉德之争',
  'newtons-other-science': '牛顿的另一门科学',
  'courts-of-wonder': '奇观宫廷',
  'agrippas-world': '阿格里帕的世界',
  'behmenist-underground': '波墨派地下运动',
  'robert-hooke-polymath': '博学家罗伯特·胡克',
  encyclopedists: '百科全书派',
  'women-of-the-secret-tradition': '秘传传统中的女性',
  'theatres-of-machines': '机械图谱',
  'bestiary-tradition': '动物寓言集传统',
  'alchemical-emblem': '炼金术寓意画',
  'maps-of-the-invisible': '不可见之物的地图',
  'byzantine-bridge': '拜占庭之桥',
  'rhineland-mystics': '莱茵兰神秘主义者',
  'syriac-church': '叙利亚教会',
  'armenian-golden-age': '亚美尼亚黄金时代',
  'islamic-philosophy-meets-christian-mysticism': '伊斯兰哲学与基督教神秘主义的相遇',
  'sacred-objects': '圣物',
  'indigenous-sacred-narratives': '原住民神圣叙事',
  apocrypha: '次经与伪经',
  'sacred-books-of-the-east': '东方圣书',
  'dutch-golden-age-of-science': '荷兰科学黄金时代',
  'anatomical-revolution': '解剖学革命',
  'mining-metals-and-fire': '矿冶、金属与火',
  'canon-of-avicenna': '伊本·西那《医典》',
  'nova-reperta': '新发现（Nova Reperta）',
  'herculaneum-papyri': '赫库兰尼姆纸草',
  'rosicrucian-moment': '玫瑰十字会时刻',
  'global-demonology': '世界恶魔学',
  'printing-press-revolution': '印刷术革命',
  ayurveda: '阿育吠陀',
  'grimoire-tradition': '魔法书传统',
  'ancient-engineering': '古代工程',
  'renaissance-literary-imagination': '文艺复兴的文学想象',
  'ancient-papyri': '古代纸草文献',
  'great-manuscripts': '伟大的手稿',
  'theosophical-society': '神智学会',
  'blavatsky-mahatmas': '布拉瓦茨基与大师',
  'index-librorum-prohibitorum': '《禁书目录》',
  'hogwarts-library': '霍格沃茨图书馆',
  yoga: '瑜伽',
  'javanese-kraton': '爪哇王宫',
  'indonesian-manuscripts': '印度尼西亚手稿',
  'baltic-paganism': '波罗的海异教',
  seafaring: '航海',
};

/**
 * The exact stored `books.language` spelling the shelf selects, per
 * original-text locale. Each is the spelling nearly every live book in that
 * language carries (Latin 15,771 of 15,776, measured 2026-10-07; Dutch 568,
 * Chinese 12,786, measured 2026-10-09) and a subset of that locale's
 * `NATIVE_EDITION_LANGUAGE`, so every card has a working localized book page.
 */
export const NATIVE_SHELF_LANGUAGE: Partial<Record<HomeLang, string>> = {
  la: 'Latin',
  nl: 'Dutch',
  zh: 'Chinese',
};

/**
 * Books that open the native shelf ahead of the read-count order, because
 * read count alone put a book with a known misread first on /zh (#8035). Add
 * only a book whose pages someone has opened against the scans. These three
 * were opened by eye on 2026-10-27 (#7537): 天工開物 (woodblock with plates),
 * 三才圖會 卷二十八, and P.3847 《景教三威蒙度赞》.
 */
export const NATIVE_SHELF_LEAD_IDS: Partial<Record<HomeLang, string[]>> = {
  zh: ['69af0e7f067c0c26ee26e3ad', '6992cd7243713c66ea636785', '6992ca18d4d545ae73fed7ce'],
};

/**
 * Subject shelves for an original-text homepage whose sections are filled with
 * books in its own language (`NATIVE_FIRST_LANGS` in home-data.ts). Each shelf
 * is one collection, filtered to books written in the page's language; a shelf
 * with too few readable books is dropped rather than padded with others.
 */
export interface NativeSubjectShelves {
  heading: string;
  allLabel: string;
  shelves: { slug: string; heading: string }[];
}
export const NATIVE_SUBJECT_SHELVES: Partial<Record<HomeLang, NativeSubjectShelves>> = {
  zh: {
    heading: '分类书架',
    allLabel: '查看全部',
    shelves: [
      { slug: 'daoist-classics', heading: '道家经典' },
      { slug: 'chinese-buddhist-texts', heading: '佛教典籍' },
      { slug: 'chinese-medicine-natural-philosophy', heading: '医学与自然知识' },
      { slug: 'chinese-history-statecraft', heading: '史地与治术' },
    ],
  },
};

/**
 * The collections the showcase shows on a native-first homepage, in place of the
 * random draw of curated exhibitions. Only six curated exhibitions hold any Chinese
 * book (ten at most), so the draw put Hogwarts and Indonesian manuscripts on /zh
 * (#7537). Decided 2026-10-27 (Derek): four cards, each proving one message, "we
 * read the traditions side by side": harmony in Chinese and European theory, how
 * Europe read China, Chinese natural knowledge, and the Hogwarts library as the
 * friendly door into the Western books. In this order; the first is the lead card.
 * A collection not yet published simply drops out. Each needs a name in
 * COLLECTION_NAMES for the language.
 */
export const NATIVE_SHOWCASE_SLUGS: Partial<Record<HomeLang, string[]>> = {
  zh: ['harmony-east-west', 'china-through-european-eyes', 'chinese-natural-knowledge', 'hogwarts-library'],
};

/** Hand-written collection names per locale. English is the stored name. */
export const COLLECTION_NAMES: Partial<Record<HomeLang, Record<string, string>>> = {
  es: ES_COLLECTION_NAMES,
  la: LA_COLLECTION_NAMES,
  nl: NL_COLLECTION_NAMES,
  zh: ZH_COLLECTION_NAMES,
};

export function collectionName(lang: HomeLang, slug: string, fallback: string): string {
  return COLLECTION_NAMES[lang]?.[slug] ?? fallback;
}
