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
  nativeShelfAll: string;
  /** The beginner's shelf under it (`/la` only): readable Latin a teacher can assign. */
  beginnerShelfHeading: string;
  beginnerShelfSubtitle: string;
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
  askSourceEyebrow: 'The Librarian',
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
  showcaseSubtitle: 'Small selections with an argument to make: a few dozen books each, chosen and introduced by a curator.',
  allExhibitions: (n) => `All ${n} exhibitions`,
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
  spanishSubtitle: 'The works in the library that already have a Spanish edition, page by page beside the original.',
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
    'The Source Library uses scholarship and AI systems to recover this knowledge and make it accessible to all. We are building the world’s largest open-access collection of translated primary sources, so that scholars, seekers, and AI systems can draw on the full depth of the human intellectual tradition. This work is sustained by the people who use and value it.',
  aboutP3Before: 'The Source Library is an initiative of the ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' in Amsterdam, home to the Bibliotheca Philosophica Hermetica: one of the world’s most important collections of Hermetic, alchemical, and esoteric books.',

  bePartEyebrow: 'Be part of this',
  bePartHeading: 'Help recover the lost intellectual heritage of humanity.',
  supportTitle: 'Support the Library',
  supportBody:
    'Thousands of texts from the ancient and early modern world remain untranslated and unread. Your support funds the digitization, OCR, and AI-assisted translation of these works, making them freely available to scholars, seekers, and the public for the first time.',
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


  inSpiritOf: 'In the spirit of',
  ficinoRole: '1433–1499 · Philosopher & Translator',
  ficinoBio:
    'Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin, making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the prisca theologia: the belief in an ancient wisdom tradition uniting all seekers of truth.',
  cosimoRole: '1389–1464 · Florence',
  cosimoBio:
    'The inventor of modern banking, Cosimo de’ Medici used his wealth to fund the Renaissance. In addition to commissioning art, he funded Ficino to make translations of Plato and other lost works into Latin so that they could be read. Around 1460, a Greek manuscript of the Corpus Hermeticum arrived in Florence, brought from Macedonia by a monk named Leonardo of Pistoia. The dying Cosimo asked Ficino to pause his translation of Plato so that he could read it, sensing that Hermes held the key to the most ancient wisdom.',
  closingStrong: 'The Source Library continues in the spirit of their work.',
  closingRest:
    ' Translating ancient wisdom and sharing it freely has the power to transform civilization. Centuries after Ficino, thousands of texts remain untranslated and unread, including many of Ficino’s own works. We are recovering them for scholars, for seekers, and for the AI systems that will shape how future generations think.',
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
  askSourceEyebrow: 'El Bibliotecario',
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
  showcaseSubtitle: 'Selecciones breves con una tesis: unas docenas de libros cada una, elegidos y presentados por un comisario.',
  allExhibitions: (n) => `Las ${n} exposiciones`,
  bySubjectHeading: 'Explorar por tema',
  bySubjectLead: 'Toda la biblioteca:',

  recentlyTranslatedHeading: 'Traducidas recientemente',
  recentlyTranslatedSubtitle: 'Las obras más recientes que Source Library ha traducido a una versión moderna y legible.',
  mostLikedHeading: 'Las favoritas de los lectores',
  mostLikedSubtitle: 'Los libros que más les han gustado a los lectores. ¿Encontraste uno que te encanta? Pulsa el ♥ en su página para sumar tu voto.',
  spanishHeading: 'Leer en español',
  nativeShelfHeading: 'Libros en latín',
  nativeShelfSubtitle: 'Libros escritos en latín, para leer aquí en el original.',
  nativeShelfAll: 'Todos los libros en latín',
  beginnerShelfHeading: 'Para principiantes',
  beginnerShelfSubtitle: 'Latín más fácil: los manuales, diálogos, fábulas e historias breves con que aprendieron generaciones de alumnos.',
  spanishSubtitle: 'Las obras de la biblioteca que ya cuentan con una edición en español, página a página junto al original.',
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
  askSourceEyebrow: 'Bibliothecarius',
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
  showcaseSubtitle: 'Delectus parvi, quisque cum suo argumento: libri pauci a curatore electi et praefatione instructi.',
  allExhibitions: (n) => `Omnes expositiones (${n})`,
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
  blogSubtitle: 'Investigationes de bibliotheca eiusque historia, intellegentia artificiali adiuvante',
  blogAllPosts: 'Omnes commentarii',
  tagDeepDive: 'Disquisitio',
  tagCollection: 'Collectio',

  aboutHeading:
    'Sapientia antiqua denuo reperta Renascentiam accendit. Tempus est alterius.',
  aboutP1:
    'Saecula altissimae hominum cogitationis in lingua Latina aliisque linguis paucis notis clausa iacent. Neque hominibus tantum inaccessa sunt: systemata intellegentiae artificialis nostrae aetatis e Reddit didicerunt, non e Renascentia. Decies centena milia librorum et codicum manu scriptorum nondum photographice descripta neque conversa sunt. Haec non sunt obscurae adnotatiunculae: radices sunt scientiae recentioris, psychologiae, philosophiae mentis, et quaestionum perennium de eo quid sit hominem esse.',
  aboutP2:
    'Source Library eruditione et intellegentia artificiali utitur, ut haec scientia recuperetur et omnibus pateat. Maximam orbis terrarum collectionem fontium primariorum conversorum, omnibus libere patentem, condimus, ut docti, quaerentes, et systemata intellegentiae artificialis ex tota traditionis humanae altitudine haurire possint. Hoc opus ab iis sustentatur qui eo utuntur idque magni aestimant.',
  aboutP3Before: 'Source Library inceptum est domus cui nomen ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' Amstelodami, ubi Bibliotheca Philosophica Hermetica servatur: una ex praestantissimis orbis terrarum collectionibus librorum Hermeticorum, alchemicorum, esotericorum.',

  bePartEyebrow: 'Particeps esto',
  bePartHeading: 'Adiuva ut hereditas ingenii humani amissa recuperetur.',
  supportTitle: 'Bibliothecam sustenta',
  supportBody:
    'Milia textuum antiquae et recentioris aetatis nondum conversa neque lecta manent. Liberalitate tua haec opera photographice describuntur, machina leguntur, intellegentia artificiali adiuvante convertuntur, ut doctis, quaerentibus, omnibus gratis nunc primum pateant.',
  howToSupport: 'Quomodo sustentem?',
  createAccount: 'Rationem gratuitam crea',
  contribute: 'Operam confer',
  contributeDesc: 'Adiuva in convertendo, recensendo, bibliotheca emendanda',
  developers: 'Programmatores',
  developersDesc: 'Servus MCP, CLI, API ad instrumenta investigationis',

  searchHeading: 'In bibliotheca quaere',
  searchStats: (books, authors, langs) => `${books} libri · ${authors}+ auctores · ${langs}+ linguae`,
  searchPlaceholder: 'Tempta “Hermes Trismegistus” vel “prima materia”...',
  browseBy: 'vel perlustra per',
  byTitle: 'titulos',
  byAuthor: 'auctores',
  byYear: 'annos',
  byImages: 'imagines',


  inSpiritOf: 'Eorum exemplo',
  ficinoRole: '1433–1499 · Philosophus et interpres',
  ficinoBio:
    'Ficinus opera omnia Platonis et Plotini, scripta Procli et Iamblichi, libros Hermeticos Latine vertit, ut tum primum toti Europae paterent. Opere eius accensum est Renascentiae studium Platonicorum recentiorum, Hermeticorum, et priscae theologiae: opinionis scilicet antiquam sapientiae traditionem omnes veri quaesitores coniungere.',
  cosimoRole: '1389–1464 · Florentia',
  cosimoBio:
    'Cosmus Medices, argentariae recentioris inventor, divitiis suis Renascentiam aluit. Non solum opera artis facienda locavit, sed etiam Ficino sumptus praebuit, ut Platonem aliaque opera amissa Latine verteret, quo legi possent. Circa annum 1460 codex Graecus Corporis Hermetici Florentiam pervenit, e Macedonia a monacho Leonardo Pistoriensi allatus. Cosmus iam moriturus Ficinum rogavit ut Platonem vertendum intermitteret, quo ipse eum codicem legere posset: sentiebat enim Hermetem clavem antiquissimae sapientiae tenere.',
  closingStrong: 'Source Library eorum operis vestigia sequitur.',
  closingRest:
    ' Sapientia antiqua conversa et libere communicata civitatem humanam mutare potest. Saeculis post Ficinum milia textuum nondum conversa neque lecta manent, in iis multa ipsius Ficini opera. Ea recuperamus: doctis, quaerentibus, et systematis intellegentiae artificialis quae cogitationem posterorum formabunt.',
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
  askSourceEyebrow: 'De bibliothecaris',
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
  showcaseSubtitle: 'Kleine selecties met een eigen betoog: elk enkele tientallen boeken, gekozen en ingeleid door een curator.',
  allExhibitions: (n) => `Alle ${n} tentoonstellingen`,
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
  spanishSubtitle: 'De werken in de bibliotheek die al een Spaanse editie hebben, pagina voor pagina naast het origineel.',
  galleryHeading: 'Galerij',
  gallerySubtitle: 'Platen, figuren en gravures uit zeldzame boeken in de hele bibliotheek.',
  galleryViewAll: (n) => `Alle ${n.toLocaleString('nl-NL')} illustraties bekijken`,
  discoverHeading: 'Ontdekken',
  discoverSubtitle: 'Vertaalde primaire bronnen uit de collectie.',
  discoverEmpty: 'Blader door de collectie om vertaalde primaire bronnen te ontdekken.',

  // The posts themselves are English, so the heading says so (i18n.md rule 4:
  // what is not in the page's language is labelled, never passed off).
  blogHeading: 'Onderzoeksnotities (in het Engels)',
  blogSubtitle: 'Onderzoek naar de collectie en haar geschiedenis, met hulp van AI',
  blogAllPosts: 'Alle berichten',
  tagDeepDive: 'Verdieping',
  tagCollection: 'Collectie',

  aboutHeading:
    'De herontdekking van oude wijsheid gaf mede de aanzet tot de renaissance. Het is tijd voor een nieuwe.',
  aboutP1:
    'Eeuwen van het diepste denken van de mensheid liggen opgesloten in het Latijn en andere ontoegankelijke talen. Niet alleen voor mensen: hedendaagse AI-systemen zijn getraind op Reddit, niet op de renaissance. Miljoenen boeken en handschriften zijn nog niet gescand en niet vertaald. Het gaat niet om obscure voetnoten. Het zijn de wortels van de moderne wetenschap, de psychologie, de filosofie van de geest en de eeuwige vragen over wat het betekent mens te zijn.',
  aboutP2:
    'Source Library zet wetenschappelijk onderzoek en AI-systemen in om deze kennis terug te winnen en voor iedereen toegankelijk te maken. We bouwen de grootste vrij toegankelijke collectie vertaalde primaire bronnen ter wereld, zodat wetenschappers, zoekers en AI-systemen kunnen putten uit de volle diepte van de menselijke denktraditie. Dit werk wordt gedragen door de mensen die het gebruiken en waarderen.',
  aboutP3Before: 'Source Library is een initiatief van de ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' in Amsterdam, het huis van de Bibliotheca Philosophica Hermetica: een van de belangrijkste collecties hermetische, alchemistische en esoterische boeken ter wereld.',

  bePartEyebrow: 'Doe mee',
  bePartHeading: 'Help het verloren intellectuele erfgoed van de mensheid terug te winnen.',
  supportTitle: 'Steun de bibliotheek',
  supportBody:
    'Duizenden teksten uit de oudheid en de vroegmoderne tijd zijn nog altijd onvertaald en ongelezen. Met jouw steun worden deze werken gedigitaliseerd, met OCR gelezen en met hulp van AI vertaald, zodat ze voor het eerst vrij beschikbaar komen voor wetenschappers, zoekers en iedereen die wil lezen.',
  howToSupport: 'Hoe kun je steunen?',
  createAccount: 'Maak een gratis account',
  contribute: 'Bijdragen',
  contributeDesc: 'Help de collectie te vertalen, te controleren of te verbeteren',
  developers: 'Ontwikkelaars',
  developersDesc: 'MCP-server, CLI en API voor onderzoekstools',

  searchHeading: 'Doorzoek de collectie',
  searchStats: (books, authors, langs) => `${books} boeken · ${authors}+ auteurs · ${langs}+ talen`,
  searchPlaceholder: 'Probeer “Hermes Trismegistus” of “prima materia”...',
  browseBy: 'of blader op',
  byTitle: 'titel',
  byAuthor: 'auteur',
  byYear: 'jaar',
  byImages: 'afbeeldingen',


  inSpiritOf: 'In de geest van',
  ficinoRole: '1433–1499 · Filosoof en vertaler',
  ficinoBio:
    'Ficino vertaalde het volledige werk van Plato, Plotinus, Proclus en Iamblichus en de hermetische geschriften in het Latijn, waardoor ze voor het eerst voor heel Europa toegankelijk werden. Zijn werk bracht de renaissance van het neoplatonisme, het hermetisme en de prisca theologia op gang: het geloof in een oude wijsheidstraditie die alle zoekers naar waarheid verenigt.',
  cosimoRole: '1389–1464 · Florence',
  cosimoBio:
    'Cosimo de’ Medici, de uitvinder van het moderne bankwezen, financierde met zijn rijkdom de renaissance. Hij gaf niet alleen opdrachten voor kunst, maar betaalde Ficino ook om Plato en andere verloren werken in het Latijn te vertalen, zodat ze gelezen konden worden. Rond 1460 kwam in Florence een Grieks handschrift van het Corpus Hermeticum aan, uit Macedonië meegebracht door een monnik, Leonardo van Pistoia. De stervende Cosimo vroeg Ficino zijn vertaling van Plato te onderbreken zodat hij het kon lezen, in het besef dat Hermes de sleutel tot de oudste wijsheid in handen had.',
  closingStrong: 'Source Library zet hun werk in dezelfde geest voort.',
  closingRest:
    ' Oude wijsheid vertalen en vrij delen kan de beschaving veranderen. Eeuwen na Ficino zijn duizenden teksten nog onvertaald en ongelezen, waaronder veel werken van Ficino zelf. We winnen ze terug: voor wetenschappers, voor zoekers en voor de AI-systemen die zullen bepalen hoe toekomstige generaties denken.',
};

