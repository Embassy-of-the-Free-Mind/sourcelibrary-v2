// Every word on /about, per language (.claude/docs/i18n.md: chrome lives in a
// dictionary keyed by Locale). English is the source. Book titles, names and the
// reading demo's own output stay as the site shows them.

import type { Locale } from '@/lib/locale-path';

export interface AboutChartStrings {
  tabsLabel: string;
  play: string;
  pause: string;
  replay: string;
  dates: string;
  counted: string;
  inEnglish: string;
  notCounted: string;
  unknown: string;
  legendDone: string;
  legendRest: string;
  legendEstimate: string;
  /** Tab names and headings, one per chart step. */
  steps: { name: string; title: string }[];
  /** Row names by row key, then the period labels. */
  rows: Record<string, string>;
  to1700: string;
  allPeriods: string;
  to1912: string;
  /** The words in the uncounted row. */
  restUnit: string;
}

export interface AboutDemoStrings {
  transcribed: string;
  translated: string;
  tagged: string;
  english: string;
  tags: string;
  subject: string;
  illustration: string;
  /** `{title}` is replaced with the book's title. */
  aria: string;
  /** Tag kinds and picture kinds, by their English name. */
  kinds: Record<string, string>;
}

export interface AboutCounterStrings {
  online: string;
  readable: string;
  first: string;
  squares: string;
  /** `{first}`, `{read}` and `{all}` are replaced with the numbers. */
  aria: string;
}

export interface AboutFigureStrings {
  lead: string;
  quote: string;
  alt: string;
  captionPre: string;
  captionTitle: string;
  captionPost: string;
}

export interface AboutStrings {
  meta: { title: string; description: string; ogAlt: string };
  stats: { online: string; readable: string; first: string };
  heroTitle: string;
  heroIntro: string;
  secondTitle: string;
  secondBody: string;
  sources: { summary: string; body: string; link: string };
  chart: AboutChartStrings;
  once: { title: string; lead: string; pairFirst: string };
  readEnglish: string;
  wonder: AboutFigureStrings;

  ai: {
    title: string;
    lead: string;
    shelf: string;
    /** Same order as PAGES in freethinkers-data.ts. */
    books: { lang: string; what: string; alt: string }[];
  };
  how: {
    title: string;
    steps: { title: string; body: string }[];
    share: { title: string; pre: string; cited: string; mid: string; use: string; post: string };
  };
  demo: AboutDemoStrings;
  counters: AboutCounterStrings & { title: string; lead: string };
  who: {
    title: string;
    embassyTitle: string;
    embassyAlt: string;
    embassyPre: string;
    embassyLink: string;
    embassyMid: string;
    guinness: string;
    embassyPost: string;
    derekTitle: string;
    derekAlt: string;
    derekPre: string;
    derekMid: string;
    derekLink: string;
    derekPost: string;
    partnersTitle: string;
    /** Wisdom Frontiers, Gambrell, Frond, Folium. */
    partners: string[];
  };
  join: { title: string; body: string; donate: string; vision: string; more: string; browse: string; faq: string; api: string };
}

