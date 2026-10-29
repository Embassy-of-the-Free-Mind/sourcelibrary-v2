import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { localeFromPathname, localePath, type Locale, type PrefixedLocale } from '@/lib/locale-path';

// The site-shell locale layer: the pure primitives (re-exported from
// `locale-path.ts` so every existing `@/lib/i18n` import keeps working) plus
// the two hooks that read the CURRENT url. Server components must import from
// `@/lib/locale-path` instead — this module pulls in `usePathname`, and Next 16
// rejects that in a server component.
export * from '@/lib/locale-path';

/** Client hook: current locale from the URL. */
export function useLocale(): Locale {
  return localeFromPathname(usePathname());
}

// The `?lang=` carried through English-only pages (#6938). `LocaleCarry` in the
// root layout is the only writer: it reads `useSearchParams` inside its own
// Suspense boundary, so no page loses static rendering by reading it here.
let carried: PrefixedLocale | null = null;
const carriedListeners = new Set<() => void>();

export function setCarriedLocale(next: PrefixedLocale | null): void {
  if (next === carried) return;
  carried = next;
  carriedListeners.forEach((fn) => fn());
}

function subscribeCarried(fn: () => void): () => void {
  carriedListeners.add(fn);
  return () => { carriedListeners.delete(fn); };
}

/**
 * Client hook: the language of the site CHROME (header, footer, menus). The URL
 * prefix when there is one, else a carried `?lang=`. Page content keeps using
 * `useLocale()`: an English page with `?lang=la` is still an English page.
 * English during prerender and hydration, so the static HTML is unchanged.
 */
export function useChromeLocale(): Locale {
  const fromPath = useLocale();
  const fromQuery = useSyncExternalStore(subscribeCarried, () => carried, () => null);
  return fromPath !== 'en' ? fromPath : (fromQuery ?? 'en');
}

/**
 * Client hook: `localePath` bound to the locale of the page being rendered.
 * A client component that builds `/book/...` links can call this instead of
 * taking a `lang` prop — the URL already says which language it is.
 */
export function useLocalePath(): (href: string) => string {
  const lang = useLocale();
  return (href: string) => localePath(href, lang);
}

// ---------- Shared site-shell strings (header nav) ----------

export interface NavStrings {
  library: string;
  gallery: string;
  collections: string;
  articles: string;
  explore: string;
  about: string;
  /** Short on purpose: the desktop row has to fit in every language (#site-menu). */
  askLibrarian: string;
  search: string;
  menu: string;
  support: string;
}

// The header order is Library, Gallery, Collections, Articles, Explore, About,
// Ask the librarian, then search, language, sign in and support. Labels are the
// short forms: at 1280px the whole row has to fit in Spanish, Latin and Dutch
// too, and the long forms ("Pregunta al bibliotecario", "Visualizaciones")
// pushed Support off the edge. The full names stay in the footer.
export const NAV_STRINGS: Record<Locale, NavStrings> = {
  en: {
    library: 'Library',
    gallery: 'Gallery',
    collections: 'Collections',
    articles: 'Articles',
    explore: 'Explore',
    about: 'About',
    askLibrarian: 'Ask the librarian',
    search: 'Search',
    menu: 'Navigation menu',
    support: 'Donate',
  },
  es: {
    library: 'Biblioteca',
    gallery: 'Galería',
    collections: 'Colecciones',
    articles: 'Artículos',
    // Free now that Browse has left the header (it used to own 'Explorar').
    explore: 'Explorar',
    about: 'Nosotros',
    askLibrarian: 'Bibliotecario',
    search: 'Buscar',
    menu: 'Menú de navegación',
    support: 'Donar',
  },
  // Latin (#6254). Draft copy, to be read by a Latinist before launch.
  la: {
    library: 'Bibliotheca',
    gallery: 'Pinacotheca',
    collections: 'Collectiones',
    articles: 'Commentarii',
    explore: 'Tabulae',
    about: 'De nobis',
    askLibrarian: 'Bibliothecarius',
    search: 'Quaere',
    menu: 'Index navigationis',
    support: 'Dona',
  },
  // Dutch (#6382). Draft copy, to be read by a native speaker before launch.
  nl: {
    library: 'Bibliotheek',
    gallery: 'Galerij',
    collections: 'Collecties',
    articles: 'Artikelen',
    explore: 'Verkennen',
    about: 'Over ons',
    askLibrarian: 'Bibliothecaris',
    search: 'Zoeken',
    menu: 'Navigatiemenu',
    support: 'Doneer',
  },
  zh: {
    library: '书库',
    gallery: '图库',
    collections: '专题',
    articles: '文章',
    explore: '可视化',
    about: '关于',
    askLibrarian: '图书馆员',
    search: '搜索',
    menu: '导航菜单',
    support: '捐赠',
  },
};

