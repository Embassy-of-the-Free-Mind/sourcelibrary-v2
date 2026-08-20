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
  askSourceEyebrow: string;
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
  seeMore: (n: number) => string;
  collectionsWord: string;
  curatedExhibitions: string;
  allCollections: string;

  // Recently translated slider
  recentlyTranslatedHeading: string;
  recentlyTranslatedSubtitle: string;

  // "Read in Spanish" slider — rendered on /es only (HomeData.spanishBooks is
  // empty on the English homepage), but the strings live in both dictionaries
  // so the two editions keep one shape.
  spanishHeading: string;
  spanishSubtitle: string;
  spanishViewAll: string;

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
  aboutHeading: string;
  aboutP1: string;
  aboutP2: string;
  aboutP3Before: string;
  efmLinkText: string;
  aboutP3After: string;

  // Be part of this
  bePartEyebrow: string;
  bePartHeading: string;
  supportTitle: string;
  supportBody: string;
  howToSupport: string;
  createAccount: string;
  contribute: string;
  contributeDesc: string;
  developers: string;
  developersDesc: string;

  // Search section
  searchHeading: string;
  searchStats: (books: string, authors: string, langs: number) => string;
  searchPlaceholder: string;
  browseBy: string;
  byTitle: string;
  byAuthor: string;
  byYear: string;
  byImages: string;

  // Featured podcast episode (rendered on both homepages)
  podcastEyebrow: string;
  podcastListen: string;
  podcastSourcesLabel: string;
  podcastFullEpisode: string;

  // Footer essay
  inSpiritOf: string;
  ficinoRole: string;
  ficinoBio: string;
  cosimoRole: string;
  cosimoBio: string;
  closingStrong: string;
  closingRest: string;
}

const en: HomeStrings = {
  locale: 'en-US',

  heroTitle: 'A New Renaissance of Ancient Wisdom',
  heroSubtitleLine1: 'Welcome to the world’s largest library',
  heroSubtitleLine2: 'of AI-translated ancient sources.',
  emailPlaceholder: 'Your email address',
  join: 'Join us',
  sending: 'Sending…',
  checkEmail: 'Check your email — we sent a sign-in link to',
  differentEmail: 'Use a different email',
  google: 'Or continue with Google',
  googleBlockedNote: 'Google sign-in is usually blocked in in-app browsers — use email above, or open this page in Safari/Chrome.',
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
  askSourceEyebrow: 'The Librarian',
  askSourceHeading: 'Ask the source',
  askSourceSubtitle: 'Put a question to thousands of primary sources and get an answer — with citations to the originals you can read for yourself.',

  collectionsHeading: 'Collections',
  translationsLabel: 'translations',
  firstTimeLabel: 'for the first time',
  artworksLabel: 'artworks',
  illustrationsLabel: 'illustrations',
  browseCatalog: 'Browse Catalog',
  booksLabel: 'books',
  seeMore: (n) => `See ${n} more`,
  collectionsWord: 'collections',
  curatedExhibitions: 'Browse curated exhibitions',
  allCollections: 'All collections',

  recentlyTranslatedHeading: 'Recently translated',
  recentlyTranslatedSubtitle: 'The latest works Source Library has brought into a modern, readable translation.',
  spanishHeading: 'Read in Spanish',
  spanishSubtitle: 'The most-read works in the library, with a Spanish edition you can open page by page beside the original.',
  spanishViewAll: 'All books in Spanish',
  galleryHeading: 'Gallery',
  gallerySubtitle: 'Plates, figures, and engravings from rare books across the library.',
  galleryViewAll: (n) => `View all ${n.toLocaleString('en-US')} illustrations`,
  discoverHeading: 'Discover',
  discoverSubtitle: 'Translated primary sources from the collection.',
  discoverEmpty: 'Browse the collection to discover translated primary sources.',

  blogHeading: 'Research Notes',
  blogSubtitle: 'AI-assisted research on the collection and its history',
  blogAllPosts: 'All posts',
  tagDeepDive: 'Deep dive',
  tagCollection: 'Collection',

  aboutHeading:
    'The rediscovery of ancient wisdom helped spark the Renaissance. It’s time for another.',
  aboutP1:
    'Centuries of humanity’s deepest thinking sit locked in Latin and other inaccessible languages. These aren’t just inaccessible to humans; contemporary AI systems were trained on Reddit but not the Renaissance. Millions of books and manuscripts are unscanned and untranslated. These aren’t obscure footnotes. They are the roots of modern science, psychology, philosophy of mind, and the perennial questions about what it means to be human.',
  aboutP2:
    'The Source Library uses scholarship and AI systems to recover this knowledge and make it accessible to all. We are building the world’s largest open-access collection of translated primary sources—so that scholars, seekers, and AI systems can draw on the full depth of the human intellectual tradition. This work is sustained by the people who use and value it.',
  aboutP3Before: 'The Source Library is an initiative of the ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' in Amsterdam, home to the Bibliotheca Philosophica Hermetica: one of the world’s most important collections of Hermetic, alchemical, and esoteric books.',

  bePartEyebrow: 'Be part of this',
  bePartHeading: 'Help recover the lost intellectual heritage of humanity.',
  supportTitle: 'Support the Library',
  supportBody:
    'Thousands of texts from the ancient and early modern world remain untranslated and unread. Your support funds the digitization, OCR, and AI-assisted translation of these works—making them freely available to scholars, seekers, and the public for the first time.',
  howToSupport: 'How to Support?',
  createAccount: 'Create a Free Account',
  contribute: 'Contribute',
  contributeDesc: 'Help translate, review, or improve the collection',
  developers: 'Developers',
  developersDesc: 'MCP server, CLI, and API for research tools',

  searchHeading: 'Search the collection',
  searchStats: (books, authors, langs) => `${books} books · ${authors}+ authors · ${langs}+ languages`,
  searchPlaceholder: 'Try “Hermes Trismegistus” or “prima materia”...',
  browseBy: 'or browse by',
  byTitle: 'title',
  byAuthor: 'author',
  byYear: 'year',
  byImages: 'images',

  podcastEyebrow: 'Deep dive podcast',
  podcastListen: 'Listen to the episode',
  // Not "the four books" — the source count varies per episode, and the label
  // is rendered from whatever `sources` the thread actually carries.
  podcastSourcesLabel: 'The books in this episode',
  podcastFullEpisode: 'Full episode & transcript',

  inSpiritOf: 'In the spirit of',
  ficinoRole: '1433–1499 · Philosopher & Translator',
  ficinoBio:
    'Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin—making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the prisca theologia: the belief in an ancient wisdom tradition uniting all seekers of truth.',
  cosimoRole: '1389–1464 · Florence',
  cosimoBio:
    'The inventor of modern banking, Cosimo de’ Medici used his wealth to fund the Renaissance. In addition to commissioning art, he funded Ficino to make translations of Plato and other lost works into Latin so that they could be read. Around 1460, a Greek manuscript of the Corpus Hermeticum arrived in Florence, brought from Macedonia by a monk named Leonardo of Pistoia. The dying Cosimo asked Ficino to pause his translation of Plato so that he could read it—sensing that Hermes held the key to the most ancient wisdom.',
  closingStrong: 'The Source Library continues in the spirit of their work.',
  closingRest:
    ' Translating ancient wisdom and sharing it freely has the power to transform civilization. Centuries after Ficino, thousands of texts remain untranslated and unread—including many of Ficino’s own works. We are recovering them—for scholars, for seekers, and for the AI systems that will shape how future generations think.',
};

