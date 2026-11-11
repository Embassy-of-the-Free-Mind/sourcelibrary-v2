// The Librarian's chrome, per locale. `/librarian` reads `en`, `/es/librarian`
// reads `es`; both render the same LibrarianClient so the two pages cannot
// drift (same shape as home-i18n.ts / book-i18n.ts).
//
// What this does NOT decide: the language the Librarian ANSWERS in. That rides
// in the chat request as `lang` (src/lib/embassy/chat-request.ts) and selects
// which edition the tools quote from. This file is only the room around the
// conversation. Client-safe: no server imports, no hooks.

import type { Metadata } from 'next';
import { withEnglishFallback, type Locale } from './locale-path';
import { siteOgImage, OG_LOCALE } from './og-locale';

export interface LibrarianStrings {
  /** <title> / og:title */
  metaTitle: string;
  metaDescription: string;
  /** Hero */
  title: string;
  /** `books` is the live collection size, already rounded and formatted. */
  intro: (books: string) => string;
  /** Empty chat state */
  emptyLead: (books: string) => string;
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
  /** Shown the moment Ask is pressed, before the first event (#6904) */
  lookingThroughLibrary: string;
  /** Shown once every search has returned and the answer is being written */
  readingWhatItFound: string;
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

// No `/la` twin for this surface (#6254): Latin reads the English copy, which is
// never rendered under a Latin URL. See `withEnglishFallback`.
export const LIBRARIAN_STRINGS: Record<Locale, LibrarianStrings> = withEnglishFallback({
  en: {
    metaTitle: 'The Librarian | Source Library',
    metaDescription: 'Ask the Librarian about any text in the collection. Alchemy, Hermetica, Kabbalah, astrology, natural philosophy: thousands of rare books, many translated into English for the first time.',
    title: 'The Librarian',
    intro: (books) => `Your research agent for over ${books} rare books. Ask a question, and the Librarian will search the collection, cross-reference sources, and build up findings you can export.`,
    emptyLead: (books) => `The Librarian searches the collection, Wikipedia, and semantic search to find answers in over ${books} rare books.`,
    emptyDisclaimer: 'Responses may contain errors. Always verify against the source page.',
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
    limitReached: 'You\'ve used your free questions for now. [Sign in](/auth/signin?callbackUrl=/librarian&reason=limit) (free) to keep talking with the Librarian. Create an account or sign in with Google.',
    genericError: 'I’m sorry, something went wrong on my end. Try again?',
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
    lookingThroughLibrary: 'Looking through the library…',
    readingWhatItFound: 'Reading what it found…',
    notebook: 'Research notebook',
    exportNotebook: 'Export',
    tools: {
      search: 'Searching the collection',
      search_collection: 'Searching the collection',
      search_semantic: 'Semantic search',
      browse_catalog: 'Counting the shelves',
      find_passages: 'Finding passages that answer it',
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
    metaTitle: 'El Bibliotecario | Source Library',
    metaDescription: 'Pregunta al Bibliotecario sobre cualquier texto de la colección. Alquimia, Hermetismo, Cábala, astrología, filosofía natural: miles de libros raros, y una edición en español que crece.',
    title: 'El Bibliotecario',
    intro: (books) => `El Bibliotecario es tu agente de investigación sobre más de ${books} libros raros. Haz una pregunta y buscará en la colección, contrastará fuentes y citará la edición en español cuando exista.`,
    emptyLead: (books) => `El Bibliotecario busca en la colección, en Wikipedia y por semejanza de sentido para encontrar respuestas en más de ${books} libros raros.`,
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
    lookingThroughLibrary: 'Buscando en la biblioteca…',
    readingWhatItFound: 'Leyendo lo que ha encontrado…',
    notebook: 'Cuaderno de investigación',
    exportNotebook: 'Exportar',
    tools: {
      search: 'Buscando en la colección',
      search_collection: 'Buscando en la colección',
      search_semantic: 'Búsqueda semántica',
      browse_catalog: 'Contando los estantes',
      find_passages: 'Buscando pasajes que respondan',
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
  zh: {
    metaTitle: '图书馆员 | Source Library',
    metaDescription: '向图书馆员提问，查阅馆中任何一部典籍。炼丹、赫尔墨斯主义、卡巴拉、占星、自然哲学：数千部珍本，许多已首次译成英文。',
    title: '图书馆员',
    intro: (books) => `您的研究助手，可查阅 ${books} 余部珍本。提出问题后，图书馆员会检索馆藏、核对多方来源，并整理出可以导出的发现。`,
    emptyLead: (books) => `图书馆员会检索馆藏、维基百科和语义搜索，在 ${books} 余部珍本中寻找答案。`,
    emptyDisclaimer: '回答可能有误，请以原书页面为准。',
    placeholder: '向图书馆员提问……',
    send: '发送',
    stop: '停止',
    startVoice: '开始语音输入',
    stopVoice: '停止语音输入',
    speakYourQuestion: '请说出您的问题',
    newConversation: '新对话',
    listed: '公开',
    notListed: '不公开',
    listedHint: '（显示在“最近”中，不会附上您的姓名）',
    onlyYou: '（仅您可见）',
    notShownToOthers: '（不会向其他人显示）',
    signIn: '登录',
    signInToKeep: '（免费），即可保存对话，以后继续查看。',
    showReasoning: '查看推理过程',
    hideReasoning: '收起推理过程',
    tryAgain: '重试',
    share: '分享',
    linkCopied: '链接已复制 ✓',
    limitReached: '您的免费提问次数暂时用完了。[登录](/auth/signin?callbackUrl=/zh/librarian&reason=limit)（免费）后可继续与图书馆员对话，可注册账号，也可用 Google 登录。',
    genericError: '抱歉，这边出了点问题，请再试一次。',
    notYetInCollection: '尚未收入馆藏',
    recent: '最近',
    myConversations: '我的对话',
    recentHint: '其他读者正在提的问题，不显示姓名。',
    noConversationsMine: '还没有对话，向图书馆员提个问题吧。',
    noConversationsRecent: '还没有对话，来做第一个提问的人吧。',
    showMore: '显示更多',
    justNow: '刚刚',
    messages: '条消息',
    librarianIsReading: '图书馆员正在阅读',
    lookingThroughLibrary: '正在馆中查找……',
    readingWhatItFound: '正在阅读查到的内容……',
    notebook: '研究笔记',
    exportNotebook: '导出',
    tools: {
      search: '正在检索馆藏',
      search_collection: '正在检索馆藏',
      search_semantic: '语义搜索',
      browse_catalog: '正在清点书架',
      find_passages: '正在查找相关段落',
      search_wikipedia: '正在查阅维基百科',
      search_images: '正在检索插图',
      search_artworks: '正在检索艺术作品',
      get_book_page: '正在阅读一页',
      read_nearby_pages: '正在阅读相邻页面',
      add_to_notebook: '正在存入笔记',
      present_choices: '思考中……',
    },
    // The pool leans toward what the Chinese site holds (Chinese-language
    // originals: alchemy, medicine, the Siku) plus the library's wider themes.
    suggestions: [
      '炼丹家如何描述点金的“贤者之石”？',
      '《周易参同契》讲了什么？',
      '古人如何理解“气”与“阴阳”？',
      '中国古代医书如何解释瘟疫？',
      '《黄帝内经》怎样看待人体与天地的关系？',
      '《本草纲目》里记载了哪些药物？',
      '古代天文学家如何推算日食？',
      '赫尔墨斯·特里斯墨吉斯忒斯是谁？',
      '说说《翠玉录》。',
      '炼金术士认为黄金是什么？',
      '西方炼金术与中国炼丹有哪些相似之处？',
      '菲奇诺是谁？',
      '这些文本如何谈论世界灵魂？',
      '阿格里帕写过哪些关于行星印记的内容？',
      '音乐与魔法之间有什么联系？',
      '布鲁诺如何设想无限的世界？',
      '什么是记忆术？',
      '卡巴拉的生命之树是什么？',
      '近代以前的人如何解释彗星？',
      '帕拉塞尔苏斯的医学主张是什么？',
      '近代早期的欧洲如何看待恶魔？',
      '玫瑰十字会是什么人？',
      '馆中最奇特的插图有哪些？',
      '馆中有哪些书直到现在才有译本？',
    ],
    dateLocale: 'zh-CN',
  },
});

/** Route metadata for `/librarian`, `/es/librarian` and `/zh/librarian`, with hreflang twins. */
export function librarianMetadata(lang: Locale): Metadata {
  const t = LIBRARIAN_STRINGS[lang];
  const path = lang === 'en' ? '/librarian' : `/${lang}/librarian`;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: {
      canonical: path,
      languages: { en: '/librarian', es: '/es/librarian', zh: '/zh/librarian', 'x-default': '/librarian' },
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