// ---------- Shared site-shell strings (global footer) ----------
// Labels only — hrefs are unchanged and still point at the English pages.
// The thin-i18n design localizes only the homepage front door (`/es`); deep
// pages have no `/es` route, so footer links must NOT be locale-prefixed.

export interface FooterStrings {
  // column titles
  colLibrary: string;
  colDiscover: string;
  colGetInvolved: string;
  colAbout: string;
  colLegal: string;
  // Find books
  texts: string;
  askLibrarian: string;
  browseAZ: string;
  catalogue: string;
  works: string;
  gallery: string;
  identify: string;
  collections: string;
  search: string;
  favorites: string;
  // Look and listen
  explore: string;
  librarian: string;
  podcast: string;
  // How it works
  about: string;
  howItWorks: string;
  vision: string;
  census: string;
  progress: string;
  models: string;
  research: string;
  researchNotes: string;
  privacy: string;
  cookieSettings: string;
  terms: string;
  copyright: string;
  licensing: string;
  // Take part, and the top bar's two actions
  libraries: string;
  contribute: string;
  support: string;
  donate: string;
  sponsorship: string;
  connect: string;
  developers: string;
  giveFeedback: string;
  checkPages: string;
  qualityCenter: string;
  licenseLine: string;
  partnersLabel: string;
  blurb: string;
  signUp: string;
  faq: string;
  press: string;
  languages: string;
  dataset: string;
  forResearchers: string;
  forLibraries: string;
  account: string;
}

/**
 * The feedback dialog. Localised because the footer link already was: a Spanish
 * reader clicked "Enviar comentarios" and got an entirely English form —
 * "Send feedback", "Spot an error? Have an idea?", "Send". Translating the door
 * and not the room is worse than translating neither, because it invites people
 * in and then asks them to read a language they told us they do not.
 *
 * NOTE ON REACH: locale comes from the URL prefix, so these apply on /es and
 * /es/support only. On a book page there is no prefix and the dialog is still
 * English. Giving a Spanish reader a Spanish dialog everywhere needs locale to
 * follow the USER rather than the path — a bigger decision, not made here.
 */
export interface FeedbackStrings {
  /** The band above the footer (FeedbackCallout), not the dialog. */
  calloutHeading: string;
  calloutIntro: string;
  calloutButton: string;
  calloutDismiss: string;
  heading: string;
  placeholder: string;
  namePlaceholder: string;
  sendingAs: string;
  helpLabel: string;
  helpHint: string;
  emailPlaceholder: string;
  sentFrom: string;
  send: string;
  sending: string;
  tryAgain: string;
  thanks: string;
  received: string;
  /** Image attachments — button, the hint beside it, and its two failure states. */
  attach: string;
  attachHint: string;
  attachLimit: string;
  attachFailed: string;
  removeImage: string;
}