const en: AboutStrings = {
  meta: {
    title: 'About Source Library: making the world’s written past readable',
    description: 'Source Library gathers old books and manuscripts from around the world and translates them with AI, beside the original page, so anyone can read them.',
    ogAlt: 'Making the world’s written past readable: a wall of old book covers',
  },
  stats: { online: 'books online', readable: 'readable in English', first: 'first-ever English translations' },
  heroTitle: 'Making the world’s written past readable',
  heroIntro: 'Source Library gathers old books and manuscripts from around the world and translates them, so anyone can read them.',
  secondTitle: 'Most of it has never been translated.',
  secondBody: 'Of everything anyone has counted, from Latin to Tibetan, less than 1% has been translated into English. On this wall, they are the few that stay lit.',
  sources: {
    summary: 'Sources and method',
    body: 'Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic (including Persian and Ottoman Turkish, written in Arabic script) and Indian languages: estimated surviving manuscripts, counted in handwritten copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.',
    link: 'How we measured it',
  },
  chart: {
    tabsLabel: 'Zoom out', play: 'Play', pause: 'Pause', replay: 'Play again from Latin',
    dates: 'dates', counted: 'counted', inEnglish: 'in English', notCounted: 'not counted', unknown: 'unknown',
    legendDone: 'translated into English', legendRest: 'never translated', legendEstimate: 'estimated, in handwritten copies rather than works',
    steps: [
      { name: 'Latin', title: 'Latin was the language of Renaissance science and philosophy. Almost none of it is in English.' },
      { name: 'European', title: 'The other languages of early printed Europe have even less in English.' },
      { name: 'Arabic', title: 'Millions of Arabic-script manuscripts survive. Nobody has counted the works in them.' },
      { name: 'Indian', title: 'India’s manuscripts are estimated at nearly three times as many.' },
      { name: 'Chinese', title: 'China’s written past may be the largest of all. It has never been counted.' },
    ],
    rows: { la: 'Latin', nl: 'Dutch', de: 'German', fr: 'French', en: 'English', it: 'Italian', es: 'Spanish', tib: 'Tibetan', ara: 'Arabic', ind: 'Indian languages', chi: 'Chinese', rest: 'Not yet counted' },
    to1700: 'to 1700', allPeriods: 'all periods', to1912: 'to 1912',
    restUnit: 'Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek, medieval Latin…',
  },
  once: {
    title: 'The last time old books were translated on this scale, it started the Renaissance.',
    lead: 'In the 1460s Cosimo de’ Medici, the most powerful man in Florence, backed Marsilio Ficino to translate Plato and the Hermetic writings from Greek into Latin. Ideas Western Europe had only known second-hand were suddenly in the hands of its scholars, artists and physicians. Renaissance means rebirth: old knowledge, readable again.',
    pairFirst: 'Ficino gave Europe back Plato, Socrates and Hermes.',
  },
  readEnglish: 'Read the page in English',
  wonder: {
    lead: 'Socrates to the young Theaetetus, in Ficino’s Latin:',
    quote: 'This affection is most characteristic of a philosopher, which is called wonder; for there is no other principle of philosophy than this.',
    alt: 'A handwritten page of Plato’s Theaetetus in Ficino’s Latin, from a manuscript dedicated to Lorenzo de’ Medici',
    captionPre: 'Plato’s ', captionTitle: 'Theaetetus', captionPost: ', from Ficino’s Latin dialogues copied for Lorenzo de’ Medici. Biblioteca Medicea Laurenziana, Florence.',
  },
  ai: {
    title: 'We translate the books that were left behind',
    lead: 'Ficino spent his life on Plato and Plotinus. With AI, a whole book can get a careful first translation in days, set beside the original page so anyone can check it. These are also the books AI never learned from: they were never scanned, translated or put online.',
    shelf: 'Six of our first English translations',
    books: [
      { lang: 'Ottoman Turkish', what: 'A painted manuscript of the stars, the zodiac and divination, from the Islamic tradition.', alt: 'Painted miniature of a figure riding a white bull, the sign of Taurus' },
      { lang: 'Latin', what: 'Argues that a plant’s looks reveal its powers: flowers like animal heads, seeds like a child in the womb.', alt: 'Woodcut of flowering plants beside the animal heads they resemble' },
      { lang: 'Latin', what: 'An English physician’s map of the universe, in which the cosmos and the human body mirror each other.', alt: 'Engraving of the cosmos in rings, with a woman standing at its centre' },
      { lang: 'Latin', what: 'A Jesuit scholar’s ten books on light, optics, shadows and sundials.', alt: 'Frontispiece with rays of light passing between sun, moon and earth' },
      { lang: 'Sanskrit', what: 'An astronomer in Varanasi questions older Indian methods for calculating the planets and eclipses.', alt: 'Diagram of the earth’s shadow cone in a lunar eclipse, labelled in Sanskrit' },
      { lang: 'Chinese', what: 'A Qing official’s survey of plants, each drawn and named, with how it was grown and used.', alt: 'Woodcut of water spinach in flower' },
    ],
  },
  how: {
    title: 'How a page becomes readable',
    steps: [
      { title: 'Scan', body: 'We scan books at the Embassy of the Free Mind and bring in scans from libraries worldwide.' },
      { title: 'Transcribe', body: 'AI reads each page and types it out, old print and handwriting included.' },
      { title: 'Translate', body: 'Each page is translated into English and set beside the original, so anyone can check every line.' },
      { title: 'Tag', body: 'Names, places, ideas and pictures are tagged, so you can search inside the books.' },
    ],
    share: { title: 'Share', pre: 'Every translation can be ', cited: 'cited', mid: ', and other software and AI tools can ', use: 'use it', post: '.' },
  },
  demo: {
    transcribed: 'Transcribed', translated: 'Translated', tagged: 'Tagged', english: 'English', tags: 'Tags', subject: 'Subject', illustration: 'Illustration',
    aria: 'A page from {title} being transcribed, translated and tagged',
    kinds: {},
  },
  counters: {
    title: 'Thousands of books, in English for the first time',
    lead: 'For comparison, Harvard’s I Tatti Renaissance Library, one of the most ambitious translation series of our time, published its 100th volume in 2025, 24 years after its first.',
    online: 'books online', readable: 'readable in English', first: 'translated into English for the first time',
    squares: 'Each square is a hundred books.',
    aria: '{first} first translations and {read} books readable in English, out of {all} books online',
  },
  who: {
    title: 'Started at the Embassy of the Free Mind in Amsterdam',
    embassyTitle: 'The Embassy of the Free Mind',
    embassyAlt: 'The Embassy of the Free Mind in the Huis met de Hoofden, Keizersgracht, Amsterdam',
    embassyPre: 'The ', embassyLink: 'Embassy',
    embassyMid: ' is home to the Bibliotheca Philosophica Hermetica: over 28,000 volumes on Hermetic philosophy, alchemy, mysticism and religion, on UNESCO’s Dutch Memory of the World Register and holder of the ',
    guinness: 'Guinness World Record',
    embassyPost: ' for the largest library dedicated to magic and mysticism. Librarian Paul Dijstelberge and senior researcher Carlos Gilly guide our work with the collection.',
    derekTitle: 'Derek Lomas, founder',
    derekAlt: 'Derek Lomas standing beside a bronze bust of Marsilio Ficino at the Embassy of the Free Mind',
    derekPre: 'Derek came across Ficino’s ',
    derekMid: ' at the Embassy and couldn’t read it, because it had never been translated. He started Source Library there in 2022, under the bust of Ficino. He studied cognitive science at Yale, did his PhD at Carnegie Mellon and teaches at TU Delft. Read his ',
    derekLink: 'founder’s letter', derekPost: '.',
    partnersTitle: 'Partners',
    partners: [
      'Wisdom Frontiers, a society in La Jolla, California, backs Source Library and its research, and set out with us in 2025 to translate the untranslated works of the Renaissance.',
      'The Gambrell Foundation of Charlotte, North Carolina, invests in thinkers working on what makes a good life, and supports the Embassy of the Free Mind and Source Library.',
      'Frond Studio designs and builds Source Library: the site, the reader and the tools behind them.',
      'Folium builds digital libraries for other libraries, museums and archives on the same system as Source Library: every page transcribed, translated and tagged, and published under the institution’s own name. The Embassy’s own catalogue already runs on it.',
    ],
  },
  join: {
    title: 'Help fund the next first translation.',
    body: 'The translations are free to read. Gifts pay for scanning fragile books, translating them and keeping the library online.',
    donate: 'Donate', vision: 'Read the vision', more: 'More about Source Library',
    browse: 'Browse the library', faq: 'FAQ', api: 'API and MCP server',
  },
};

