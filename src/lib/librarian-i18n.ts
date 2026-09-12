// The Librarian's chrome, per locale. `/librarian` reads `en`, `/es/librarian`
// reads `es`; both render the same LibrarianClient so the two pages cannot
// drift (same shape as home-i18n.ts / book-i18n.ts).
//
// What this does NOT decide: the language the Librarian ANSWERS in. That rides
// in the chat request as `lang` (src/lib/embassy/chat-request.ts) and selects
// which edition the tools quote from. This file is only the room around the
// conversation. Client-safe: no server imports, no hooks.

import type { Metadata } from 'next';
import type { Locale } from './locale-path';
import { siteOgImage, OG_LOCALE } from './og-locale';

export interface LibrarianStrings {
  /** <title> / og:title */
  metaTitle: string;
  metaDescription: string;
  /** Hero */
  title: string;
  intro: string;
  /** Empty chat state */
  emptyLead: string;
  emptyDisclaimer: string;
  /** Composer */
  placeholder: string;
  send: string;
  stop: string;
  startVoice: string;
  stopVoice: string;
  speakYourQuestion: string;
  newConversation: string;
  listed: string;
  notListed: string;
  listedHint: string;
  onlyYou: string;
  notShownToOthers: string;
  signIn: string;
  signInToKeep: string;
  /** Messages */
  showReasoning: string;
  hideReasoning: string;
  tryAgain: string;
  share: string;
  linkCopied: string;
  limitReached: string;
  genericError: string;
  /** Source cards */
  notYetInCollection: string;
  /** Sidebar */
  recent: string;
  myConversations: string;
  recentHint: string;
  noConversationsMine: string;
  noConversationsRecent: string;
  showMore: string;
  justNow: string;
  /** '4 messages' in the thread list */
  messages: string;
  librarianIsReading: string;
  /** Research notebook */
  notebook: string;
  exportNotebook: string;
  /** Tool step labels */
  tools: Record<string, string>;
  /** Suggestion chips — the pool, shuffled per visit */
  suggestions: string[];
  /** date-fns style locale tag for relative dates */
  dateLocale: string;
}