export const FEEDBACK_STRINGS: Record<Locale, FeedbackStrings> = {
  en: {
    calloutHeading: 'Share your feedback.',
    calloutIntro: 'If you spot an error, have a suggestion, or just want to say hello, we\u2019d love to hear from you.',
    calloutButton: 'Give Feedback',
    calloutDismiss: 'Dismiss',
    heading: 'Send feedback',
    placeholder: 'Spot an error? Have an idea? Anything at all...',
    namePlaceholder: 'Your name (optional)',
    sendingAs: 'Sending as',
    helpLabel: 'I\u2019d like to help: translations, research, or suggesting books.',
    helpHint: 'We\u2019ll email you to learn more.',
    emailPlaceholder: 'Your email (so we can reach out)',
    sentFrom: 'Sent from',
    send: 'Send',
    sending: 'Sending...',
    tryAgain: 'Try again',
    thanks: 'Thank you!',
    received: 'Your feedback has been received.',
    attach: 'Add a screenshot',
    attachHint: 'or paste / drop an image',
    attachLimit: 'Up to four images',
    attachFailed: 'That image could not be uploaded. Try a smaller one.',
    removeImage: 'Remove image',
  },
  es: {
    calloutHeading: 'Comparte tus comentarios.',
    calloutIntro: 'Si encuentras un error, tienes una sugerencia o simplemente quieres saludar, nos encantar\u00eda saber de ti.',
    calloutButton: 'Enviar comentarios',
    calloutDismiss: 'Descartar',
    heading: 'Enviar comentarios',
    placeholder: '\u00bfHas visto un error? \u00bfTienes una idea? Lo que sea...',
    namePlaceholder: 'Tu nombre (opcional)',
    sendingAs: 'Enviando como',
    helpLabel: 'Me gustar\u00eda ayudar: traducciones, investigaci\u00f3n o sugerir libros.',
    helpHint: 'Te escribiremos para saber m\u00e1s.',
    emailPlaceholder: 'Tu correo (para poder responderte)',
    sentFrom: 'Enviado desde',
    send: 'Enviar',
    sending: 'Enviando...',
    tryAgain: 'Int\u00e9ntalo de nuevo',
    thanks: '\u00a1Gracias!',
    received: 'Hemos recibido tus comentarios.',
    attach: 'A\u00f1adir una captura',
    attachHint: 'o pega / arrastra una imagen',
    attachLimit: 'Hasta cuatro im\u00e1genes',
    attachFailed: 'No se pudo subir esa imagen. Prueba con una m\u00e1s peque\u00f1a.',
    removeImage: 'Quitar imagen',
  },
  la: {
    calloutHeading: 'Quid sentias, nobis scribe.',
    calloutIntro: 'Si mendum invenis, si quid suades, vel si tantum salutare vis, libenter te audiemus.',
    calloutButton: 'Scribe nobis',
    calloutDismiss: 'Dimitte',
    heading: 'Scribe nobis',
    placeholder: 'Mendum vidisti? Consilium habes? Quidlibet scribe...',
    namePlaceholder: 'Nomen tuum (si vis)',
    sendingAs: 'Mittis ut',
    helpLabel: 'Adiuvare velim: convertendo, investigando, libros suadendo.',
    helpHint: 'Per epistulam te adibimus, ut plura cognoscamus.',
    emailPlaceholder: 'Inscriptio electronica tua (ut respondere possimus)',
    sentFrom: 'Missum ex',
    send: 'Mitte',
    sending: 'Mittitur...',
    tryAgain: 'Iterum tempta',
    thanks: 'Gratias agimus!',
    received: 'Verba tua accepimus.',
    attach: 'Imaginem scrinii adde',
    attachHint: 'vel imaginem huc adglutina aut trahe',
    attachLimit: 'Ad summum quattuor imagines',
    attachFailed: 'Ea imago mitti non potuit. Minorem tempta.',
    removeImage: 'Imaginem remove',
  },
  nl: {
    calloutHeading: 'Deel je feedback.',
    calloutIntro: 'Zie je een fout, heb je een suggestie of wil je gewoon hallo zeggen? We horen graag van je.',
    calloutButton: 'Feedback geven',
    calloutDismiss: 'Sluiten',
    heading: 'Feedback sturen',
    placeholder: 'Een fout gezien? Een idee? Alles is welkom...',
    namePlaceholder: 'Je naam (optioneel)',
    sendingAs: 'Verzenden als',
    helpLabel: 'Ik wil graag helpen: met vertalen, onderzoek of het voorstellen van boeken.',
    helpHint: 'We mailen je om meer te horen.',
    emailPlaceholder: 'Je e-mailadres (zodat we contact kunnen opnemen)',
    sentFrom: 'Verzonden vanaf',
    send: 'Versturen',
    sending: 'Bezig met versturen...',
    tryAgain: 'Probeer het opnieuw',
    thanks: 'Dank je wel!',
    received: 'We hebben je feedback ontvangen.',
    attach: 'Schermafbeelding toevoegen',
    attachHint: 'of plak / sleep een afbeelding',
    attachLimit: 'Maximaal vier afbeeldingen',
    attachFailed: 'Die afbeelding kon niet worden geüpload. Probeer een kleinere.',
    removeImage: 'Afbeelding verwijderen',
  },
  zh: {
    calloutHeading: '欢迎反馈。',
    calloutIntro: '如果您发现错误、有建议，或者只是想打个招呼，我们都很乐意听到您的声音。',
    calloutButton: '提交反馈',
    calloutDismiss: '关闭',
    heading: '发送反馈',
    placeholder: '发现错误？有想法？什么都可以写……',
    namePlaceholder: '您的姓名（选填）',
    sendingAs: '发送人：',
    helpLabel: '我愿意帮忙：翻译、研究或推荐书籍。',
    helpHint: '我们会发邮件与您联系，进一步了解。',
    emailPlaceholder: '您的邮箱（方便我们联系您）',
    sentFrom: '发送自',
    send: '发送',
    sending: '正在发送……',
    tryAgain: '重试',
    thanks: '谢谢！',
    received: '我们已收到您的反馈。',
    attach: '添加截图',
    attachHint: '或粘贴 / 拖入图片',
    attachLimit: '最多四张图片',
    attachFailed: '这张图片无法上传，请换一张小一点的。',
    removeImage: '移除图片',
  },
};