const es: AboutStrings = {
  meta: {
    title: 'Sobre Source Library: hacer legible el pasado escrito del mundo',
    description: 'Source Library reúne libros y manuscritos antiguos de todo el mundo y los traduce con IA, junto a la página original, para que cualquiera pueda leerlos.',
    ogAlt: 'Hacer legible el pasado escrito del mundo: una pared de cubiertas de libros antiguos',
  },
  stats: { online: 'libros en línea', readable: 'legibles en inglés', first: 'primeras traducciones al inglés' },
  heroTitle: 'Hacer legible el pasado escrito del mundo',
  heroIntro: 'Source Library reúne libros y manuscritos antiguos de todo el mundo y los traduce para que cualquiera pueda leerlos.',
  secondTitle: 'Casi todo sigue sin traducir.',
  secondBody: 'De todo lo que se ha contado, del latín al tibetano, menos del 1 % se ha traducido al inglés. En esta pared, son los pocos que siguen encendidos.',
  sources: {
    summary: 'Fuentes y método',
    body: 'Europa: obras distintas impresas antes de 1700 en el Universal Short Title Catalogue, cotejadas con 30 catálogos de traducciones (mayo de 2026). Tibetano: obras del catálogo BDRC. Árabe (con el persa y el turco otomano en escritura árabe) y lenguas de la India: manuscritos conservados según estimaciones, contados en copias, no en obras. Chino: 200.000 títulos y 500.000 ediciones catalogados hasta 1912, un mínimo. Sin contar: manuscritos japoneses, coreanos, persas, hebreos, armenios, etíopes, en griego bizantino y en latín medieval.',
    link: 'Cómo lo medimos',
  },
  chart: {
    tabsLabel: 'Ampliar', play: 'Reproducir', pause: 'Pausa', replay: 'Reproducir de nuevo desde el latín',
    dates: 'fechas', counted: 'contados', inEnglish: 'en inglés', notCounted: 'sin contar', unknown: 'se ignora',
    legendDone: 'traducido al inglés', legendRest: 'nunca traducido', legendEstimate: 'estimado, en copias manuscritas y no en obras',
    steps: [
      { name: 'Latín', title: 'El latín fue la lengua de la ciencia y la filosofía del Renacimiento. Casi nada está en inglés.' },
      { name: 'Europa', title: 'Las demás lenguas de la Europa de la imprenta tienen aún menos en inglés.' },
      { name: 'Árabe', title: 'Sobreviven millones de manuscritos en escritura árabe. Nadie ha contado las obras que contienen.' },
      { name: 'India', title: 'Los manuscritos de la India se estiman en casi el triple.' },
      { name: 'China', title: 'El pasado escrito de China quizá sea el mayor de todos. Nunca se ha contado.' },
    ],
    rows: { la: 'Latín', nl: 'Neerlandés', de: 'Alemán', fr: 'Francés', en: 'Inglés', it: 'Italiano', es: 'Español', tib: 'Tibetano', ara: 'Árabe', ind: 'Lenguas de la India', chi: 'Chino', rest: 'Aún sin contar' },
    to1700: 'hasta 1700', allPeriods: 'todas las épocas', to1912: 'hasta 1912',
    restUnit: 'Japonés, coreano, persa, hebreo, armenio, etíope, griego bizantino, latín medieval…',
  },
  once: {
    title: 'La última vez que se tradujeron libros antiguos a esta escala, empezó el Renacimiento.',
    lead: 'En la década de 1460, Cosme de Médici, el hombre más poderoso de Florencia, apoyó a Marsilio Ficino para traducir a Platón y los escritos herméticos del griego al latín. Ideas que Europa occidental solo conocía de segunda mano llegaron de pronto a sus estudiosos, artistas y médicos. Renacimiento significa volver a nacer: saber antiguo, legible otra vez.',
    pairFirst: 'Ficino devolvió a Europa a Platón, Sócrates y Hermes.',
  },
  readEnglish: 'Lee la página en inglés',
  wonder: {
    lead: 'Sócrates al joven Teeteto, en el latín de Ficino:',
    quote: 'Esta afección, llamada asombro, es lo más propio del filósofo; pues la filosofía no tiene otro principio que este.',
    alt: 'Página manuscrita del Teeteto de Platón en el latín de Ficino, de un manuscrito dedicado a Lorenzo de Médici',
    captionPre: '', captionTitle: 'Teeteto', captionPost: ' de Platón, de los diálogos latinos de Ficino copiados para Lorenzo de Médici. Biblioteca Medicea Laurenziana, Florencia.',
  },
  ai: {
    title: 'Traducimos los libros que quedaron atrás',
    lead: 'Ficino dedicó su vida a Platón y Plotino. Con la IA, un libro entero puede tener una primera traducción cuidadosa en días, junto a la página original para que cualquiera la compruebe. Son también los libros de los que la IA nunca aprendió: nunca se digitalizaron, tradujeron ni publicaron en línea.',
    shelf: 'Seis de nuestras primeras traducciones al inglés',
    books: [
      { lang: 'Turco otomano', what: 'Un manuscrito pintado sobre las estrellas, el zodiaco y la adivinación, de la tradición islámica.', alt: 'Miniatura de una figura a lomos de un toro blanco, el signo de Tauro' },
      { lang: 'Latín', what: 'Sostiene que el aspecto de una planta revela sus poderes: flores como cabezas de animal, semillas como un niño en el vientre.', alt: 'Grabado de plantas en flor junto a las cabezas de animal a las que se parecen' },
      { lang: 'Latín', what: 'El mapa del universo de un médico inglés, donde el cosmos y el cuerpo humano se reflejan.', alt: 'Grabado del cosmos en anillos, con una mujer en el centro' },
      { lang: 'Latín', what: 'Diez libros de un jesuita sobre la luz, la óptica, las sombras y los relojes de sol.', alt: 'Frontispicio con rayos de luz entre el sol, la luna y la tierra' },
      { lang: 'Sánscrito', what: 'Un astrónomo de Benarés cuestiona antiguos métodos indios para calcular planetas y eclipses.', alt: 'Diagrama del cono de sombra de la Tierra en un eclipse lunar, rotulado en sánscrito' },
      { lang: 'Chino', what: 'El estudio de las plantas de un funcionario Qing, cada una dibujada y nombrada, con su cultivo y uso.', alt: 'Grabado de espinaca de agua en flor' },
    ],
  },
  how: {
    title: 'Cómo se vuelve legible una página',
    steps: [
      { title: 'Digitalizar', body: 'Digitalizamos libros en la Embassy of the Free Mind e incorporamos otros de bibliotecas de todo el mundo.' },
      { title: 'Transcribir', body: 'La IA lee cada página y la transcribe, incluidas la imprenta antigua y la letra manuscrita.' },
      { title: 'Traducir', body: 'Cada página se traduce al inglés y se coloca junto al original, para que cualquiera compruebe cada línea.' },
      { title: 'Etiquetar', body: 'Se etiquetan nombres, lugares, ideas e imágenes, para que puedas buscar dentro de los libros.' },
    ],
    share: { title: 'Compartir', pre: 'Cada traducción puede ', cited: 'citarse', mid: ', y otros programas y herramientas de IA pueden ', use: 'usarla', post: '.' },
  },
  demo: {
    transcribed: 'Transcrito', translated: 'Traducido', tagged: 'Etiquetado', english: 'Inglés', tags: 'Etiquetas', subject: 'Tema', illustration: 'Ilustración',
    aria: 'Una página de {title} mientras se transcribe, traduce y etiqueta',
    kinds: { Term: 'Término', Terms: 'Términos', Figure: 'Figura', Person: 'Persona', Reference: 'Referencia', Place: 'Lugar', Date: 'Fecha', Motif: 'Motivo', 'Latin · manuscript': 'Latín · manuscrito', Dutch: 'Neerlandés', 'Middle French': 'Francés medio', 'German · Fraktur': 'Alemán · Fraktur', 'French · manuscript': 'Francés · manuscrito', watercolour: 'acuarela', Engraving: 'Grabado', 'Woodcut · diagram': 'Xilografía · diagrama', 'Frontispiece · engraving': 'Frontispicio · grabado', 'hand-coloured': 'coloreado a mano' },
  },
  counters: {
    title: 'Miles de libros, en inglés por primera vez',
    lead: 'Como comparación, la I Tatti Renaissance Library de Harvard, una de las colecciones de traducción más ambiciosas de nuestro tiempo, publicó su volumen número 100 en 2025, 24 años después del primero.',
    online: 'libros en línea', readable: 'legibles en inglés', first: 'traducidos al inglés por primera vez',
    squares: 'Cada cuadrado son cien libros.',
    aria: '{first} primeras traducciones y {read} libros legibles en inglés, de {all} libros en línea',
  },
  who: {
    title: 'Nació en la Embassy of the Free Mind, en Ámsterdam',
    embassyTitle: 'La Embassy of the Free Mind',
    embassyAlt: 'La Embassy of the Free Mind en la Huis met de Hoofden, Keizersgracht, Ámsterdam',
    embassyPre: 'La ', embassyLink: 'Embassy',
    embassyMid: ' alberga la Bibliotheca Philosophica Hermetica: más de 28.000 volúmenes de filosofía hermética, alquimia, mística y religión, en el registro neerlandés Memoria del Mundo de la UNESCO y con el ',
    guinness: 'récord Guinness',
    embassyPost: ' de la mayor biblioteca dedicada a la magia y la mística. El bibliotecario Paul Dijstelberge y el investigador Carlos Gilly guían nuestro trabajo con la colección.',
    derekTitle: 'Derek Lomas, fundador',
    derekAlt: 'Derek Lomas junto a un busto de bronce de Marsilio Ficino en la Embassy of the Free Mind',
    derekPre: 'Derek encontró el ',
    derekMid: ' de Ficino en la Embassy y no pudo leerlo, porque nunca se había traducido. Allí empezó Source Library en 2022, bajo el busto de Ficino. Estudió ciencias cognitivas en Yale, se doctoró en Carnegie Mellon y enseña en la TU Delft. Lee su ',
    derekLink: 'carta del fundador', derekPost: '.',
    partnersTitle: 'Socios',
    partners: [
      'Wisdom Frontiers, una sociedad de La Jolla, California, respalda Source Library y su investigación, y se propuso con nosotros en 2025 traducir las obras sin traducir del Renacimiento.',
      'La Gambrell Foundation de Charlotte, Carolina del Norte, invierte en pensadores que trabajan sobre la vida buena, y apoya a la Embassy of the Free Mind y a Source Library.',
      'Frond Studio diseña y construye Source Library: el sitio, el lector y sus herramientas.',
      'Folium crea bibliotecas digitales para otras bibliotecas, museos y archivos con el mismo sistema que Source Library: cada página transcrita, traducida y etiquetada, y publicada con el nombre de la institución. El propio catálogo de la Embassy ya funciona con él.',
    ],
  },
  join: {
    title: 'Ayuda a financiar la próxima primera traducción.',
    body: 'Leer las traducciones es gratis. Las donaciones pagan la digitalización de libros frágiles, su traducción y la biblioteca en línea.',
    donate: 'Donar', vision: 'Lee la visión', more: 'Más sobre Source Library',
    browse: 'Explora la biblioteca', faq: 'Preguntas frecuentes', api: 'API y servidor MCP',
  },
};