export const LIBRARIAN_STRINGS: Record<Locale, LibrarianStrings> = {
  en: {
    metaTitle: 'The Librarian — Source Library',
    metaDescription: 'Ask the Librarian about any text in the collection. Alchemy, Hermetica, Kabbalah, astrology, natural philosophy — thousands of rare books, many translated into English for the first time.',
    title: 'The Librarian',
    intro: 'Your research agent for over 10,000 rare books. Ask a question, and the Librarian will search the collection, cross-reference sources, and build up findings you can export.',
    emptyLead: 'The Librarian searches the collection, Wikipedia, and semantic search to find answers in over 10,000 rare books.',
    emptyDisclaimer: 'Responses may contain errors — always verify against the source page.',
    placeholder: 'Ask the Librarian...',
    send: 'Send',
    stop: 'Stop',
    startVoice: 'Start voice input',
    stopVoice: 'Stop voice input',
    speakYourQuestion: 'Speak your question',
    newConversation: 'New conversation',
    listed: 'Listed',
    notListed: 'Not listed',
    listedHint: '(shown in Recent, never under your name)',
    onlyYou: '(only you)',
    notShownToOthers: '(not shown to anyone else)',
    signIn: 'Sign in',
    signInToKeep: '(free) to keep your conversations and come back to them later.',
    showReasoning: 'Show reasoning',
    hideReasoning: 'Hide reasoning',
    tryAgain: 'Try again',
    share: 'Share',
    linkCopied: 'Link copied ✓',
    limitReached: 'You\'ve used your free questions for now. [Sign in](/auth/signin?callbackUrl=/librarian&reason=limit) (free) to keep talking with the Librarian — create an account or sign in with Google.',
    genericError: 'I’m sorry — something went wrong on my end. Try again?',
    notYetInCollection: 'Not yet in collection',
    recent: 'Recent',
    myConversations: 'My Conversations',
    recentHint: 'What other readers are asking, shown without their names.',
    noConversationsMine: 'No conversations yet. Ask the Librarian something!',
    noConversationsRecent: 'No conversations yet. Be the first to ask the Librarian something.',
    showMore: 'Show more',
    justNow: 'just now',
    messages: 'messages',
    librarianIsReading: 'The Librarian is reading',
    notebook: 'Research notebook',
    exportNotebook: 'Export',
    tools: {
      search: 'Searching the collection',
      search_collection: 'Searching the collection',
      search_semantic: 'Semantic search',
      browse_catalog: 'Counting the shelves',
      search_wikipedia: 'Checking Wikipedia',
      search_images: 'Searching illustrations',
      search_artworks: 'Searching artworks',
      get_book_page: 'Reading a page',
      read_nearby_pages: 'Reading nearby pages',
      add_to_notebook: 'Saving to notebook',
      present_choices: 'Thinking...',
    },
    suggestions: [
      // Alchemy & Hermetica
      'How did alchemists describe the philosopher\'s stone?',
      'What did alchemists believe about gold?',
      'Tell me about the Emerald Tablet',
      'Who was Hermes Trismegistus?',
      'What equipment did a working alchemist actually use?',
      'How did Arabic alchemy reach medieval Europe?',
      'What did alchemists mean by the marriage of the sun and moon?',
      // Renaissance philosophy & magic
      'Who was Marsilio Ficino?',
      'What do these texts say about the world soul?',
      'What did Agrippa write about planetary seals?',
      'What is the relationship between music and magic?',
      'What books explore resonance as magic?',
      'How did Giordano Bruno imagine infinite worlds?',
      'What was the art of memory?',
      'Was there any conception of artificial intelligence?',
      'Did anyone write about talking statues or artificial beings?',
      // Kabbalah & mysticism
      'What is the Kabbalah\'s tree of life?',
      'What did Christian scholars make of the Zohar?',
      'What did Jacob Boehme see in his visions?',
      'How did mystics describe union with the divine?',
      // Astrology & cosmology
      'What instruments did astrologers use?',
      'How did Renaissance scholars understand the cosmos?',
      'How were comets interpreted before modern astronomy?',
      'How did Kepler mix astrology with astronomy?',
      'What did people believe about the music of the spheres?',
      // Medicine & natural philosophy
      'What did Paracelsus teach about medicine?',
      'How were dreams interpreted as medical symptoms?',
      'What remedies did early herbals prescribe?',
      'How did physicians explain the plague?',
      'What did anatomists discover before the microscope?',
      // Demonology & witchcraft
      'How were demons understood in early modern Europe?',
      'What did witch-hunting manuals actually claim?',
      'How did scholars defend accused witches?',
      'What were angels thought to know?',
      // Divination & prophecy
      'Did any of these authors write about dreams?',
      'How did people tell fortunes before tarot cards?',
      'What prophecies circulated during the Reformation?',
      // Rosicrucians & secret societies
      'Who were the Rosicrucians?',
      'What ciphers and secret alphabets appear in these books?',
      'What did the Rosicrucian manifestos promise?',
      // Eastern traditions
      'What do Tibetan texts say about the nature of mind?',
      'What does Ayurvedic medicine say about the elements?',
      'How did Sanskrit astronomers calculate eclipses?',
      // Book history & curiosities
      'What are the strangest illustrations in the collection?',
      'How were emblem books meant to be read?',
      'What did the first printed books look like?',
      'Which books here were never translated until now?',
    ],
    dateLocale: 'en-US',
  },
  es: {
    metaTitle: 'Pregunta a la fuente — El Bibliotecario | Source Library',
    metaDescription: 'Pregunta al Bibliotecario sobre cualquier texto de la colección. Alquimia, Hermetismo, Cábala, astrología, filosofía natural: miles de libros raros, y una edición en español que crece.',
    title: 'Pregunta a la fuente',
    intro: 'El Bibliotecario es tu agente de investigación sobre más de 10.000 libros raros. Haz una pregunta y buscará en la colección, contrastará fuentes y citará la edición en español cuando exista.',
    emptyLead: 'El Bibliotecario busca en la colección, en Wikipedia y por semejanza de sentido para encontrar respuestas en más de 10.000 libros raros.',
    emptyDisclaimer: 'Las respuestas pueden contener errores: comprueba siempre la página de origen.',
    placeholder: 'Pregunta al Bibliotecario...',
    send: 'Enviar',
    stop: 'Detener',
    startVoice: 'Dictar la pregunta',
    stopVoice: 'Detener el dictado',
    speakYourQuestion: 'Di tu pregunta en voz alta',
    newConversation: 'Nueva conversación',
    listed: 'Visible',
    notListed: 'No visible',
    listedHint: '(aparece en Recientes, nunca con tu nombre)',
    onlyYou: '(solo tú)',
    notShownToOthers: '(nadie más la ve)',
    signIn: 'Inicia sesión',
    signInToKeep: '(gratis) para guardar tus conversaciones y volver a ellas.',
    showReasoning: 'Ver el razonamiento',
    hideReasoning: 'Ocultar el razonamiento',
    tryAgain: 'Intentar de nuevo',
    share: 'Compartir',
    linkCopied: 'Enlace copiado ✓',
    limitReached: 'Has agotado tus preguntas gratuitas por ahora. [Inicia sesión](/es/auth/signin?callbackUrl=/es/librarian&reason=limit) (gratis) para seguir conversando con el Bibliotecario: crea una cuenta o entra con Google.',
    genericError: 'Lo siento, algo ha fallado de mi lado. ¿Lo intentamos de nuevo?',
    notYetInCollection: 'Aún no está en la colección',
    recent: 'Recientes',
    myConversations: 'Mis conversaciones',
    recentHint: 'Lo que preguntan otros lectores, sin sus nombres.',
    noConversationsMine: 'Todavía no hay conversaciones. ¡Pregúntale algo al Bibliotecario!',
    noConversationsRecent: 'Todavía no hay conversaciones. Sé quien pregunte primero.',
    showMore: 'Ver más',
    justNow: 'ahora mismo',
    messages: 'mensajes',
    librarianIsReading: 'El Bibliotecario está leyendo',
    notebook: 'Cuaderno de investigación',
    exportNotebook: 'Exportar',
    tools: {
      search: 'Buscando en la colección',
      search_collection: 'Buscando en la colección',
      search_semantic: 'Búsqueda semántica',
      browse_catalog: 'Contando los estantes',
      search_wikipedia: 'Consultando Wikipedia',
      search_images: 'Buscando ilustraciones',
      search_artworks: 'Buscando obras de arte',
      get_book_page: 'Leyendo una página',
      read_nearby_pages: 'Leyendo páginas cercanas',
      add_to_notebook: 'Guardando en el cuaderno',
      present_choices: 'Pensando...',
    },
    // Leans toward what the Spanish edition actually holds (Hermetica, Ficino,
    // Kabbalah, alchemy — the en-espanol collection) so the first answers a
    // Spanish reader gets can quote Spanish pages, not English ones.
    suggestions: [
      '¿Quién fue Hermes Trismegisto?',
      '¿Qué dice el Pimander sobre el origen del mundo?',
      '¿Cómo describían los alquimistas la piedra filosofal?',
      'Háblame de la Tabla de Esmeralda',
      '¿Qué significaba para los alquimistas la boda del sol y la luna?',
      '¿Quién fue Marsilio Ficino?',
      '¿Qué dicen estos textos sobre el alma del mundo?',
      '¿Qué escribió Agripa sobre los sellos planetarios?',
      '¿Qué relación hay entre la música y la magia?',
      '¿Cómo imaginó Giordano Bruno los mundos infinitos?',
      '¿Qué era el arte de la memoria?',
      '¿Qué es el árbol de la vida de la Cábala?',
      '¿Qué vieron los místicos en sus visiones de la unión con lo divino?',
      '¿Cómo entendían el cosmos los sabios del Renacimiento?',
      '¿Cómo se interpretaban los cometas antes de la astronomía moderna?',
      '¿Qué enseñaba Paracelso sobre la medicina?',
      '¿Cómo explicaban los médicos la peste?',
      '¿Cómo se entendía a los demonios en la Europa moderna temprana?',
      '¿Quiénes fueron los rosacruces?',
      '¿Qué prometían los manifiestos rosacruces?',
      '¿Qué cifrados y alfabetos secretos aparecen en estos libros?',
      '¿Cuáles son las ilustraciones más extrañas de la colección?',
      '¿Cómo había que leer un libro de emblemas?',
      '¿Qué libros de la colección están traducidos al español?',
    ],
    dateLocale: 'es-ES',
  },
};

/** Route metadata for `/librarian` and `/es/librarian`, with hreflang twins. */
export function librarianMetadata(lang: Locale): Metadata {
  const t = LIBRARIAN_STRINGS[lang];
  const path = lang === 'en' ? '/librarian' : `/${lang}/librarian`;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: {
      canonical: path,
      languages: { en: '/librarian', es: '/es/librarian', 'x-default': '/librarian' },
    },
    openGraph: {
      images: [siteOgImage(lang)],
      title: t.metaTitle,
      description: t.metaDescription,
      siteName: 'Source Library',
      type: 'website',
      locale: OG_LOCALE[lang],
      url: `https://sourcelibrary.org${path}`,
    },
    // Without this the root layout's English `twitter` block survives, and the
    // clients that prefer twitter:image preview the Spanish librarian in English.
    twitter: {
      card: 'summary_large_image',
      site: '@SourceLibrary_',
      title: t.metaTitle,
      description: t.metaDescription,
      images: [siteOgImage(lang)],
    },
  };
}