export const FOOTER_STRINGS: Record<Locale, FooterStrings> = {
  en: {
    colLibrary: 'Library',
    colDiscover: 'Discover',
    colGetInvolved: 'Get involved',
    colAbout: 'About',
    colLegal: 'Legal',
    texts: 'Texts',
    askLibrarian: 'Ask the librarian',
    browseAZ: 'Browse A–Z',
    catalogue: 'Catalogue',
    works: 'Works',
    gallery: 'Gallery',
    identify: 'Identify an artwork',
    collections: 'Collections',
    search: 'Search',
    favorites: 'Favorites',
    explore: 'Explore',
    librarian: 'Librarian',
    podcast: 'Podcast',
    about: 'Our story',
    howItWorks: 'How it works',
    vision: 'Our vision',
    census: 'Translation census',
    progress: 'Progress',
    models: 'AI models',
    research: 'Research',
    researchNotes: 'Articles',
    privacy: 'Privacy',
    cookieSettings: 'Cookie settings',
    terms: 'Terms',
    copyright: 'Copyright & DMCA',
    licensing: 'Licensing',
    libraries: 'Libraries',
    contribute: 'Contribute',
    support: 'Support',
    donate: 'Donate',
    sponsorship: 'Corporate sponsorship',
    connect: 'Connect to Claude & ChatGPT',
    developers: 'Developers',
    giveFeedback: 'Give feedback',
    checkPages: 'Check a few pages',
    qualityCenter: 'Quality center',
    licenseLine: 'Public domain originals · Translations CC BY-SA 4.0 · AI training requires a license',
    partnersLabel: 'In partnership with',
    blurb: "Rare texts from the world's libraries, transcribed and translated for a new renaissance.",
    signUp: 'Sign up',
    faq: 'FAQ',
    press: 'Press',
    languages: 'Languages',
    dataset: 'Dataset',
    forResearchers: 'For researchers',
    forLibraries: 'For libraries',
    account: 'Account',
  },
  es: {
    colLibrary: 'Biblioteca',
    colDiscover: 'Descubrir',
    colGetInvolved: 'Participar',
    colAbout: 'Acerca de',
    colLegal: 'Legal',
    texts: 'Textos',
    askLibrarian: 'Pregunta al bibliotecario',
    browseAZ: 'Índice A–Z',
    catalogue: 'Catálogo',
    works: 'Obras',
    gallery: 'Galería',
    identify: 'Identificar una obra',
    collections: 'Colecciones',
    search: 'Buscar',
    favorites: 'Favoritos',
    explore: 'Explorar',
    librarian: 'Bibliotecario',
    podcast: 'Pódcast',
    about: 'Nuestra historia',
    howItWorks: 'Cómo funciona',
    vision: 'Nuestra visión',
    census: 'Censo de traducciones',
    progress: 'Progreso',
    models: 'Modelos de IA',
    research: 'Investigación',
    researchNotes: 'Artículos',
    privacy: 'Privacidad',
    cookieSettings: 'Preferencias de cookies',
    terms: 'Términos',
    copyright: 'Derechos de autor y DMCA',
    licensing: 'Licencias',
    libraries: 'Bibliotecas',
    contribute: 'Contribuir',
    support: 'Apoyar',
    donate: 'Donar',
    sponsorship: 'Patrocinio corporativo',
    connect: 'Conectar con Claude y ChatGPT',
    developers: 'Desarrolladores',
    giveFeedback: 'Enviar comentarios',
    checkPages: 'Revisar algunas páginas',
    qualityCenter: 'Centro de calidad',
    licenseLine: 'Originales de dominio público · Traducciones CC BY-SA 4.0 · El entrenamiento de IA requiere licencia',
    partnersLabel: 'En colaboración con',
    blurb: 'Textos raros de las bibliotecas del mundo, transcritos y traducidos para un nuevo renacimiento.',
    signUp: 'Regístrate',
    faq: 'Preguntas frecuentes',
    press: 'Prensa',
    languages: 'Idiomas',
    dataset: 'Conjunto de datos',
    forResearchers: 'Para investigadores',
    forLibraries: 'Para bibliotecas',
    account: 'Cuenta',
  },
  // Latin (#6254). Labels only: every footer link still opens an English page.
  la: {
    colLibrary: 'Bibliotheca',
    colDiscover: 'Inveni',
    colGetInvolved: 'Particeps esto',
    colAbout: 'De nobis',
    colLegal: 'De iure',
    texts: 'Textus',
    askLibrarian: 'Bibliothecarium interroga',
    browseAZ: 'Index A–Z',
    catalogue: 'Catalogus',
    works: 'Opera',
    gallery: 'Pinacotheca',
    identify: 'Opus artis agnosce',
    collections: 'Collectiones',
    search: 'Quaere',
    favorites: 'Dilecta',
    explore: 'Explora',
    librarian: 'Bibliothecarius',
    podcast: 'Podcast',
    about: 'Historia nostra',
    howItWorks: 'Quomodo fiat',
    vision: 'Propositum nostrum',
    census: 'Census conversionum',
    progress: 'Progressus',
    models: 'Exemplaria intellegentiae artificialis',
    research: 'Investigatio',
    researchNotes: 'Commentarii',
    privacy: 'De secreto',
    cookieSettings: 'Optiones crustulorum',
    terms: 'Condiciones',
    copyright: 'Ius auctoris et DMCA',
    licensing: 'Licentiae',
    libraries: 'Bibliothecae',
    contribute: 'Operam confer',
    support: 'Sustenta',
    donate: 'Dona',
    sponsorship: 'Patrocinium societatum',
    connect: 'Cum Claude et ChatGPT coniunge',
    developers: 'Programmatores',
    giveFeedback: 'Scribe nobis',
    checkPages: 'Paucas paginas recense',
    qualityCenter: 'De qualitate',
    licenseLine: 'Exemplaria primigenia in dominio publico · Conversiones CC BY-SA 4.0 · Ad intellegentiam artificialem erudiendam licentia requiritur',
    partnersLabel: 'Cum sociis',
    blurb: 'Textus rari ex bibliothecis orbis terrarum, descripti et conversi ad novam renascentiam.',
    signUp: 'Nomen da',
    faq: 'Quaestiones frequentes',
    press: 'Nuntii publici',
    languages: 'Linguae',
    dataset: 'Data',
    forResearchers: 'Investigatoribus',
    forLibraries: 'Bibliothecis',
    account: 'Ratio tua',
  },
  // Dutch (#6382). Labels only: every footer link still opens an English page.
  nl: {
    colLibrary: 'Bibliotheek',
    colDiscover: 'Ontdekken',
    colGetInvolved: 'Meedoen',
    colAbout: 'Over ons',
    colLegal: 'Juridisch',
    texts: 'Teksten',
    askLibrarian: 'Vraag de bibliothecaris',
    browseAZ: 'Index A–Z',
    catalogue: 'Catalogus',
    works: 'Werken',
    gallery: 'Galerij',
    identify: 'Een kunstwerk herkennen',
    collections: 'Collecties',
    search: 'Zoeken',
    favorites: 'Favorieten',
    explore: 'Verkennen',
    librarian: 'Bibliothecaris',
    podcast: 'Podcast',
    about: 'Ons verhaal',
    howItWorks: 'Hoe het werkt',
    vision: 'Onze visie',
    census: 'Vertaalcensus',
    progress: 'Voortgang',
    models: 'AI-modellen',
    research: 'Onderzoek',
    researchNotes: 'Artikelen',
    privacy: 'Privacy',
    cookieSettings: 'Cookie-instellingen',
    terms: 'Voorwaarden',
    copyright: 'Auteursrecht en DMCA',
    licensing: 'Licenties',
    libraries: 'Bibliotheken',
    contribute: 'Bijdragen',
    support: 'Steunen',
    donate: 'Doneren',
    sponsorship: 'Bedrijfssponsoring',
    connect: 'Verbinden met Claude en ChatGPT',
    developers: 'Ontwikkelaars',
    giveFeedback: 'Feedback geven',
    checkPages: 'Een paar pagina’s controleren',
    qualityCenter: 'Kwaliteitscentrum',
    licenseLine: 'Originelen in het publieke domein · Vertalingen CC BY-SA 4.0 · Voor AI-training is een licentie nodig',
    partnersLabel: 'In samenwerking met',
    blurb: 'Zeldzame teksten uit de bibliotheken van de wereld, getranscribeerd en vertaald voor een nieuwe renaissance.',
    signUp: 'Aanmelden',
    faq: 'Veelgestelde vragen',
    press: 'Pers',
    languages: 'Talen',
    dataset: 'Dataset',
    forResearchers: 'Voor onderzoekers',
    forLibraries: 'Voor bibliotheken',
    account: 'Account',
  },
  zh: {
    colLibrary: '图书馆',
    colDiscover: '发现',
    colGetInvolved: '参与',
    colAbout: '关于',
    colLegal: '法律信息',
    texts: '文献',
    askLibrarian: '咨询图书馆员',
    browseAZ: '按字母浏览',
    catalogue: '目录',
    works: '作品',
    gallery: '图库',
    identify: '识别艺术作品',
    collections: '专题',
    search: '搜索',
    favorites: '收藏',
    explore: '探索',
    librarian: '图书馆员',
    podcast: '播客',
    about: '我们的故事',
    howItWorks: '工作原理',
    vision: '我们的愿景',
    census: '翻译普查',
    progress: '进展',
    models: 'AI 模型',
    research: '研究',
    researchNotes: '文章',
    privacy: '隐私',
    cookieSettings: 'Cookie 设置',
    terms: '条款',
    copyright: '版权与 DMCA',
    licensing: '许可',
    libraries: '合作图书馆',
    contribute: '贡献',
    support: '支持',
    donate: '捐赠',
    sponsorship: '企业赞助',
    connect: '连接 Claude 和 ChatGPT',
    developers: '开发者',
    giveFeedback: '提交反馈',
    checkPages: '校对几页',
    qualityCenter: '质量中心',
    licenseLine: '原本属公共领域 · 译文采用 CC BY-SA 4.0 许可 · 用于 AI 训练须获授权',
    partnersLabel: '合作伙伴',
    blurb: '来自世界各地图书馆的珍稀文献，经转录与翻译，迎接新的文艺复兴。',
    signUp: '注册',
    faq: '常见问题',
    press: '媒体',
    languages: '语言',
    dataset: '数据集',
    forResearchers: '面向研究者',
    forLibraries: '面向图书馆',
    account: '账户',
  },
};