const es: HomeStrings = {
  locale: 'es-ES',

  heroTitle: 'Un nuevo Renacimiento de la sabiduría antigua',
  heroSubtitleLine1: 'Bienvenido a la mayor biblioteca del mundo',
  heroSubtitleLine2: 'de fuentes antiguas traducidas con IA.',
  emailPlaceholder: 'Tu correo electrónico',
  join: 'Únete',
  sending: 'Enviando…',
  checkEmail: 'Revisa tu correo — enviamos un enlace de acceso a',
  differentEmail: 'Usar otro correo',
  google: 'O continúa con Google',
  googleBlockedNote: 'El acceso con Google suele estar bloqueado en navegadores internos — usa el correo de arriba, o abre esta página en Safari/Chrome.',
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
  askSourceEyebrow: 'El Bibliotecario',
  askSourceHeading: 'Pregúntale a la fuente',
  askSourceSubtitle: 'Haz una pregunta a miles de fuentes primarias y recibe una respuesta, con citas a los originales que puedes leer por ti mismo.',

  collectionsHeading: 'Colecciones',
  translationsLabel: 'traducciones',
  firstTimeLabel: 'por primera vez',
  artworksLabel: 'obras de arte',
  illustrationsLabel: 'ilustraciones',
  browseCatalog: 'Explorar el catálogo',
  booksLabel: 'libros',
  seeMore: (n) => `Ver ${n} más`,
  collectionsWord: 'colecciones',
  curatedExhibitions: 'Explorar exposiciones comisariadas',
  allCollections: 'Todas las colecciones',

  recentlyTranslatedHeading: 'Traducidas recientemente',
  recentlyTranslatedSubtitle: 'Las obras más recientes que Source Library ha traducido a una versión moderna y legible.',
  spanishHeading: 'Leer en español',
  spanishSubtitle: 'Las obras más leídas de la biblioteca, con una edición en español que puedes abrir página a página junto al original.',
  spanishViewAll: 'Todos los libros en español',
  galleryHeading: 'Galería',
  gallerySubtitle: 'Láminas, figuras y grabados de libros raros de toda la biblioteca.',
  galleryViewAll: (n) => `Ver las ${n.toLocaleString('es-ES')} ilustraciones`,
  discoverHeading: 'Descubre',
  discoverSubtitle: 'Fuentes primarias traducidas de la colección.',
  discoverEmpty: 'Explora la colección para descubrir fuentes primarias traducidas.',

  blogHeading: 'Notas de investigación',
  blogSubtitle: 'Investigación asistida por IA sobre la colección y su historia',
  blogAllPosts: 'Todas las entradas',
  tagDeepDive: 'Análisis',
  tagCollection: 'Colección',

  aboutHeading:
    'El redescubrimiento de la sabiduría antigua ayudó a encender el Renacimiento. Es hora de otro.',
  aboutP1:
    'Siglos del pensamiento más profundo de la humanidad permanecen encerrados en latín y otras lenguas inaccesibles. No solo son inaccesibles para las personas: los sistemas de IA actuales se entrenaron con Reddit, pero no con el Renacimiento. Millones de libros y manuscritos siguen sin digitalizar ni traducir. No son notas al pie oscuras. Son las raíces de la ciencia moderna, la psicología, la filosofía de la mente y las preguntas perennes sobre qué significa ser humano.',
  aboutP2:
    'Source Library combina la erudición y los sistemas de IA para recuperar este conocimiento y hacerlo accesible a todos. Estamos construyendo la mayor colección de acceso abierto de fuentes primarias traducidas del mundo, para que estudiosos, buscadores y sistemas de IA puedan recurrir a toda la profundidad de la tradición intelectual humana. Este trabajo se sostiene gracias a quienes lo usan y lo valoran.',
  aboutP3Before: 'Source Library es una iniciativa de la ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' en Ámsterdam, sede de la Bibliotheca Philosophica Hermetica: una de las colecciones más importantes del mundo de libros herméticos, alquímicos y esotéricos.',

  bePartEyebrow: 'Sé parte de esto',
  bePartHeading: 'Ayuda a recuperar el patrimonio intelectual perdido de la humanidad.',
  supportTitle: 'Apoya la biblioteca',
  supportBody:
    'Miles de textos del mundo antiguo y de la primera Edad Moderna siguen sin traducir y sin leer. Tu apoyo financia la digitalización, el OCR y la traducción asistida por IA de estas obras, poniéndolas gratuitamente al alcance de estudiosos, buscadores y el público por primera vez.',
  howToSupport: '¿Cómo apoyar?',
  createAccount: 'Crea una cuenta gratis',
  contribute: 'Contribuye',
  contributeDesc: 'Ayuda a traducir, revisar o mejorar la colección',
  developers: 'Desarrolladores',
  developersDesc: 'Servidor MCP, CLI y API para herramientas de investigación',

  searchHeading: 'Busca en la colección',
  searchStats: (books, authors, langs) => `${books} libros · ${authors}+ autores · ${langs}+ idiomas`,
  searchPlaceholder: 'Prueba «Hermes Trismegisto» o «prima materia»...',
  browseBy: 'o explora por',
  byTitle: 'título',
  byAuthor: 'autor',
  byYear: 'año',
  byImages: 'imágenes',

  podcastEyebrow: 'Pódcast en español',
  podcastListen: 'Escuchar el episodio',
  podcastSourcesLabel: 'Los libros de este episodio',
  podcastFullEpisode: 'Episodio completo y transcripción',

  inSpiritOf: 'En el espíritu de',
  ficinoRole: '1433–1499 · Filósofo y traductor',
  ficinoBio:
    'Ficino tradujo al latín las obras completas de Platón, Plotino, Proclo, Jámblico y los escritos herméticos, haciéndolas accesibles a toda Europa por primera vez. Su labor encendió la recuperación renacentista del neoplatonismo, el hermetismo y la prisca theologia: la creencia en una antigua tradición de sabiduría que une a todos los buscadores de la verdad.',
  cosimoRole: '1389–1464 · Florencia',
  cosimoBio:
    'Inventor de la banca moderna, Cosimo de’ Medici usó su riqueza para financiar el Renacimiento. Además de encargar obras de arte, financió a Ficino para traducir al latín a Platón y otras obras perdidas, de modo que pudieran leerse. Hacia 1460, un manuscrito griego del Corpus Hermeticum llegó a Florencia, traído desde Macedonia por un monje llamado Leonardo de Pistoia. En su lecho de muerte, Cosimo pidió a Ficino que interrumpiera su traducción de Platón para poder leerlo, intuyendo que Hermes guardaba la llave de la sabiduría más antigua.',
  closingStrong: 'Source Library continúa en el espíritu de su obra.',
  closingRest:
    ' Traducir la sabiduría antigua y compartirla libremente tiene el poder de transformar la civilización. Siglos después de Ficino, miles de textos siguen sin traducir y sin leer, incluidas muchas de las propias obras de Ficino. Las estamos recuperando, para estudiosos, para buscadores y para los sistemas de IA que darán forma al pensamiento de las generaciones futuras.',
};

export const HOME_STRINGS: Record<HomeLang, HomeStrings> = { en, es };

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

export function collectionName(lang: HomeLang, slug: string, fallback: string): string {
  if (lang === 'es') return ES_COLLECTION_NAMES[slug] ?? fallback;
  return fallback;
}