const la: AboutStrings = {
  meta: {
    title: 'De Source Library: praeterita scripta orbis legibilia facere',
    description: 'Source Library libros et codices antiquos ex toto orbe colligit et, adiuvante intellegentia artificiali, iuxta paginam primam convertit, ut quivis legat.',
    ogAlt: 'Praeterita scripta orbis legibilia facere: paries tegumentorum librorum antiquorum',
  },
  stats: { online: 'libri in interreti', readable: 'Anglice legibiles', first: 'primae conversiones Anglicae' },
  heroTitle: 'Praeterita scripta orbis legibilia facere',
  heroIntro: 'Source Library libros et codices antiquos ex toto orbe colligit et convertit, ut quivis eos legere possit.',
  secondTitle: 'Pleraque numquam conversa sunt.',
  secondBody: 'Ex omnibus quae numerata sunt, a Latinis ad Tibetana, minus quam centesima pars Anglice conversa est. In hoc pariete pauci illi lucent.',
  sources: {
    summary: 'Fontes et ratio',
    body: 'Europa: opera diversa ante annum 1700 impressa in Universal Short Title Catalogue, cum 30 catalogis conversionum collata (Maio 2026). Tibetana: opera catalogi BDRC. Arabica (cum Persicis et Turcicis Ottomanicis litteris Arabicis scriptis) et linguae Indicae: codices superstites ex aestimatione, exemplaribus non operibus numerati. Sinica: 200.000 tituli et 500.000 editiones usque ad annum 1912, minimum. Nondum numerata: codices Iaponici, Coreani, Persici, Hebraici, Armenii, Aethiopici, Graeci Byzantini, Latini medii aevi.',
    link: 'Quomodo mensi sumus',
  },
  chart: {
    tabsLabel: 'Amplifica', play: 'Incipe', pause: 'Siste', replay: 'Iterum a Latinis incipe',
    dates: 'tempora', counted: 'numerata', inEnglish: 'Anglice', notCounted: 'non numerata', unknown: 'ignotum',
    legendDone: 'Anglice conversa', legendRest: 'numquam conversa', legendEstimate: 'aestimata, exemplaribus manu scriptis, non operibus',
    steps: [
      { name: 'Latina', title: 'Lingua Latina scientiae et philosophiae Renascentiae fuit. Vix quicquam eius Anglice exstat.' },
      { name: 'Europaea', title: 'Ceterae linguae Europae typographicae etiam minus Anglice habent.' },
      { name: 'Arabica', title: 'Codices litteris Arabicis scripti decies centena milia supersunt. Opera in eis nemo numeravit.' },
      { name: 'Indica', title: 'Codices Indiae fere triplo plures aestimantur.' },
      { name: 'Sinica', title: 'Praeterita scripta Sinarum fortasse omnium maxima sunt. Numquam numerata sunt.' },
    ],
    rows: { la: 'Latina', nl: 'Batava', de: 'Germanica', fr: 'Francogallica', en: 'Anglica', it: 'Italica', es: 'Hispanica', tib: 'Tibetana', ara: 'Arabica', ind: 'Linguae Indicae', chi: 'Sinica', rest: 'Nondum numerata' },
    to1700: 'ad 1700', allPeriods: 'omnia tempora', to1912: 'ad 1912',
    restUnit: 'Iaponica, Coreana, Persica, Hebraica, Armenia, Aethiopica, Graeca Byzantina, Latina medii aevi…',
  },
  once: {
    title: 'Cum libri antiqui ultimum tanta copia conversi sunt, Renascentia orta est.',
    lead: 'Annis 1460 Cosmus Medices, Florentiae potentissimus, Marsilium Ficinum sustentavit, ut Platonem et scripta Hermetica e Graeco in Latinum converteret. Quae Europa occidentalis ex aliis tantum noverat, subito in manibus doctorum, artificum, medicorum fuerunt. Renascentia iterum nasci significat: vetus scientia rursus legibilis.',
    pairFirst: 'Ficinus Europae Platonem, Socratem, Hermetem reddidit.',
  },
  readEnglish: 'Paginam Anglice lege',
  wonder: {
    lead: 'Socrates ad adulescentem Theaetetum, Latine a Ficino conversus:',
    quote: 'Maxime enim philosophi haec affectio est quae admiratio dicitur; neque enim aliud praeter hoc est philosophiae principium.',
    alt: 'Pagina manu scripta Theaeteti Platonis Latine a Ficino conversi, ex codice Laurentio Medici dedicato',
    captionPre: 'Platonis ', captionTitle: 'Theaetetus', captionPost: ', ex dialogis Latinis Ficini Laurentio Medici descriptis. Bibliotheca Medicea Laurenziana, Florentiae.',
  },
  ai: {
    title: 'Libros relictos convertimus',
    lead: 'Ficinus totam vitam Platoni et Plotino dedit. Nunc ope machinae totus liber paucis diebus diligenter primum convertitur, iuxta paginam primigeniam, ut quivis conversionem probare possit. Hi sunt etiam libri ex quibus machina numquam didicit: numquam enim imagine expressi, conversi aut in interrete positi sunt.',
    shelf: 'Sex ex primis nostris conversionibus Anglicis',
    books: [
      { lang: 'Turcica Ottomanica', what: 'Codex pictus de stellis, zodiaco, divinatione, ex traditione Islamica.', alt: 'Pictura hominis in tauro albo vecti, signum Tauri' },
      { lang: 'Latina', what: 'Docet plantae speciem vires eius ostendere: flores ut capita animalium, semina ut infans in utero.', alt: 'Xylographia plantarum florentium iuxta capita animalium quibus similes sunt' },
      { lang: 'Latina', what: 'Tabula universi a medico Anglo facta, in qua mundus et corpus humanum inter se respondent.', alt: 'Figura incisa mundi orbibus, muliere in medio stante' },
      { lang: 'Latina', what: 'Decem libri Iesuitae de luce, optica, umbris, horologiis solaribus.', alt: 'Frons cum radiis lucis inter solem, lunam, terram' },
      { lang: 'Sanscrita', what: 'Astronomus Varanasi veteres Indorum rationes planetarum et eclipsium computandarum examinat.', alt: 'Figura coni umbrae terrae in defectu lunae, Sanscrite inscripta' },
      { lang: 'Sinica', what: 'Plantarum recensio a magistratu Qing facta, singulae pictae et nominatae, cum cultu et usu.', alt: 'Xylographia herbae aquaticae florentis' },
    ],
  },
  how: {
    title: 'Quomodo pagina legibilis fiat',
    steps: [
      { title: 'Imago', body: 'Libros in Legatione Mentis Liberae capimus et imagines e bibliothecis totius orbis afferimus.' },
      { title: 'Transcriptio', body: 'Machina quamque paginam legit et describit, typos veteres et manum quoque.' },
      { title: 'Conversio', body: 'Quaeque pagina Anglice vertitur et iuxta primam ponitur, ut quivis omnem versum probet.' },
      { title: 'Notae', body: 'Nomina, loci, sententiae, imagines notantur, ut intra libros quaerere possis.' },
    ],
    share: { title: 'Communicatio', pre: 'Omnis conversio ', cited: 'citari', mid: ' potest, et alia instrumenta ', use: 'ea uti', post: ' possunt.' },
  },
  demo: {
    transcribed: 'Descripta', translated: 'Conversa', tagged: 'Notata', english: 'Anglice', tags: 'Notae', subject: 'Res', illustration: 'Imago',
    aria: 'Pagina ex {title} describitur, convertitur, notatur',
    kinds: { Term: 'Vox', Terms: 'Voces', Figure: 'Figura', Person: 'Persona', Reference: 'Locus', Place: 'Locus', Date: 'Tempus', Motif: 'Argumentum', 'Latin · manuscript': 'Latina · codex', Dutch: 'Batava', 'Middle French': 'Francogallica media', 'German · Fraktur': 'Germanica · Fraktur', 'French · manuscript': 'Francogallica · codex', watercolour: 'aquarella', Engraving: 'Incisio', 'Woodcut · diagram': 'Xylographia · figura', 'Frontispiece · engraving': 'Frons · incisio', 'hand-coloured': 'manu picta' },
  },
  counters: {
    title: 'Milia librorum, primum Anglice',
    lead: 'Ad comparandum: Bibliotheca Renascentiae I Tatti Harvardiana, inter ambitiosissimas nostri temporis conversionum series, anno 2025 centesimum volumen edidit, viginti quattuor annis post primum.',
    online: 'libri in interreti', readable: 'Anglice legibiles', first: 'primum Anglice conversi',
    squares: 'Quodque quadratum centum libri sunt.',
    aria: '{first} primae conversiones et {read} libri Anglice legibiles, ex {all} libris in interreti',
  },
  who: {
    title: 'Orta in Legatione Mentis Liberae Amstelodami',
    embassyTitle: 'Embassy of the Free Mind',
    embassyAlt: 'Embassy of the Free Mind in domo Huis met de Hoofden, Keizersgracht, Amstelodami',
    embassyPre: '', embassyLink: 'Embassy of the Free Mind',
    embassyMid: ' Bibliothecam Philosophicam Hermeticam habet: plus quam 28.000 volumina de philosophia Hermetica, alchimia, mystica, religione, in tabula Batava Memoriae Mundi UNESCO, quae ',
    guinness: 'Guinness recordum',
    embassyPost: ' tenet ut maxima bibliotheca magiae et mysticae dedicata. Bibliothecarius Paul Dijstelberge et investigator Carlos Gilly opus nostrum in collectione regunt.',
    derekTitle: 'Derek Lomas, conditor',
    derekAlt: 'Derek Lomas iuxta aeneum Marsilii Ficini busta in Embassy of the Free Mind',
    derekPre: 'Derek ',
    derekMid: ' Ficini in Embassy invenit nec legere potuit, quia numquam conversum erat. Ibi anno 2022 Source Library incepit, sub busta Ficini. Scientiam cognitivam Yale didicit, doctor Carnegie Mellon factus est, TU Delft docet. Lege eius ',
    derekLink: 'epistulam conditoris', derekPost: '.',
    partnersTitle: 'Socii',
    partners: [
      'Wisdom Frontiers, societas in La Jolla, California, Source Library et eius investigationes sustinet, et anno 2025 nobiscum opera Renascentiae nondum conversa vertere coepit.',
      'Gambrell Foundation Charlottae, in Carolina Septentrionali, cogitatores de bona vita sustentat, et Embassy of the Free Mind et Source Library adiuvat.',
      'Frond Studio Source Library designat et aedificat: situm, lectorem, instrumenta.',
      'Folium bibliothecas digitales aliis bibliothecis, museis, archivis eodem systemate aedificat: omnis pagina descripta, conversa, notata, sub nomine instituti edita. Catalogus ipse Embassy eo iam utitur.',
    ],
  },
  join: {
    title: 'Adiuva ut proxima prima conversio fiat.',
    body: 'Conversiones gratis leguntur. Dona libros fragiles capiendos, convertendos, bibliothecam in rete servandam sustentant.',
    donate: 'Dona', vision: 'Propositum lege', more: 'Plura de Source Library',
    browse: 'Bibliothecam percurre', faq: 'Quaestiones', api: 'API et servus MCP',
  },
};