/**
 * Shared controls that appear on every localized page — the sign-in link, the
 * Cite and Download buttons, the cookie banner (#6278 item 6, #6382). One
 * full `Record<Locale, …>`, so adding a language lists this dictionary too.
 * The Download panel's own contents (formats, the premium-format offer and its
 * price) stay English: that copy is part of a purchase flow.
 */
export interface ChromeStrings {
  signIn: string;
  cite: string;
  citeTitle: string;
  download: string;
  close: string;
  cookieText: string;
  privacyPolicy: string;
  decline: string;
  accept: string;
}

export const CHROME_STRINGS: Record<Locale, ChromeStrings> = {
  en: {
    signIn: 'Sign in', cite: 'Cite', citeTitle: 'Cite this book', download: 'Download', close: 'Close',
    cookieText: 'We use cookies for analytics to understand how the library is used.',
    privacyPolicy: 'Privacy policy', decline: 'Decline', accept: 'Accept',
  },
  es: {
    signIn: 'Iniciar sesión', cite: 'Citar', citeTitle: 'Citar este libro', download: 'Descargar', close: 'Cerrar',
    cookieText: 'Usamos cookies de analítica para entender cómo se usa la biblioteca.',
    privacyPolicy: 'Política de privacidad', decline: 'Rechazar', accept: 'Aceptar',
  },
  la: {
    signIn: 'Intra', cite: 'Cita', citeTitle: 'Hunc librum cita', download: 'Deprome', close: 'Claude',
    cookieText: 'Crustulis (cookies) utimur ut cognoscamus quomodo bibliotheca adhibeatur.',
    privacyPolicy: 'De secreto servando', decline: 'Recusa', accept: 'Accipe',
  },
  nl: {
    signIn: 'Inloggen', cite: 'Citeren', citeTitle: 'Dit boek citeren', download: 'Downloaden', close: 'Sluiten',
    cookieText: 'We gebruiken analytische cookies om te begrijpen hoe de bibliotheek wordt gebruikt.',
    privacyPolicy: 'Privacybeleid', decline: 'Weigeren', accept: 'Accepteren',
  },
  zh: {
    signIn: '登录', cite: '引用', citeTitle: '引用本书', download: '下载', close: '关闭',
    cookieText: '我们使用分析类 Cookie，以了解图书馆的使用情况。',
    privacyPolicy: '隐私政策', decline: '拒绝', accept: '接受',
  },
};