// Chinese (#6382). The mirror of the Latin case: nothing is translated INTO
// Chinese, but the library holds many books written in Chinese, so `/zh` is a
// Chinese front door onto books that are already Chinese. Draft copy — read by
// a native editor before launch; corrections go here. Count labels carry their
// measure word ("1,234 部书"), because HomeView joins number and label with a space.
const zh: HomeStrings = {
  locale: 'zh-CN',

  heroTitle: '古代智慧的新文艺复兴',
  heroSubtitleLine1: '欢迎来到全球最大的',
  heroSubtitleLine2: 'AI 翻译古代文献图书馆。',
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
  askSourceEyebrow: '图书馆员',
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
  showcaseEyebrow: '策展',
  showcaseSubtitle: '每个策展都是一次有观点的小型精选：由策展人挑选并导读的几十部书。',
  allExhibitions: (n) => `全部 ${n} 个策展`,
  bySubjectHeading: '按主题浏览',
  bySubjectLead: '全部馆藏：',

  recentlyTranslatedHeading: '最新译出',
  recentlyTranslatedSubtitle: 'Source Library 最近译成现代可读译文的作品。',
  mostLikedHeading: '读者最爱',
  mostLikedSubtitle: '读者点赞最多的书。遇到喜欢的书？在它的页面上点 ♥，投上您的一票。',
  spanishHeading: '西班牙文阅读',
  nativeShelfHeading: '中文书籍',
  nativeShelfSubtitle: '以中文写成的书，在这里阅读原文。',
  nativeShelfAll: '全部中文书籍',
  beginnerShelfHeading: '入门读物',
  beginnerShelfSubtitle: '较易读的中文：世世代代学童用来启蒙的蒙学读本、对话、寓言和简史。',
  spanishSubtitle: '馆内已有西班牙文版的作品，与原文逐页对照。',
  galleryHeading: '图库',
  gallerySubtitle: '馆内珍本中的图版、插图与版画。',
  galleryViewAll: (n) => `查看全部 ${n.toLocaleString('zh-CN')} 幅插图`,
  discoverHeading: '发现',
  discoverSubtitle: '馆藏中已翻译的原始文献。',
  discoverEmpty: '浏览馆藏，发现已翻译的原始文献。',

  // The posts themselves are English, so the heading says so (i18n.md rule 4:
  // what is not in the page's language is labelled, never passed off).
  blogHeading: '研究笔记（英文）',
  blogSubtitle: '借助 AI 开展的关于馆藏及其历史的研究',
  blogAllPosts: '全部文章',
  tagDeepDive: '深度解读',
  tagCollection: '专题',

  aboutHeading:
    '古代智慧的重新发现曾点燃文艺复兴。如今是再来一次的时候了。',
  aboutP1:
    '人类数百年来最深刻的思想，被封存在拉丁文和其他难以读懂的语言里。读不到它们的不只是人：当代 AI 系统学的是 Reddit，而不是文艺复兴。数以百万计的书籍和手稿既未扫描，也未翻译。它们不是冷僻的脚注，而是现代科学、心理学、心灵哲学的根源，也关乎人之为人这一永恒的追问。',
  aboutP2:
    'Source Library 借助学术研究和 AI 系统找回这些知识，让所有人都能读到。我们正在建设全球最大的开放获取原始文献译本馆藏，让学者、求索者和 AI 系统都能汲取人类思想传统的全部深度。这项工作依靠使用并珍视它的人们来维持。',
  aboutP3Before: 'Source Library 是位于阿姆斯特丹的 ',
  efmLinkText: 'Embassy of the Free Mind',
  aboutP3After:
    ' 发起的项目。那里收藏着 Bibliotheca Philosophica Hermetica，这是世界上最重要的赫尔墨斯主义、炼金术和秘传学书籍收藏之一。',

  bePartEyebrow: '参与其中',
  bePartHeading: '帮助找回人类失落的思想遗产。',
  supportTitle: '支持本馆',
  supportBody:
    '数以千计的古代和近代早期文本至今未被翻译，也无人阅读。您的支持将用于这些作品的数字化、OCR 和 AI 辅助翻译，让学者、求索者和公众第一次能够免费读到它们。',
  howToSupport: '如何支持？',
  createAccount: '免费注册账户',
  contribute: '贡献',
  contributeDesc: '帮助翻译、审校或改进馆藏',
  developers: '开发者',
  developersDesc: '面向研究工具的 MCP 服务器、CLI 和 API',

  searchHeading: '搜索馆藏',
  searchStats: (books, authors, langs) => `${books} 部书 · ${authors}+ 位作者 · ${langs}+ 种语言`,
  searchPlaceholder: '试试“Hermes Trismegistus”或“prima materia”……',
  browseBy: '或按以下方式浏览：',
  byTitle: '书名',
  byAuthor: '作者',
  byYear: '年代',
  byImages: '图像',


  inSpiritOf: '承其精神',
  ficinoRole: '1433–1499 · 哲学家、翻译家',
  ficinoBio:
    '斐奇诺将柏拉图、普罗提诺、普罗克洛、扬布里柯的全部著作以及赫尔墨斯文献译成拉丁文，使全欧洲第一次能够读到它们。他的工作点燃了文艺复兴时期对新柏拉图主义、赫尔墨斯主义和“古代神学”（prisca theologia）的复兴。“古代神学”相信，有一种古老的智慧传统将所有求真者联系在一起。',
  cosimoRole: '1389–1464 · 佛罗伦萨',
  cosimoBio:
    '现代银行业的开创者科西莫·德·美第奇用他的财富资助了文艺复兴。除了委托创作艺术品，他还资助斐奇诺将柏拉图和其他失传的著作译成拉丁文，让人们得以阅读。约 1460 年，一部希腊文的《赫尔墨斯文集》手稿由修士皮斯托亚的莱奥纳多从马其顿带到佛罗伦萨。病危的科西莫请斐奇诺暂停翻译柏拉图，好让自己先读这部手稿，因为他感到赫尔墨斯握有最古老智慧的钥匙。',
  closingStrong: 'Source Library 延续着他们的事业。',
  closingRest:
    '翻译古代智慧并将其自由分享，具有改变文明的力量。斐奇诺之后数百年，仍有数以千计的文本未被翻译、无人阅读，其中包括斐奇诺本人的许多著作。我们正在为学者、为求索者，也为将塑造后人思维方式的 AI 系统，找回这些文本。',
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