const nl: AboutStrings = {
  meta: {
    title: 'Over Source Library: het geschreven verleden leesbaar maken',
    description: 'Source Library verzamelt oude boeken en handschriften van over de hele wereld en vertaalt ze met AI, naast de originele pagina, zodat iedereen ze kan lezen.',
    ogAlt: 'Het geschreven verleden van de wereld leesbaar maken: een wand van oude boekomslagen',
  },
  stats: { online: 'boeken online', readable: 'leesbaar in het Engels', first: 'eerste Engelse vertalingen' },
  heroTitle: 'Het geschreven verleden leesbaar maken',
  heroIntro: 'Source Library verzamelt oude boeken en handschriften van over de hele wereld en vertaalt ze, zodat iedereen ze kan lezen.',
  secondTitle: 'Het meeste is nooit vertaald.',
  secondBody: 'Van alles wat ooit is geteld, van Latijn tot Tibetaans, is minder dan 1% in het Engels vertaald. Op deze wand zijn dat de weinige die blijven branden.',
  sources: {
    summary: 'Bronnen en methode',
    body: 'Europa: afzonderlijke werken gedrukt vóór 1700 in de Universal Short Title Catalogue, vergeleken met 30 vertaalcatalogi (mei 2026). Tibetaans: werken in de BDRC-catalogus. Arabisch (met Perzisch en Ottomaans Turks in Arabisch schrift) en Indiase talen: geschatte bewaarde handschriften, geteld in kopieën, niet in werken. Chinees: 200.000 titels en 500.000 edities gecatalogiseerd tot 1912, een minimum. Nog niet geteld: Japanse, Koreaanse, Perzische, Hebreeuwse, Armeense, Ethiopische, Byzantijns-Griekse en middeleeuws-Latijnse handschriften.',
    link: 'Hoe we het hebben gemeten',
  },
  chart: {
    tabsLabel: 'Uitzoomen', play: 'Afspelen', pause: 'Pauze', replay: 'Opnieuw afspelen vanaf Latijn',
    dates: 'periode', counted: 'geteld', inEnglish: 'in het Engels', notCounted: 'niet geteld', unknown: 'onbekend',
    legendDone: 'in het Engels vertaald', legendRest: 'nooit vertaald', legendEstimate: 'geschat, in handgeschreven kopieën en niet in werken',
    steps: [
      { name: 'Latijn', title: 'Latijn was de taal van de wetenschap en filosofie van de renaissance. Bijna niets ervan is in het Engels.' },
      { name: 'Europees', title: 'In de andere talen van het vroeg gedrukte Europa is nog minder in het Engels.' },
      { name: 'Arabisch', title: 'Er bestaan miljoenen handschriften in Arabisch schrift. Niemand heeft de werken erin geteld.' },
      { name: 'Indiaas', title: 'De handschriften van India worden op bijna drie keer zoveel geschat.' },
      { name: 'Chinees', title: 'Het geschreven verleden van China is misschien het grootste van alle. Het is nooit geteld.' },
    ],
    rows: { la: 'Latijn', nl: 'Nederlands', de: 'Duits', fr: 'Frans', en: 'Engels', it: 'Italiaans', es: 'Spaans', tib: 'Tibetaans', ara: 'Arabisch', ind: 'Indiase talen', chi: 'Chinees', rest: 'Nog niet geteld' },
    to1700: 'tot 1700', allPeriods: 'alle periodes', to1912: 'tot 1912',
    restUnit: 'Japans, Koreaans, Perzisch, Hebreeuws, Armeens, Ethiopisch, Byzantijns Grieks, middeleeuws Latijn…',
  },
  once: {
    title: 'De vorige keer dat oude boeken op deze schaal werden vertaald, begon de renaissance.',
    lead: 'In de jaren 1460 steunde Cosimo de’ Medici, de machtigste man van Florence, Marsilio Ficino om Plato en de hermetische geschriften uit het Grieks in het Latijn te vertalen. Ideeën die West-Europa alleen uit de tweede hand kende, lagen opeens bij geleerden, kunstenaars en artsen. Renaissance betekent wedergeboorte: oude kennis, weer leesbaar.',
    pairFirst: 'Ficino gaf Europa Plato, Socrates en Hermes terug.',
  },
  readEnglish: 'Lees de pagina in het Engels',
  wonder: {
    lead: 'Socrates tot de jonge Theaetetus, in het Latijn van Ficino:',
    quote: 'Deze aandoening, verwondering genoemd, is bij uitstek eigen aan de filosoof; de filosofie heeft geen ander begin dan dit.',
    alt: 'Handgeschreven pagina van Plato’s Theaetetus in het Latijn van Ficino, uit een handschrift opgedragen aan Lorenzo de’ Medici',
    captionPre: 'Plato’s ', captionTitle: 'Theaetetus', captionPost: ', uit Ficino’s Latijnse dialogen, afgeschreven voor Lorenzo de’ Medici. Biblioteca Medicea Laurenziana, Florence.',
  },
  ai: {
    title: 'Wij vertalen de boeken die zijn blijven liggen',
    lead: 'Ficino werkte zijn hele leven aan Plato en Plotinus. Met AI krijgt een heel boek in een paar dagen een zorgvuldige eerste vertaling, naast de originele pagina, zodat iedereen die kan controleren. Het zijn ook de boeken waar AI nooit van heeft geleerd: ze zijn nooit gescand, vertaald of online gezet.',
    shelf: 'Zes van onze eerste Engelse vertalingen',
    books: [
      { lang: 'Ottomaans Turks', what: 'Een beschilderd handschrift over de sterren, de dierenriem en waarzeggerij, uit de islamitische traditie.', alt: 'Miniatuur van een figuur op een witte stier, het teken Stier' },
      { lang: 'Latijn', what: 'Betoogt dat het uiterlijk van een plant haar krachten toont: bloemen als dierenkoppen, zaden als een kind in de baarmoeder.', alt: 'Houtsnede van bloeiende planten naast de dierenkoppen waarop ze lijken' },
      { lang: 'Latijn', what: 'De kaart van het heelal van een Engelse arts, waarin kosmos en menselijk lichaam elkaar spiegelen.', alt: 'Gravure van de kosmos in ringen, met een vrouw in het midden' },
      { lang: 'Latijn', what: 'Tien boeken van een jezuïet over licht, optica, schaduwen en zonnewijzers.', alt: 'Titelprent met lichtstralen tussen zon, maan en aarde' },
      { lang: 'Sanskriet', what: 'Een astronoom in Varanasi stelt oudere Indiase rekenmethoden voor planeten en eclipsen ter discussie.', alt: 'Diagram van de schaduwkegel van de aarde bij een maansverduistering, met Sanskriet opschriften' },
      { lang: 'Chinees', what: 'Het plantenoverzicht van een Qing-ambtenaar, elk getekend en benoemd, met teelt en gebruik.', alt: 'Houtsnede van waterspinazie in bloei' },
    ],
  },
  how: {
    title: 'Hoe een pagina leesbaar wordt',
    steps: [
      { title: 'Scannen', body: 'We scannen boeken bij de Embassy of the Free Mind en halen scans op bij bibliotheken wereldwijd.' },
      { title: 'Transcriberen', body: 'AI leest elke pagina en typt die uit, ook oude druk en handschrift.' },
      { title: 'Vertalen', body: 'Elke pagina wordt in het Engels vertaald en naast het origineel gezet, zodat iedereen elke regel kan nagaan.' },
      { title: 'Taggen', body: 'Namen, plaatsen, ideeën en beelden krijgen tags, zodat je in de boeken kunt zoeken.' },
    ],
    share: { title: 'Delen', pre: 'Elke vertaling kan worden ', cited: 'geciteerd', mid: ', en andere software en AI-tools kunnen ', use: 'haar gebruiken', post: '.' },
  },
  demo: {
    transcribed: 'Getranscribeerd', translated: 'Vertaald', tagged: 'Getagd', english: 'Engels', tags: 'Tags', subject: 'Onderwerp', illustration: 'Illustratie',
    aria: 'Een pagina uit {title} wordt getranscribeerd, vertaald en getagd',
    kinds: { Term: 'Term', Terms: 'Termen', Figure: 'Figuur', Person: 'Persoon', Reference: 'Verwijzing', Place: 'Plaats', Date: 'Datum', Motif: 'Motief', 'Latin · manuscript': 'Latijn · handschrift', Dutch: 'Nederlands', 'Middle French': 'Middelfrans', 'German · Fraktur': 'Duits · Fraktur', 'French · manuscript': 'Frans · handschrift', watercolour: 'aquarel', Engraving: 'Gravure', 'Woodcut · diagram': 'Houtsnede · diagram', 'Frontispiece · engraving': 'Titelprent · gravure', 'hand-coloured': 'handgekleurd' },
  },
  counters: {
    title: 'Duizenden boeken, voor het eerst in het Engels',
    lead: 'Ter vergelijking: Harvards I Tatti Renaissance Library, een van de meest ambitieuze vertaalreeksen van onze tijd, bracht in 2025 het honderdste deel uit, 24 jaar na het eerste.',
    online: 'boeken online', readable: 'leesbaar in het Engels', first: 'voor het eerst in het Engels vertaald',
    squares: 'Elk vierkant is honderd boeken.',
    aria: '{first} eerste vertalingen en {read} boeken leesbaar in het Engels, van {all} boeken online',
  },
  who: {
    title: 'Begonnen bij de Embassy of the Free Mind in Amsterdam',
    embassyTitle: 'De Embassy of the Free Mind',
    embassyAlt: 'De Embassy of the Free Mind in het Huis met de Hoofden, Keizersgracht, Amsterdam',
    embassyPre: 'De ', embassyLink: 'Embassy',
    embassyMid: ' huisvest de Bibliotheca Philosophica Hermetica: ruim 28.000 delen over hermetische filosofie, alchemie, mystiek en religie, op het Nederlandse Memory of the World-register van UNESCO en houder van het ',
    guinness: 'Guinness World Record',
    embassyPost: ' voor de grootste bibliotheek over magie en mystiek. Bibliothecaris Paul Dijstelberge en senior onderzoeker Carlos Gilly begeleiden ons werk met de collectie.',
    derekTitle: 'Derek Lomas, oprichter',
    derekAlt: 'Derek Lomas naast een bronzen buste van Marsilio Ficino bij de Embassy of the Free Mind',
    derekPre: 'Derek stuitte op Ficino’s ',
    derekMid: ' bij de Embassy en kon het niet lezen, omdat het nooit vertaald was. Daar begon hij in 2022 Source Library, onder de buste van Ficino. Hij studeerde cognitiewetenschap aan Yale, promoveerde aan Carnegie Mellon en doceert aan de TU Delft. Lees zijn ',
    derekLink: 'brief van de oprichter', derekPost: '.',
    partnersTitle: 'Partners',
    partners: [
      'Wisdom Frontiers, een genootschap in La Jolla, Californië, steunt Source Library en zijn onderzoek, en begon in 2025 met ons de onvertaalde werken van de renaissance te vertalen.',
      'De Gambrell Foundation uit Charlotte, North Carolina, investeert in denkers over het goede leven en steunt de Embassy of the Free Mind en Source Library.',
      'Frond Studio ontwerpt en bouwt Source Library: de site, de lezer en de tools erachter.',
      'Folium bouwt digitale bibliotheken voor andere bibliotheken, musea en archieven op hetzelfde systeem als Source Library: elke pagina getranscribeerd, vertaald en getagd, onder de eigen naam van de instelling. De catalogus van de Embassy draait er al op.',
    ],
  },
  join: {
    title: 'Steun de volgende eerste vertaling.',
    body: 'De vertalingen zijn gratis te lezen. Giften betalen het scannen van kwetsbare boeken, het vertalen en de online bibliotheek.',
    donate: 'Doneer', vision: 'Lees de visie', more: 'Meer over Source Library',
    browse: 'Blader door de bibliotheek', faq: 'Veelgestelde vragen', api: 'API en MCP-server',
  },
};

const zh: AboutStrings = {
  meta: {
    title: '关于 Source Library：让世界的文字遗产人人可读',
    description: 'Source Library 汇集世界各地的古籍与手稿，借助人工智能进行翻译，并与原页对照呈现，让每个人都能读到。',
    ogAlt: '让世界的文字遗产人人可读：一面古籍封面墙',
  },
  stats: { online: '册在线', readable: '册可读英文', first: '部英文首译' },
  heroTitle: '让世界的文字遗产人人可读',
  heroIntro: 'Source Library 汇集世界各地的古籍与手稿并加以翻译，让每个人都能读到。',
  secondTitle: '其中绝大部分从未被翻译。',
  secondBody: '在所有已统计的文献中，从拉丁文到藏文，译成英文的不足百分之一。在这面墙上，它们就是那几本还亮着的书。',
  sources: {
    summary: '来源与方法',
    body: '欧洲：《通用简题书目》(USTC) 收录的 1700 年前印刷的不同著作，与 30 种翻译书目比对（2026 年 5 月）。藏文：BDRC 书目中的著作。阿拉伯文（含以阿拉伯字母书写的波斯文和奥斯曼土耳其文）与印度诸语言：现存手稿的估计数，按抄本而非著作计。中文：截至 1912 年著录的 20 万种书目和 50 万个版本，为下限。尚未统计：日文、朝鲜文、波斯文、希伯来文、亚美尼亚文、埃塞俄比亚文、拜占庭希腊文和中世纪拉丁文手稿。',
    link: '我们如何统计',
  },
  chart: {
    tabsLabel: '逐步放大', play: '播放', pause: '暂停', replay: '从拉丁文重新播放',
    dates: '时期', counted: '已统计', inEnglish: '有英译', notCounted: '未统计', unknown: '未知',
    legendDone: '已译成英文', legendRest: '从未翻译', legendEstimate: '估计数，按手抄本而非著作计',
    steps: [
      { name: '拉丁文', title: '拉丁语是文艺复兴时期科学与哲学的语言，几乎没有译成英文。' },
      { name: '欧洲', title: '早期印刷时代欧洲的其他语言，能读到英文的更少。' },
      { name: '阿拉伯文', title: '阿拉伯文字的手稿存世数以百万计，其中有多少部作品，无人统计过。' },
      { name: '印度', title: '印度的手稿估计接近其三倍。' },
      { name: '中文', title: '中国的文字遗产或许是最庞大的，却从未被统计过。' },
    ],
    rows: { la: '拉丁文', nl: '荷兰文', de: '德文', fr: '法文', en: '英文', it: '意大利文', es: '西班牙文', tib: '藏文', ara: '阿拉伯文', ind: '印度诸语言', chi: '中文', rest: '尚未统计' },
    to1700: '至 1700', allPeriods: '所有时期', to1912: '至 1912',
    restUnit: '日文、朝鲜文、波斯文、希伯来文、亚美尼亚文、埃塞俄比亚文、拜占庭希腊文、中世纪拉丁文……',
  },
  once: {
    title: '上一次如此大规模地翻译古籍，开启了文艺复兴。',
    lead: '十五世纪六十年代，佛罗伦萨最有权势的科西莫·德·美第奇支持马尔西利奥·菲奇诺，将柏拉图和赫尔墨斯文集从希腊文译成拉丁文。西欧过去只能间接了解的思想，一下子到了学者、艺术家和医生的手中。文艺复兴意为重生：古老的知识，再次可读。',
    pairFirst: '菲奇诺把柏拉图、苏格拉底和赫尔墨斯还给了欧洲。',
  },
  readEnglish: '阅读此页英文',
  wonder: {
    lead: '苏格拉底对年轻的泰阿泰德说（菲奇诺拉丁文译本）：',
    quote: '这种名为惊奇的感受，最是哲学家所特有；因为哲学别无其他开端，唯此而已。',
    alt: '柏拉图《泰阿泰德篇》菲奇诺拉丁文译本的手写页，出自献给洛伦佐·德·美第奇的抄本',
    captionPre: '柏拉图', captionTitle: '《泰阿泰德篇》', captionPost: '，出自为洛伦佐·德·美第奇抄写的菲奇诺拉丁文对话集。佛罗伦萨美第奇·洛伦佐图书馆藏。',
  },
  ai: {
    title: '我们翻译那些被遗落的书',
    lead: '费奇诺毕生翻译柏拉图与普罗提诺。借助人工智能，一整本书几天内就能得到一份细致的初译，并与原页并列，任何人都能核对。这些也是人工智能从未学到的书：它们从未被扫描、翻译或放到网上。',
    shelf: '我们首次译成英文的六部书',
    books: [
      { lang: '奥斯曼土耳其文', what: '一部彩绘手稿，讲述星辰、黄道十二宫和占卜，出自伊斯兰传统。', alt: '彩绘细密画：骑白牛的人物，即金牛座' },
      { lang: '拉丁文', what: '主张植物的外形揭示其效力：花如兽首，籽如腹中婴儿。', alt: '木刻：开花植物与其形似的兽首' },
      { lang: '拉丁文', what: '一位英国医生绘制的宇宙图景，宇宙与人体彼此映照。', alt: '铜版画：环状宇宙，中央站着一位女子' },
      { lang: '拉丁文', what: '一位耶稣会学者论光、光学、阴影和日晷的十卷书。', alt: '扉页：太阳、月亮与地球之间的光线' },
      { lang: '梵文', what: '瓦拉纳西的一位天文学家质疑印度推算行星和日月食的旧法。', alt: '月食时地球影锥示意图，以梵文标注' },
      { lang: '中文', what: '清代官员的植物考察，逐一绘图定名，并记其栽培与用途。', alt: '木刻：开花的蕹菜' },
    ],
  },
  how: {
    title: '一页书如何变得可读',
    steps: [
      { title: '扫描', body: '我们在自由心灵大使馆扫描书籍，并汇集世界各地图书馆的扫描件。' },
      { title: '转录', body: 'AI 逐页识读并录入文字，包括古旧印刷体和手写体。' },
      { title: '翻译', body: '每一页都译成英文，并与原文并排，人人都能逐行核对。' },
      { title: '标注', body: '为人名、地名、思想和图像添加标签，让你能在书中检索。' },
    ],
    share: { title: '共享', pre: '每部译作都可', cited: '引用', mid: '，其他软件和 AI 工具也可', use: '调用', post: '。' },
  },
  demo: {
    transcribed: '已转录', translated: '已翻译', tagged: '已标注', english: '英文', tags: '标签', subject: '主题', illustration: '插图',
    aria: '《{title}》的一页正在转录、翻译和标注',
    kinds: { Term: '术语', Terms: '术语', Figure: '人物', Person: '人物', Reference: '引文', Place: '地点', Date: '日期', Motif: '母题', 'Latin · manuscript': '拉丁文 · 手稿', Dutch: '荷兰文', 'Middle French': '中古法文', 'German · Fraktur': '德文 · 尖角体', 'French · manuscript': '法文 · 手稿', watercolour: '水彩', Engraving: '铜版画', 'Woodcut · diagram': '木刻 · 图解', 'Frontispiece · engraving': '扉页 · 铜版画', 'hand-coloured': '手工上色' },
  },
  counters: {
    title: '数千册书，首次有了英文',
    lead: '作为对照，哈佛的 I Tatti 文艺复兴丛书是当代最宏大的翻译丛书之一，2025 年出版了第 100 卷，距第一卷已有 24 年。',
    online: '册在线', readable: '册可读英文', first: '册首次译成英文',
    squares: '每个方格代表一百册书。',
    aria: '{all} 册在线，其中 {read} 册可读英文，{first} 册为首译',
  },
  who: {
    title: '始于阿姆斯特丹的自由心灵大使馆',
    embassyTitle: '自由心灵大使馆 (Embassy of the Free Mind)',
    embassyAlt: '阿姆斯特丹绅士运河“头像之屋”中的自由心灵大使馆',
    embassyPre: '', embassyLink: '自由心灵大使馆',
    embassyMid: '收藏着赫尔墨斯哲学图书馆 (Bibliotheca Philosophica Hermetica)：逾 28,000 卷有关赫尔墨斯哲学、炼金术、神秘主义和宗教的藏书，列入联合国教科文组织荷兰世界记忆名录，并保持',
    guinness: '吉尼斯世界纪录',
    embassyPost: '，是最大的魔法与神秘主义专题图书馆。图书馆员 Paul Dijstelberge 和资深研究员 Carlos Gilly 指导我们利用这批藏书。',
    derekTitle: 'Derek Lomas，创始人',
    derekAlt: 'Derek Lomas 站在自由心灵大使馆的马尔西利奥·菲奇诺青铜胸像旁',
    derekPre: 'Derek 在大使馆见到菲奇诺的 ',
    derekMid: '，却读不了，因为此书从未被翻译。2022 年，他在菲奇诺胸像下创办了 Source Library。他在耶鲁大学学习认知科学，在卡内基梅隆大学获博士学位，现任教于代尔夫特理工大学。请读他的',
    derekLink: '创始人信', derekPost: '。',
    partnersTitle: '合作伙伴',
    partners: [
      'Wisdom Frontiers 是加利福尼亚州拉霍亚的一个学会，支持 Source Library 及其研究，并于 2025 年与我们一起着手翻译文艺复兴时期尚未翻译的著作。',
      '北卡罗来纳州夏洛特的 Gambrell Foundation 投资于探究美好生活的思想者，并支持自由心灵大使馆和 Source Library。',
      'Frond Studio 设计并构建 Source Library：网站、阅读器及其背后的工具。',
      'Folium 用与 Source Library 相同的系统，为其他图书馆、博物馆和档案馆建设数字图书馆：每一页都经转录、翻译和标注，以机构自己的名义发布。大使馆自己的目录已在其上运行。',
    ],
  },
  join: {
    title: '资助下一部首译作品。',
    body: '译本可免费阅读。捐款用于扫描脆弱的书籍、翻译以及维持图书馆在线运行。',
    donate: '捐赠', vision: '阅读愿景', more: '更多关于 Source Library',
    browse: '浏览图书馆', faq: '常见问题', api: 'API 与 MCP 服务器',
  },
};

export const ABOUT_STRINGS: Record<Locale, AboutStrings> = { en, es, la, nl, zh };

/** Number formatting per language. Latin has no locale of its own. */
export const ABOUT_NUMBER_LOCALE: Record<Locale, string> = { en: 'en-GB', es: 'es-ES', la: 'en-GB', nl: 'nl-NL', zh: 'zh-CN' };
