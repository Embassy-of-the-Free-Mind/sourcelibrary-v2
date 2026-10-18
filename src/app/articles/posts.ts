// The Articles list: every article on /articles, its category, and the pages
// under src/app/articles that are deliberately not listed. The index
// (/articles), the category pages (/articles/<category>), the Atom feed
// (/api/feed/blog), the sitemap and /research all read this one list.
// tests/blog-posts.test.ts fails if a post has no kind, or if a directory under
// src/app/articles is neither listed here nor named in UNLISTED_PAGES.

export const BLOG_KINDS = ['stories', 'tours', 'research', 'interactive', 'library'] as const;
export type BlogKind = (typeof BLOG_KINDS)[number];

export const KIND_INFO: Record<BlogKind, { label: string; definition: string; lead: string }> = {
  stories: {
    label: 'Stories',
    definition: 'A person, an idea or a practice followed through the books that record it.',
    lead: 'nature-of-harmony',
  },
  tours: {
    label: 'Reading tours',
    definition: 'A walk through the library’s books on one subject, quoting the originals beside their translations.',
    lead: 'techniques-of-the-body',
  },
  research: {
    label: 'Research notes',
    definition: 'Counting what was written and what is translated, and testing the AI that reads the pages: where it is accurate and where it invents.',
    lead: 'the-giants-werent-translated',
  },
  interactive: {
    label: 'Interactive',
    definition: 'Instruments, charts, maps and games built from the books, to play with in the browser.',
    lead: 'sound-laboratory',
  },
  library: {
    label: 'From the library',
    definition: 'Where Source Library came from, how it is built and run, and the people behind it.',
    lead: 'origin-story',
  },
};

export interface BlogPost {
  slug: string;
  title: string;
  subtitle: string;
  // The card text on /articles and the page's meta description (og and
  // twitter too, via withArticleMeta): 155 characters at most, facts from the
  // article only (tests/blog-posts.test.ts).
  summary: string;
  date: string;
  readTime: string;
  kind: BlogKind;
  // Every post needs an image: any post can become a lead or the Latest card,
  // where the title is set over the picture (tests/blog-posts.test.ts).
  // Choosing one: the rules in .claude/skills/quote-background-image (calm area
  // where the words land, no printed text there, nothing grim). Then check it
  // with scripts/audit/blog-card-legibility.ts, which renders every lead crop.
  // Where to look, in order: a plate or woodcut from a book the post is about
  // (open the leaf: gallery records can be a leaf off); the ~24K museum works
  // already mirrored under images.sourcelibrary.org/artwork/ (search_images);
  // a new public-domain work brought in with scripts/import-*-artworks.mjs
  // (Met, Rijks, AIC, Cleveland, NGA, Getty, Commons), never a hotlink.
  // A printed text page only when the page is the post's evidence. Real works
  // only: no generated pictures in a library of primary sources.
  image: string;
  imageAlt?: string;
  // CSS object-position for the crop, e.g. 'center 30%'. Set it when the
  // default centre crop cuts off what the picture is of.
  imagePosition?: string;
  // Only on LINKED_PAGES: the page lives at its own address, outside /articles.
  href?: string;
}

// Articles written by a person rather than drafted by AI. Their footer note is a
// byline (NoteFooter) instead of the AI disclosure. Name, role and photo as the
// founder's letter already gives them.
export interface ArticleAuthor {
  name: string;
  bio: string;
  photo: string;
}

const DEREK_LOMAS: ArticleAuthor = {
  name: 'Derek Lomas',
  bio: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
  photo: '/founder-derek.jpg',
};

export const AUTHORED_ARTICLES: Record<string, ArticleAuthor> = {
  vision: DEREK_LOMAS,
  'in-memoriam': DEREK_LOMAS,
};

export function postHref(post: BlogPost): string {
  return post.href ?? `/articles/${post.slug}`;
}

// Pages under src/app/articles that are not posts in the list, and why.
export const UNLISTED_PAGES: Record<string, string> = {
  'how-these-are-made': 'About the notes rather than a note; linked from the index header.',
  'tibetan-reocr': 'Draft (DRAFT = true, noindex) until its pending numbers are filled.',
  'autonomous-agents': 'Withdrawn: needs a rewrite with proper import-session data.',
  '2000-first-translations': 'Superseded: its March 2026 counts are out of date; see counting-first-translations.',
  'worlds-largest-collection': 'Superseded: its March 2026 counts are out of date; see how-big-is-the-library.',
  'why-terminals-cant-edit': 'Off topic for Articles (terminal editors, not old books).',
  '[category]': 'The category pages (/articles/tours), not an article.',
};

// Pages that are listed as articles but live at their own address. They show
// on the /articles index and category pages only (not in the feed, sitemap or
// home slider). The Rithmomachia game stays at /rithmomachia: it is a
// full-width game with its own guide and scenario pages, not an article; the
// article about it is /articles/rithmomachia.
export const LINKED_PAGES: BlogPost[] = [
  {
    slug: 'play-rithmomachia',
    href: '/rithmomachia',
    title: 'Play Rithmomachia',
    subtitle: 'The medieval board game won by arithmetic, rebuilt from five Renaissance treatises. Play it in the browser.',
    summary:
      'The medieval board game won by arithmetic, playable in the browser, with rules from five Renaissance treatises and Lever and Fulke’s 1563 play.',
    date: '2 March 2026',
    readTime: '',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/498.jpg',
    imageAlt: 'Engraved board for rithmomachia, the battle of numbers: a chequered board with rows of numbered square, triangular and round pieces.',
  },
];

export const posts: BlogPost[] = [
  {
    slug: 'aldine-roman',
    title: 'The Aldine Roman: a facsimile type from De Aetna (1496)',
    subtitle: 'Francesco Griffo’s roman type for Aldus, traced letter by letter from our copy of De Aetna (1496).',
    summary:
      'Francesco Griffo’s roman for Aldus, cut in 1496 for Bembo’s De Aetna and traced letter by letter from our copy: the type Garamond and Times descend from.',
    date: '20 August 2026',
    readTime: '',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/pages/6a06d1f39a48d51399960d08/0020.jpg',
    imageAlt: 'A page of Bembo’s De Aetna, printed by Aldus Manutius in 1496',
  },
  {
    slug: 'beeckman-on-drebbel',
    title: 'Beeckman on Drebbel: the journal passages, 1619–1634',
    subtitle: 'What Isaac Beeckman wrote in his journal about Cornelis Drebbel’s machines, in his own words beside an English translation.',
    summary:
      'Isaac Beeckman’s journal entries on Cornelis Drebbel: the submarine, perpetual motion, the weather-glass, in his Dutch or Latin beside English.',
    date: '6 October 2026',
    readTime: '',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/artwork/art-drebbel-clock.jpg',
    imageAlt: 'Drebbel’s clock: a globe in armillary rings, held up by two sphinxes, in a coloured drawing.',
  },
  {
    slug: 'search-by-meaning',
    title: 'Search by Meaning',
    subtitle: 'How the library finds passages that say the same thing in different words and languages, and where it still falls short.',
    summary:
      'How the library finds passages that say the same thing in different words and languages, using a 768-number index of each page, and its limits.',
    date: '8 October 2026',
    readTime: '',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/86fe639a-5f3d-4e9e-9d99-128742a10809/84.jpg',
    imageAlt: 'A manuscript page of close English handwriting, numbered 70 at the top.',
  },
  {
    slug: 'by-the-numbers',
    title: 'By the Numbers',
    subtitle: 'How big the library is: books, pages, languages, centuries and the storage that holds it all.',
    summary:
      'A visual tour of the library’s size: books, pages, languages and centuries, how far the pages are through the pipeline, and the storage behind it.',
    date: '10 May 2026',
    readTime: '',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/695591547bd6d2cd1d618a62/154.jpg',
    imageAlt: 'Engraving headed “Clef XII”: an alchemist in his laboratory beside a furnace, a lion devouring a serpent at his feet, the sun and moon in the window.',
  },
  {
    slug: 'vision',
    title: 'Our Vision: A Letter from the Founder',
    subtitle: 'Why Source Library exists, what it will take to translate the world’s untranslated books, and what that costs over five years.',
    summary:
      'Derek Lomas, who founded Source Library, on why it exists, what it takes to translate the world’s untranslated books, and the five-year budget.',
    date: '19 June 2026',
    readTime: '',
    kind: 'library',
    image: '/vision/hero.jpg',
    imageAlt: 'An opening of an early printed Latin book in black-letter type, with the heading “Epistola responsiva” on the right-hand page.',
  },
  {
    slug: 'in-memoriam',
    title: 'In Memoriam: Joost R. Ritman (1941–2026)',
    subtitle: 'Remembering the founder of the Bibliotheca Philosophica Hermetica, the library where Source Library began.',
    summary:
      'Remembering Joost R. Ritman (1941 to 2026), founder of the Bibliotheca Philosophica Hermetica, where Source Library began. His motto: ad fontes.',
    date: '3 July 2026',
    readTime: '',
    kind: 'library',
    image: '/memoriam/joost-ritman.jpg',
    imageAlt: 'Joost R. Ritman',
  },
  {
    slug: 'harmonic-justice',
    title: 'Harmonic Justice',
    subtitle:
      'Before economics was a science, money and fair exchange were problems of proportion. Xenophon’s ordered house, Aristotle and Oresme, Cosimo de’ Medici’s Hermes, Pacioli’s two proportions, Copernicus at the mint, Kepler correcting Bodin, the alchemists, Adam Smith, and the harmony economists Fourier, Bastiat and Carey.',
    summary:
      'Money as proportion, from Xenophon to Bastiat and Carey: Cosimo de’ Medici’s Hermes, Pacioli, Copernicus at the mint, Kepler correcting Bodin, Adam Smith.',
    date: '18 October 2026',
    readTime: '25 min read',
    kind: 'stories',
    // English satirical print signed "Cross sculpsit": Money as a winged coin, Justice's scales on the ground.
    image: 'https://images.sourcelibrary.org/artwork/art-goltzius-print-satirical-print.jpg',
    imageAlt:
      'Engraving: Money, a coin on bird legs, runs off while Prodigality scatters coins and the scales of Justice lie on the ground; hounds named Diligence, Industry and Labour on leashes.',
  },
  {
    slug: 'maya-ritual-in-the-colonial-dictionaries',
    title: 'Maya Religion in the Colonial Sources',
    subtitle:
      'The Bacabs holding up the sky, katuns of carved stone, a diviner counting maize, the sun and the Pleiades as a disease’s parents: Maya religion from the friars who burned its books and the Maya who kept it.',
    summary:
      'Maya religion from the friars who burned its books and the Maya who kept it: Landa, the Motul dictionary, the Bacabs and the Chilam Balam books.',
    date: '16 October 2026',
    readTime: '15 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/69dfd990220eedf04e13b0cf/40.jpg',
    imageAlt: 'A page of the Dresden Codex with columns of glyphs and two descending serpents',
    imagePosition: 'center 30%',
  },
  {
    slug: 'preserved-by-enemies',
    title: 'Preserved by Their Enemies',
    subtitle:
      'The books written to stamp out a religion are often the only record of it. Hippolytus and Epiphanius copied the Gnostics they refuted; in Mexico and Yucatán the friars who burned the books wrote down the spells, the omens and the alphabet.',
    summary:
      'Books written to stamp out a religion often keep its only record: Hippolytus and Epiphanius on the Gnostics, and Landa’s Maya alphabet.',
    date: '16 October 2026',
    readTime: '12 min read',
    kind: 'stories',
    // The omen painting from the Florentine Codex leaf the essay quotes (Book 5, ch. 1), cut from our scan.
    image: '/articles/preserved-by-enemies/florentine-omen-jaguar.jpg',
    imageAlt:
      'Florentine Codex, Book 5, chapter 1: a spotted jaguar with a speech scroll at its mouth, and a man with a carrying bag who raises his hands to his head.',
  },
  {
    slug: 'hyperborea',
    title: 'Beyond the North Wind: Hyperborea and the Amber Coast',
    subtitle:
      'The Greeks placed a blessed people beyond the north wind and said amber came from the edge of the world. Herodotus doubted both. Prussian and Lithuanian historians later claimed them for the Baltic, and a nineteenth-century folklorist showed which parts of their pagan past had been invented.',
    summary:
      'Herodotus doubted the blessed people beyond the north wind and the amber from the world’s edge. Later Prussian historians claimed both for the Baltic.',
    date: '16 October 2026',
    readTime: '33 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/art-phaetons-sisters-changed-into-poplars-cygnus-into-a-swan.jpg',
    imageAlt: 'Engraving after Hendrick Goltzius: the sisters of Phaethon turning into poplars by the river Eridanus',
  },
  {
    slug: 'shipwrecks-and-buried-treasure',
    title: 'Shipwrecks and Buried Treasure',
    subtitle:
      'Six chests of Charles V’s gold off Cadiz, a king’s revenues in the Baltic, an Armada ship in Tobermory Bay, a sexton’s pot of Saxon silver, digging money in Luoyang and a Tibetan guide that says where to dig.',
    summary:
      'Charles V’s gold off Cadiz, an Armada ship in Tobermory Bay, a sexton’s pot of Saxon silver and a Tibetan guide to where to dig treasure.',
    date: '16 October 2026',
    readTime: '8 min read',
    kind: 'tours',
    image: '/articles/shipwrecks-and-buried-treasure/baixos-de-iudia.jpg',
    imageAlt: 'Woodcut of the São Tiago broken on the Bassas da India shoals, 1598',
    imagePosition: 'center 40%',
  },
  {
    slug: 'trees-of-life',
    title: 'Trees of Life Across the Traditions',
    subtitle:
      'Sefirot, Yggdrasil, the Siberian shaman’s tree, the Prussian oak, the Assyrian palm, the Codex Laud, Eden and Jesse, the Waqwaq tree, the goddess in the sycamore, the Egyptian persea, the Sanxingdui bronze tree, the lote tree, the wayang kayon, the Tibetan refuge tree, Böhme’s trees, the alchemists’ trees, the banyan, the kalpataru and the trees of logic, kinship and descent, in the plates and pages the library holds.',
    summary:
      'World trees and tree diagrams in the library’s plates: the sefirot, Yggdrasil, the Assyrian palm, the Waqwaq tree, the wayang kayon and Darwin.',
    date: '15 October 2026',
    readTime: '20 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/artwork/art-tree-of-life-fludd-1.jpg',
    imageAlt: 'Robert Fludd’s inverted sefirotic tree, 1621: roots in a crowned light above, branches spreading below',
    imagePosition: 'center 20%',
  },
  {
    slug: 'one-sentence-of-hermes',
    title: 'One Sentence of Hermes, Copied for Sixteen Hundred Years',
    subtitle:
      'A late-antique translator misread one Greek word in the Asclepius. We followed the sentence through a manuscript, five printed editions, a commentary and a critical edition, and found our own OCR making the copyists’ mistakes.',
    summary:
      'One Greek word misread by a late-antique translator of the Asclepius, followed through a manuscript, five printed editions, a commentary and our own OCR.',
    date: '8 October 2026',
    readTime: '12 min read',
    kind: 'stories',
    // A printed page because the page is the evidence: the sentence itself, and ſecunda below it.
    image: '/articles/one-sentence-of-hermes/1532-asclepius-32.jpg',
    imageAlt:
      'The Asclepius, chapter 32, in the Basel edition of 1532: the sentence on the intelligence of the human sense.',
  },
  {
    slug: 'four-commentaries-on-nothing',
    title: 'Four Commentaries on Nothing',
    subtitle:
      'Nāgārjuna with Candrakīrti, the Diamond Sutra and the Chan master Wukong, a Latin dictionary of Kabbalah, and Dionysius with Johann Eck: four commentaries that warn readers not to turn “nothing” into a doctrine. What our machine translations of them got right and wrong, and what we fixed.',
    summary:
      'Candrakīrti on Nāgārjuna, Wukong on the Diamond Sutra, a Kabbalah dictionary and Eck on Dionysius, with our translation errors and fixes.',
    date: '7 October 2026',
    readTime: '12 min read',
    kind: 'stories',
    // A printed page because the page is the evidence: the Greek column's τῶν λόγων.
    image: 'https://images.sourcelibrary.org/pages/69c87ff96c6f3cc53c858fd5/0066.jpg',
    imageAlt: 'A page of Johann Eck’s 1519 Dionysius: the Greek and three Latin translations in four columns, with commentary below.',
    imagePosition: 'center 15%',
  },
  {
    slug: 'what-the-models-cannot-name',
    title: 'What the Models Cannot Name',
    subtitle:
      'A preregistered re-run of our May survey. For about half of the distinct works we hold, none of Gemini 3.1 Pro, Claude Opus 5.5 or GPT-5.6 can name the author from the title; by volumes it is about a third. That measures what models can recall, not what they were trained on.',
    summary:
      'For about half the distinct works we hold, none of Gemini 3.1 Pro, Claude Opus 5.5 or GPT-5.6 can name the author from the title. A preregistered re-run.',
    date: '7 October 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-raphael-raphael-after-heraclitus.jpg',
    imageAlt: 'After Raphael, Heraclitus: a bearded philosopher leans on a stone block, his hand resting on a sheet of writing.',
    imagePosition: 'center 30%',
  },
  {
    slug: 'drebbel',
    title: 'The Engraver Who Went Under the Thames',
    subtitle:
      'Cornelis Drebbel built a perpetual-motion clock, a submarine, early microscopes and the first thermostat, and wrote almost nothing. What we know comes from the 57 people around him: an interactive map of his circle, every tie marked by how well it is attested, and the passages in his own book.',
    summary:
      'Cornelis Drebbel built a submarine and a perpetual-motion clock and wrote almost nothing. A map of the 57 people around him, and his own book.',
    date: '6 October 2026',
    readTime: '12 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/art-drebbel-clock.jpg',
    imageAlt: 'Drebbel’s clock: a globe in armillary rings, held up by two sphinxes, in a coloured drawing.',
  },
  {
    slug: 'training-our-own-models',
    title: 'Should a library train its own AI models?',
    subtitle:
      'Gemini reads and translates almost every page here. We measured that work slice by slice: where it is good, it can train a smaller open model of our own; where it is weak, as in early Greek print, only human-made text helps. What we have tried, what it would save, who else is doing this, and how our first open translation model fell short.',
    summary:
      'Where Gemini’s readings of our pages are good enough to train a smaller open model of our own, where they are not, and what it would save.',
    date: '4 October 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-durer-de-schoolmeester.jpg',
    imageAlt: 'Albrecht Dürer, The Schoolmaster (De schoolmeester), woodcut, 1510 (Rijksmuseum): a master seated in a high chair, two pupils with books at his feet, a landscape behind.',
    imagePosition: 'center 58%',
  },
  {
    slug: 'archive-ocr-against-proofread-pages',
    title: 'Checking the Archive\u2019s OCR against proofread pages',
    subtitle:
      'On 122 English pages with an independent proofread transcription, our own reader is better on the same page in every cohort, and in a first, preliminary count the Internet Archive\u2019s OCR text silently misreads about one printed number in a hundred. A correction to the free-reading note: if you quote a date from Archive text, check the image.',
    summary:
      'On 122 proofread English pages our reader beat the Internet Archive’s OCR, which in a first count misreads about one printed number in a hundred.',
    date: '28 September 2026',
    readTime: '8 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6990631aef12272ffdc8f4aa/324.jpg',
    imageAlt: 'Page 300 of Sachau\u2019s 1879 translation of al-B\u012br\u016bn\u012b\u2019s Chronology of Ancient Nations, which prints 5180 years twice; the Archive\u2019s text has 6180 both times.',
  },
  {
    slug: 'how-we-measure-ocr-quality',
    title: 'How We Measure OCR Quality',
    subtitle:
      'One page per book, sealed before anyone looks, scored against a published edition, graded by how many referenced books the cell holds. The design behind every engine decision, and the day the "Chinese woodblock" cell turned out to be brush manuscript.',
    summary:
      'One page per book, sealed before anyone looks, scored against a published edition: how we test OCR engines, and a woodblock cell that was manuscript.',
    date: '20 September 2026',
    readTime: '12 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/blog/siku-yuhai-6a3ceccb4701a906f10db3cb-118.jpg',
    imageAlt: 'A leaf of the Yuhai in the Siku Quanshu fair copy: brush-written regular script in ruled columns under the imperial header.',
  },
  {
    slug: 'techniques-of-the-body',
    title: 'Techniques of the Body',
    subtitle:
      'Postures, breathing methods and exercises quoted from the books that prescribe them, in Chinese, Sanskrit, Tibetan, Greek, Latin, Hebrew, Arabic and the European vernaculars: seasonal exercises, haṭha yoga, breathing methods, the Pythagorean day, theurgy, penance, prayer, drill, the gymnasium and ritual. Each original beside its translation.',
    summary:
      'Postures, breathing and exercises from the books that prescribe them, from Ge Hong’s Baopuzi to a 1922 Marathi manual, beside translations.',
    date: '15 September 2026',
    readTime: '25 min read',
    kind: 'tours',
    image: '/articles/techniques-of-the-body/hero-khrul-khor.jpg',
    imageAlt: 'A Tibetan manuscript of the Nyang tradition: figures drawn in the sequence of the ’khrul ’khor exercises.',
  },
  {
    slug: 'free-reading',
    title: 'The Reading We Did Not Have to Pay For',
    subtitle:
      'Five and a half million of our unread pages came from the Internet Archive, which had already read them once. We tested that reading book by book against our own, took it where the two agree, and measured whether a cheap language model can rescue the rest. It cannot: it invents.',
    summary:
      'We tested the Internet Archive’s OCR of 5.5 million of our pages against ours, kept it where they agree, and found a cheap model cannot fix the rest.',
    date: '12 September 2026',
    readTime: '9 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/pages/69b1863dc4be2cdd0edc573a/0011.jpg',
    imageAlt: 'Title page of Oriatrike, or Physick Refined, the 1662 English Van Helmont, with an ink blot over one word.',
  },
  {
    slug: 'atlas-of-lost-instruments',
    title: 'An Atlas of Lost Instruments',
    subtitle:
      'A keyed fiddle, a cat organ, a harp the wind plays, a box that composes, a quarrel over the megaphone, a note nobody played, sand that draws the shape of a sound, and a keyboard with thirty-one notes to the octave. Nine things about sound that were discovered, invented, or fought over in books this library holds, and the 13,647 pages of music on them that no machine can yet read.',
    summary:
      'A keyed fiddle, a cat organ, a wind harp, the megaphone quarrel and a 31-note keyboard: nine events from the library’s music books.',
    date: '11 September 2026',
    readTime: '12 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/695573e7f63a757109172b1d/293.jpg',
    imageAlt: 'Plate XXII of Praetorius\'s Theatrum Instrumentorum, 1620: folk instruments including a keyed fiddle.',
  },
  {
    slug: 'technique-is-local',
    title: 'Technique Is Local, Crisis Is Universal',
    subtitle:
      'Reading a thousand years of meditation manuals as research artifacts: the Visuddhimagga prescribes practices by temperament, Iamblichus states a dose-response curve for ritual prayer, and every imaging tradition wrote the same safety warnings. Seven testable hypotheses from the contemplative archive, and one measurement suggesting the cross-cultural core of deep practice is not bliss, but crisis.',
    summary:
      'Meditation manuals read as research: the Visuddhimagga on temperament, Iamblichus on dose, shared safety warnings and seven testable hypotheses.',
    date: '27 August 2026',
    readTime: '11 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/pages/6a1d81af5afc14a085e6d7e6/spdxcs-0138.jpg',
    imageAlt:
      'Woodcut from the 1615 Xingming guizhi: a Daoist practitioner in seated meditation with an internal-alchemy diagram on his abdomen.',
  },
  {
    slug: 'two-copies-two-languages',
    title: 'Two Copies, Two Languages',
    subtitle:
      'We hold the same 1495 Aldine grammar twice. One copy is catalogued Greek, the other Latin, and both are right. Measuring 21,481 books to settle it produced two headline findings that turned out to be the measuring instrument, and one cheap check that caught them both.',
    summary:
      'Our two copies of the 1495 Aldine Lascaris are catalogued Greek and Latin, both rightly. Measuring 21,481 books to fix it, and two false findings.',
    date: '21 August 2026',
    readTime: '8 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/pages/69b220ccf79d8af0eab7fd3a/0043.jpg',
    imageAlt:
      'A page of Greek type from the 1495 Aldine edition of Lascaris’ Erotemata, facing its Latin translation.',
  },
  {
    slug: 'suda-benchmark',
    title: 'Graded by the Suda',
    subtitle:
      'One book in our library came with its own answer key: the Suda On Line, 31,000 entries translated by two hundred volunteer scholars over sixteen years. We aligned our AI translation with theirs, let each grade the other with the Greek as arbiter, and learned that a cheap AI judge fails silently: its incapacity arrives dressed as approval. Total API cost: $1.15.',
    summary:
      'Our AI translation of the Suda graded against the Suda On Line, 31,000 entries by 200 volunteers. A cheap AI judge fails silently. Cost: $1.15.',
    date: '11 August 2026',
    readTime: '9 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/pages/69a99ce86c7545e2236e12de/0300.jpg',
    imageAlt:
      'A two-column page of Bekker’s 1854 edition of the Suda, dense Greek type listing the seven men named Didymus.',
  },
  {
    slug: 'greek-lemma-table',
    title: 'Every Shape of Every Word',
    subtitle:
      'We mapped 570,000 Greek word forms to their dictionary entries: the invisible table that turns a 400-year-old page into something you can read, checked against 132,000 words hand-verified by scholars.',
    summary:
      'A table of 570,000 Greek word forms and their dictionary entries, so you can tap a word in a 1590 book, checked against 132,000 verified words.',
    date: '10 August 2026',
    readTime: '5 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-saenredam-grot-van-plato.jpg',
    imageAlt: 'Jan Saenredam, Plato’s Cave (Grot van Plato), engraving, 1604 (Rijksmuseum): a crowd in a vaulted cave watching shadows on a wall while figures above parade objects before a lamp.',
  },
  {
    slug: 'nobody-knows-what-has-been-scanned',
    title: 'Nobody Knows What Has Been Scanned',
    subtitle:
      'No institution on earth can answer whether a book has already been digitized. We had to harvest 3.5 million records to answer it for one library, and found 3,655 books nobody has scanned. The case for a global registry.',
    summary:
      'No one can say whether a book has been digitised. We harvested 3.5 million records for one library, found 3,655 unscanned books, and ask for a registry.',
    date: '9 August 2026',
    readTime: '6 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-landsberg-ancienne-bibliotheque-municipale-strasbourg-1833.jpg',
    imageAlt: 'The old municipal library of Strasbourg, drawn in 1833: shelves of books between columns.',
  },
  {
    slug: 'reciting-not-reading',
    title: 'Reciting, Not Reading',
    subtitle:
      'We covered four lines of Genesis with an opaque grey box. Our OCR transcribed them anyway: correctly, seamlessly, and without a word of warning. Then four different prompts failed to stop it, and the one thing that worked was not something we said.',
    summary:
      'We hid four lines of Genesis in a 1566 Vulgate under a grey box and our OCR transcribed them anyway. Four prompts failed to make it admit the gap.',
    date: '30 July 2026',
    readTime: '8 min read',
    kind: 'research',
    image: '/articles/reciting-not-reading/mask-rect-zoom.jpg',
    imageAlt:
      'A 1566 Vulgate page with a grey rectangle covering four lines of Genesis 1:2, fragments of the covered lines still visible at the right edge.',
  },
  {
    slug: 'nine-models-forty-pages',
    title: 'Nine Models, Forty Pages',
    subtitle:
      "We benchmarked every OCR-capable model we could reach (Google's newest releases, three open-weight challengers, one self-hosted on a rented GPU) against the same forty historical pages, with a memorization control and paired statistics. The newest budget model lost to its own predecessor, and an open-weight model reached parity on the pages it can read.",
    summary:
      'Nine OCR-capable models, Google’s newest and three open-weight ones among them, on forty historical pages. The newest budget model lost to its predecessor.',
    date: '23 July 2026',
    readTime: '9 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/69a5e9bb787d6e9b8d42e183/120.jpg',
    imageAlt:
      "Page 109 of Eznik of Kołb's Ełc ałandoc' in the 1826 Venice printing, the Armenian page most models could not read.",
  },
  {
    slug: 'playable-page',
    title: 'The Playable Page',
    subtitle:
      'Old treatises are full of instruments diagrammed and silenced: monochord divisions, tetrachord arcs, string tables worked out to the integer.Three of them, replicated and strung: Galilei\'s two-string bench with its weight pan, the Lyre of Mercury\'s disputed numbers read as three different laws, and the full two-octave system of ancient music from a Boethius manuscript, playable in all three genera.',
    summary:
      'Three instruments from old treatises, strung to play: Galilei’s two-string bench, the Lyre of Mercury and a Boethius two-octave system.',
    date: '19 July 2026',
    readTime: '3 instruments',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/archived/6955739df63a7571091720cf/80.jpg',
    imageAlt:
      'A page of the Boethius manuscript: nested red arcs mapping the chromatic and enharmonic tetrachords, with string names and monochord numbers.',
  },
  {
    slug: 'ngram-viewer',
    title: 'Chart a Word, Then Read the Page',
    subtitle:
      'A Google-Books-style ngram viewer over five centuries of alchemy, Hermetica, and early science, with the two things word-frequency charts have never done: one curve that follows a concept across Latin, German, and French sources at once, and a click-through from any peak to the actual readable pages. Plus an honest guide to what these curves can and cannot prove.',
    summary:
      'A word-frequency chart over five centuries of alchemy and early science that follows one concept across Latin, German and French, linked to the pages.',
    date: '19 July 2026',
    readTime: '7 min read',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/artwork/art-khunrath-the-four-the-three-the-two-and-the-one.jpg',
    imageAlt: "Concentric rings of Latin, Greek, and Hebrew words: Heinrich Khunrath's 'The Four, the Three, the Two, and the One,' 1595.",
  },
  {
    slug: 'sound-laboratory',
    title: 'The Sound Laboratory',
    subtitle:
      'Ten interactive stations that put twenty-five centuries of claims about harmony to the test with your own ears: the smith\'s hammers weighed, the comma that won\'t close, Bharata\'s two vīṇās, Kepler\'s planets auditioned against modern orbits, Kircher\'s sympathetic strings, and Euler\'s formula for sweetness, graded by you. Headphones recommended.',
    summary:
      'Ten stations testing old claims about harmony by ear: the smith’s hammers, the Pythagorean comma, Bharata’s vīṇās, Kepler’s planets and Euler.',
    date: '16 July 2026',
    readTime: '10 experiments',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/artwork/art-sadeler-fabel-van-de-smid-en-de-hond.jpg',
    imageAlt: "A smith at his anvil, hammer raised: Aegidius Sadeler's engraving, 1608.",
  },
  {
    slug: 'nature-of-harmony',
    title: 'The Nature of Harmony',
    subtitle:
      'For twenty-five centuries and across five civilizations, people said the world is built like music, and split at once into those who heard a deep order and those who demanded to measure it. A history of that quarrel, from a plucked string in antiquity to the whole-number ratios inside the atom, told through the books one library holds.',
    summary:
      'Twenty-five centuries of the idea that the world is built like music, and the quarrel between those who heard an order and those who measured it.',
    date: '15 July 2026',
    readTime: '18 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg',
    imageAlt:
      "Fludd's 1617 engraving Integrae Naturae Speculum, Artisque Imago: Nature chained to the divine name above and to the ape of Art below.",
  },
  {
    slug: 'show-me-the-number',
    title: 'Show Me the Number',
    subtitle:
      'We keep saying AI should be in "harmony" with us: aligned, attuned, in tune. Is that a claim you can measure, or a picture we find comforting? Kepler forged the test four hundred years ago. A sequel on synchrony, the Platonic Representation Hypothesis, and where a real law of human–AI harmony could live.',
    summary:
      'Whether AI ‘harmony’ with people can be measured or is only a comforting picture: Kepler’s test, synchrony and the Platonic Representation Hypothesis.',
    date: '15 July 2026',
    readTime: '12 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/6952d12e77f38f6761bc5bec/74.jpg',
    imageAlt:
      "The five Platonic solids (Kepler's figurae mundanae) from Harmonices Mundi, 1619.",
    imagePosition: 'center 90%',
  },
  {
    slug: 'fish-voiced-priest',
    title: 'The Fish-Voiced Priest',
    subtitle:
      'An AI read a thousand-year-old Greek hand in the Codex Marcianus and invented a character who is not on the page: it turned "I am Ion, the priest of the inner sanctuaries" into "the fish-voiced one," then footnoted its own mistake. Why, for a hard script, the printed critical edition has to carry the text while the manuscript carries the facsimile.',
    summary:
      'An AI reading the Codex Marcianus turned ‘Ion, the priest of the inner sanctuaries’ into ‘the fish-voiced one’. Why the critical edition carries the text.',
    date: '2 July 2026',
    readTime: '11 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/manuscripts/marciana-gr-299/208.jpg',
    imageAlt: 'Folio 93 recto of the Codex Marcianus gr. Z. 299, in tenth-century Greek minuscule',
  },
  {
    slug: 'reading-classical-chinese',
    title: 'Can AI Read Classical Chinese?',
    subtitle:
      'We hold ~1,600 Chinese works, most never translated into English. Measured against ctext.org, our OCR reads canonical printed text at ~98.5% character accuracy; measured against James Legge, our translations match or beat the standard scholarly editions on clean text. The honest catch is complex layouts and the works with no reference to check against.',
    summary:
      'Against ctext.org our OCR reads printed classical Chinese at about 98.5% character accuracy, and against Legge our translations hold up.',
    date: '25 June 2026',
    readTime: '13 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6992c88d4f3a879124230200/346.jpg',
    imageAlt: 'Woodcut of laborers forging a large iron anchor, from the Tiangong Kaiwu (1637)',
  },
  {
    slug: 'naked-philosophers',
    title: 'The Naked Philosophers',
    subtitle:
      'In 327 BCE Alexander\'s fleet-captain was sent to sit before fifteen naked, motionless sages who would not come when the king summoned them. Nineteen centuries later a Rosicrucian alchemist enrolled those same "gymnosophists" as ancestors of his Brotherhood. How a single image (eyewitness ethnography, moral exemplar, Hermetic ancestor) travelled three thousand miles and nineteen centuries, told through eight books in the library.',
    summary:
      'The naked sages Alexander’s fleet-captain met in 327 BCE, later made ancestors of a Rosicrucian Brotherhood, followed through eight books.',
    date: '21 June 2026',
    readTime: '8 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/gallery/69c1bd308522835be8468096/69c1bd308522835be8468180-0.jpg',
    imageAlt: 'Alexander the Great gesturing toward three naked philosophers among flowering plants, a 1544 Armenian Romance of Alexander miniature',
  },
  {
    slug: 'the-giants-werent-translated',
    title: 'The Giants Were Never Fully Translated',
    subtitle:
      'The most-read book on Source Library, Robert Fludd\'s Utriusque Cosmi Historia, has never been translated into English in full. Neither have the major works of Kircher; Ficino reached English only this century. On why "first full translation" is still a meaningful claim, and what the gap really looks like.',
    summary:
      'Fludd’s Utriusque Cosmi Historia, our most-read book, has never been fully translated into English, nor have Kircher’s major works.',
    date: '21 June 2026',
    readTime: '6 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6952dac677f38f6761bc683a/98.jpg',
    imageAlt: 'The monochordum mundanum from Robert Fludd’s Utriusque Cosmi Historia, vol. 1, 1617: a hand reaching from a cloud tunes a single string stretched from earth to heaven, its intervals marked against the planets.',
    imagePosition: 'center 17%',
  },
  {
    slug: 'counting-first-translations',
    title: 'How Many First Translations, Really?',
    subtitle:
      'We badge ~5,700 books as first-ever English translations. Are they? We sent an AI research agent to independently fact-check a random sample of both the badged books and the never-assessed ones, and found the bigger error was the firsts we missed, not the ones we over-claimed. On precision, recall, Wilson intervals, and why fame (not language) predicts a false claim.',
    summary:
      'An AI agent fact-checked a sample of our ~5,700 first-translation badges. The bigger error was the firsts we missed, and fame predicts a false claim.',
    date: '19 June 2026',
    readTime: '11 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/69af0a0a4c57359b8d2d0f49/6.jpg',
    imageAlt: "Engraved frontispiece of Athanasius Kircher's Arithmologia, 1665: a radiant triangle above a sphere, two scholars below. A genuine first English translation.",
  },
  {
    slug: 'cannabis-bangue',
    title: 'Theire Soe Admirable Herbe: How the West Forgot, and Remembered, Cannabis',
    subtitle:
      'In 1689 a sea-captain set a sample of "bangue" on Robert Hooke\'s coffeehouse table, and the Royal Society met cannabis. But the plant had two lives, and the West had been forgetting one of them for two thousand years. A tour through sixty books in twelve languages, from the Shennong Bencao Jing to Baudelaire.',
    summary:
      'From Robert Hooke’s 1689 report on ‘bangue’ back to the Shennong Bencao Jing and on to Baudelaire: cannabis in sixty books and twelve languages.',
    date: '19 June 2026',
    readTime: '9 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/69ef286185daccce30f2ca01/389.jpg',
    imageAlt: "Botanical woodcut of the cannabis plant labelled 'Bangue' in Cristóvão da Costa's Tractado, 1578",
  },
  {
    slug: 'translation-collapse',
    title: 'Quality Control on Four Million Machine-Translated Pages',
    subtitle:
      'A reader found a 1589 page that the AI returned as a single word instead of a translation. Pulling the thread surfaced 25,000 more, and the two times our own measurement was wrong before the model was. On detecting "translation collapse," why long pages and looping OCR drive it, and what it takes to check a generative system at scale.',
    summary:
      'A 1589 page translated as one word led us to 25,000 more. Finding ‘translation collapse’ in four million AI-translated pages, and our own errors.',
    date: '17 June 2026',
    readTime: '7 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-building-the-tower-of-babel.jpg',
    imageAlt: 'Building the Tower of Babel, attributed to Joachim Patinir: the tower rising over a wide river landscape, a tall tree at the right.',
  },
  {
    slug: 'iiif',
    title: 'How IIIF Helped Us Translate the Renaissance',
    subtitle:
      'One image standard turned thirteen institutional archives into a single input layer for an AI pipeline, and let us hand the results back to the whole IIIF world. With diagrams of the import pipeline, the real challenges (rate limits, the datacenter problem), the workflow when there is no manifest, why provenance matters, and appreciations. Notes for a lightning talk at IIIF 2026 in Leiden.',
    summary:
      'How the IIIF standard let us import books from thirteen archives and serve our OCR and translations back. Notes for a talk at IIIF 2026 in Leiden.',
    date: '2 June 2026',
    readTime: '20 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/pages/69bd9e336120d54bd037bf37/0009.jpg',
    imageAlt: "Engraved frontispiece of Michael Maier's Atalanta Fugiens (Oppenheim, 1617), digitized by e-rara and re-hosted on Source Library",
  },
  {
    slug: 'how-big-is-the-library',
    title: 'How Big Is the Library?',
    subtitle:
      'We counted every word: original OCR, AI translation, and enrichment. Roughly five to seven billion words, about the size of English Wikipedia. With the methodology, and the recitation-loop bug that nearly tripled the count.',
    summary:
      'We counted every word: OCR, translations and enrichment. Five to seven billion, about the size of English Wikipedia, and a bug that nearly tripled it.',
    date: '1 June 2026',
    readTime: '6 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/gallery/a5d0c381-d4ea-42cd-8864-44457e7fda33/69500509f426a210d109c5bd-0.jpg',
    imageAlt: "Frontispiece of Athanasius Kircher's Ars Magna Lucis et Umbrae (1671)",
  },
  {
    slug: 'how-long-to-translate',
    title: 'How Long Would It Take to Translate the Renaissance?',
    subtitle: 'We measured the rate of new Latin translations and counted what is left. At the current pace, the Latin Renaissance alone would take about ten thousand years to finish.',
    summary:
      'We measured how fast new Latin translations appear and counted what is left. At this pace the Latin Renaissance alone would take ten thousand years.',
    date: '31 May 2026',
    readTime: '8 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-usa-national-gallery-of-art0.jpg',
    imageAlt: 'Detail of El Greco’s Saint Jerome, translator of the Vulgate: his hand on an open book beside an inkwell.',
  },
  {
    slug: 'man-his-own-maker',
    title: 'Man, His Own Maker',
    subtitle:
      "Leo XIV's encyclical on AI is, strangely, the grandchild of the first printed book the Church ever banned, Pico's Oration on the Dignity of Man. Reading them across five centuries shows what AI really forces us to decide about the soul.",
    summary:
      'Leo XIV’s encyclical on AI read beside Pico della Mirandola, whose theses Innocent VIII banned in 1487, the first printed book the Church banned.',
    date: '30 May 2026',
    readTime: '15 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/portret-van-pico-della-mirandola-painting.jpg',
    imageAlt: 'Peter Paul Rubens, Portrait of Pico della Mirandola, painted between 1612 and 1616 (Museum Plantin-Moretus, Antwerp): Pico in profile, in a red cap and a blue mantle.',
    imagePosition: 'center 32%',
  },
  {
    slug: 'does-ai-get-religion',
    title: 'Does the AI Get Religion?',
    subtitle: 'The longest page in our library is one leaf of a Javanese Bible that the AI translated into 491,418 characters of "generations of generations of generations." It only happens with scripture.',
    summary:
      'One leaf of a Javanese Old Testament that the AI translated into 491,418 characters of ‘generations of generations’. It happens only with scripture.',
    date: '30 May 2026',
    readTime: '3 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/nga-israhel-van-meckenem-ornament-with-the-tree-of-jesse.jpg',
    imageAlt: 'Israhel van Meckenem, Ornament with the Tree of Jesse (15th century): the generations from Jesse to Christ in scrolling vines.',
  },
  {
    slug: 'did-an-ai-write-the-encyclical',
    title: "Did an AI Write the Pope's AI Encyclical?",
    subtitle:
      'Magnifica Humanitas was flagged 46% AI-written, with 127 em-dashes vs zero in a comparison encyclical. We re-ran the test against eight human encyclicals. Benedict XVI used dashes 2.5× more. The smoking gun is a baseline-selection artifact.',
    summary:
      'Magnifica Humanitas was flagged 46% AI-written, with 127 em dashes as the clue. Tested against eight human encyclicals, the clue is a baseline artefact.',
    date: '30 May 2026',
    readTime: '11 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/6990505e7d19f3f2aac1e2b7/5.jpg',
    imageAlt: "Frontispiece of Athanasius Kircher's Turris Babel (1679)",
  },
  {
    slug: 'carbon-ledger',
    title: 'The Carbon Ledger of a Digital Library',
    subtitle: "Source Library has OCR'd 4.1M pages and translated almost all of them using AI. We logged every API call. ~1.8 tonnes CO₂e, about seven round-trip flights AMS↔London. Six independent estimation methods, full data + sources.",
    summary:
      'We logged every API call behind the OCR and translation of 4.1 million pages: about 1.8 tonnes CO₂e, roughly seven return flights to London.',
    date: '26 May 2026',
    readTime: '10 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/artwork/art-an-alchemist-at-his-furnace-hunched-over-bellows-plate.jpg',
    imageAlt: 'An alchemist at his furnace, hunched over bellows: a coloured print after David Teniers the Younger. A bearded man in a fur hat works the bellows beside a glowing furnace and a copper still.',
  },
  {
    slug: 'did-the-ai-read-this',
    title: 'Did the AI Read This?',
    subtitle: 'A Bayesian survey of which books in our 16,871-volume OCR\'d corpus are already in frontier-model training data. About 43% are confidently new to AI; about 21% are confidently in training.',
    summary:
      'A Bayesian survey of 16,871 OCR’d volumes: about 43% looked confidently new to AI training, 21% confidently in it. Revised in an October re-run.',
    date: '18 May 2026',
    readTime: '8 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/met-lucas-van-leyden-st-jerome-in-his-study.jpg',
    imageAlt: 'Lucas van Leyden, St. Jerome in His Study, 1521: the scholar leans on a closed book beside a skull, his lion asleep at his feet.',
    imagePosition: 'center 30%',
  },
  {
    slug: 'hogwarts-library',
    title: 'The Real Hogwarts Library',
    subtitle: 'Nicolas Flamel was real. So was Cornelius Agrippa. So was Paracelsus. The books behind the wizarding world (alchemy, bestiaries, grimoires, Kabbalah) read in modern English.',
    summary:
      'Nicolas Flamel, Cornelius Agrippa and Paracelsus were real. The alchemy, bestiaries, grimoires and Kabbalah behind Hogwarts, in modern English.',
    date: '17 May 2026',
    readTime: '16 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/699065973dc2ed39a49f1e71/2.jpg',
    imageAlt: 'Detail from the Ripley Scroll, 15th-century illustrated alchemical manuscript, Bodleian Library MS Bodl. Rolls 1',
  },
  {
    slug: 'what-makes-a-good-scan',
    title: 'What Makes a Good Scan?',
    subtitle: 'Pixel statistics, AI judgment, and the moment a model rated a blank page 95/100. Designing a per-illustration quality system for 100,000 rare-book images.',
    summary:
      'Pixel statistics, AI judgement and a model that rated a blank page 95/100: designing a quality score for each of 100,000 illustrations in rare books.',
    date: '17 May 2026',
    readTime: '9 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/695592c47bd6d2cd1d61b10b/209.jpg',
    imageAlt: 'Woodcut of Ramon Llull, labelled “Raymundus Lullus”, pelted with stones by a crowd outside a walled harbour town, above a printed table of his Art’s alphabet.',
  },
  {
    slug: 'the-deletion',
    title: 'The Deletion',
    subtitle: 'How a Claude Code session in one of my ten open terminals hard-deleted 4,758 books from our rare-books library, with the actual prompts, the actual postmortem, and what it means for running AI agents against production data.',
    summary:
      'How a Claude Code session in one of ten open terminals hard-deleted 4,758 books on 13 April 2026, with the actual prompts and the postmortem.',
    date: '15 May 2026',
    readTime: '13 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/artwork/art-a-group-of-men-at-right-pushing-philosophers-toward-a-fire-with-burning-books-at.jpg',
    imageAlt: 'Marco Dente, c. 1515: men push a group of philosophers toward a fire in which books are burning.',
  },
  {
    slug: 'confident-hallucinator',
    title: 'The Confident Hallucinator',
    subtitle: 'What we learned evaluating AI OCR across five scripts. A model can be perfectly consistent and completely wrong: 100% consistency, 0% accuracy.',
    summary:
      'AI OCR tested across five scripts and three Gemini tiers. A model can be 100% consistent and 0% accurate, and thinking mode fixes what model size cannot.',
    date: '23 April 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6956eaf4f23ebf30578dba35/221.jpg',
    imageAlt: 'Comparative table of five scripts from Agrippa’s Occult Philosophy, 1531',
  },
  {
    slug: 'tibetan-ocr',
    title: 'Benchmarking AI OCR on 232,000 Pages of Bhutanese Manuscripts',
    subtitle: 'Claude, Gemini, and the question of what "good enough" means for handwritten Tibetan. We test three models on monastery manuscripts from Gangtey, Drametse, and Tshamdrak.',
    summary:
      'Three AI models tested on handwritten Tibetan from 1,358 Bhutanese manuscripts, 232,000 pages from Gangtey, Drametse and Tshamdrak.',
    date: '23 April 2026',
    readTime: '12 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/met-unknown-mandala-of-jnanadakini.jpg',
    imageAlt: 'Mandala of Jnanadakini, Tibet, late 14th century (The Metropolitan Museum of Art): a painted palace of gates and squares inside rings of deities.',
  },
  {
    slug: 'incunabula-knowledge-graph',
    title: 'Mapping the Incunabula',
    subtitle: 'An interactive knowledge graph connecting nearly 1,000 pre-1501 printed books by author, printer, place, and subject, revealing the networks behind the printing revolution.',
    summary:
      'An interactive graph linking nearly 1,000 books printed before 1501 by author, printer, place and subject: the networks of early print.',
    date: '22 April 2026',
    readTime: '8 min read',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/artwork/art-merian-interieur-van-een-boekdrukkerij.jpg',
    imageAlt: 'Matthäus Merian, Interior of a Printing Shop (Interieur van een boekdrukkerij), engraving, 1630 (Rijksmuseum): compositors at the type cases, pressmen at two presses, stacks of printed sheets.',
  },
  {
    slug: 'interlinear-experiment',
    title: 'Facing Page vs Interlinear',
    subtitle:
      'Comparing our facing-page reader (scan and translation side by side) with interlinear display (original and translation woven line by line) for Sumerian, Akkadian, and Egyptian texts. How should the oldest literature on Earth be read?',
    summary:
      'Our facing-page reader against interlinear display, original and translation woven line by line, for Sumerian, Akkadian and Egyptian texts.',
    date: '20 April 2026',
    readTime: '8 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/artwork/met-unknown-cuneiform-tablet-late-babylonian-grammatical-text.jpg',
    imageAlt: 'Cuneiform tablet: Late Babylonian grammatical text, late 1st millennium BCE (The Metropolitan Museum of Art): a clay tablet ruled into columns of signs.',
  },
  {
    slug: 'translations-across-civilizations',
    title: 'What Ficino Heard',
    subtitle:
      'The same Hermetic vision, rendered by a Renaissance philosopher in 1481, a 17th-century English scribe, and an AI in 2026. Three translations of the Poimandres, three centuries, one text.',
    summary:
      'The Poimandres in three translations side by side: Ficino’s Latin of 1481, a 17th-century English version and an AI translation made in 2026.',
    date: '19 April 2026',
    readTime: '10 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/69938e765d28b693146d0f99/19.jpg',
    imageAlt: 'First page of the Greek text of the Pimander of Hermes Trismegistus, with an ornamental headpiece and a large decorated initial.',
  },
  {
    slug: 'cellulae',
    title: 'Cellulae',
    subtitle: 'A word on page 32 of a medieval manuscript launched modern biology. The argument on page 33 helped criminalize rape victims for eight centuries. They were written by the same man.',
    summary:
      'A word on page 32 of a Secretum Secretorum manuscript launched biology; the argument on page 33 helped criminalise rape victims for 800 years.',
    date: '16 April 2026',
    readTime: '12 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/695677fdbe7c607c5f03b2d9/717.jpg',
    imageAlt: 'Engraved plate from the Philosophical Transactions, vol. III, plate V: a branching anatomical specimen surrounded by numbered figures of instruments, shells and coins.',
  },
  {
    slug: 'singularity-1486',
    title: 'The Singularity Was Published in 1486',
    subtitle: 'Transhumanism, panpsychism, and the planetary mind, in the original Latin and German. The source code for ideas we think are modern.',
    summary:
      'Pico della Mirandola’s 1486 Oration and other old texts on unfixed human nature, panpsychism and the planetary mind, in the Latin and German.',
    date: '15 April 2026',
    readTime: '12 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/art-durer-melencolia-i-bartsch-74-gdut4008.jpg',
    imageAlt: 'Albrecht Dürer, Melencolia I, engraving, 1514: a winged figure sits brooding among a polyhedron, a sphere, tools and a sleeping dog.',
    imagePosition: 'center 40%',
  },
  {
    slug: '10000-books',
    title: '10,000 Books',
    subtitle: 'Source Library passes 10,000 translated historical texts. The symbolic 10,000th: a 1517 Renaissance encyclopedia from the BPH, in English for the first time.',
    summary:
      'Source Library passes 10,000 translated books. The 10,000th is Champier’s Four Volumes of Divine and Human Marvels (1517), first in English.',
    date: '13 April 2026',
    readTime: '5 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/artwork/woudanus1.jpg',
    imageAlt: 'The Leiden University Library in 1610, engraving after Jan Cornelisz. Woudanus: readers walking between rows of book presses labelled by subject, globes at the sides.',
    imagePosition: 'center 45%',
  },
  {
    slug: 'word-alignment',
    title: 'Reading Through the Translation',
    subtitle: 'Click any English word to see the Latin or Greek that produced it. On-demand alignment powered by Gemini embeddings.',
    summary:
      'Click any English word in a translation to see the Latin or Greek it came from, shown on Ficino’s De Voluptate. Alignment by Gemini embeddings.',
    date: '17 April 2026',
    readTime: '4 min read',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/archived/6953cc3677f38f6761be156e/383.jpg',
    imageAlt: 'Engraving of a damaged papyrus column, headed “Col. 8”, written in Greek capitals and torn by vertical cracks.',
  },
  {
    slug: 'rashi-ocr',
    title: 'The Rashi Problem: When AI OCR Hallucinates in Hebrew',
    subtitle: 'Gemini reads Arabic, Sanskrit, and Chinese fine. On Rashi script it hallucinates, and our quality metrics gave it a passing grade.',
    summary:
      'Gemini reads Arabic, Sanskrit and Chinese well, but on the Rashi script of the 1558 Cremona Zohar it invents text, and our quality metrics passed it.',
    date: '24 March 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6990630be7b7642c081de08b/8.jpg',
    imageAlt: 'Page from the Zohar, Cremona 1558 edition, showing dense Rashi script in Aramaic',
  },
  {
    slug: 'translation-rate',
    title: 'How Many Renaissance Books Get Translated Each Year?',
    subtitle: 'We queried 13,862 records from the UNESCO Index Translationum and 11 other catalogs. The answer is smaller than anyone guesses.',
    summary:
      'We searched the UNESCO Index Translationum and other catalogues to count early modern books newly put into English each year. Fewer than you would guess.',
    date: '21 March 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/69528b19ab34727b1f04f2fe/8.jpg',
    imageAlt: 'Decorated title of The Book of the Divine Consolation of the Blessed Angela da Foligno, a large initial A framing a woman reading, inside a border of leafy scrolls.',
  },
  {
    slug: 'visualizing-classification',
    title: 'Visualizing 20,000 Books Across Six Dimensions',
    subtitle: 'Four interactive D3 visualizations of our faceted classification: scatter plot, heatmap, Sankey flow, and chord diagram.',
    summary:
      'Four interactive D3 views of the six-facet classification of 20,000 books: scatter plot, heatmap, Sankey flow and chord diagram.',
    date: '16 March 2026',
    readTime: '6 min read',
    kind: 'interactive',
    image: 'https://images.sourcelibrary.org/archived/6990601f8cbcc9a4dba2c624/7.jpg',
    imageAlt: 'A tree printed in a Sanskrit book, its leaves and roots labelled in Devanagari, above two paragraphs of text.',
  },
  {
    slug: 'history-of-classification',
    title: 'Ten Thousand Years of Tagging',
    subtitle: 'From Callimachus at Alexandria to LLM-assigned faceted tags, the history of classification runs through books we actually have.',
    summary:
      'Classification through books the library holds: Callimachus, Aristotle, Porphyry, Llull, Leibniz, Linnaeus, Ranganathan and our faceted tags.',
    date: '16 March 2026',
    readTime: '20 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/pages/69773e18094afd77cbd39c0a/0021-full.jpg',
    imageAlt: 'Title page of the Catalogus von Chymischen Büchern of the Roth-Scholtz library, Nuremberg and Altdorf, 1725, with an engraved library scene.',
  },
  {
    slug: 'counting-the-gap',
    title: 'We Spent a Day Counting What Hasn\'t Been Translated',
    subtitle: 'We matched 1.6 million early modern editions against translation catalogs. It started as a quick check and turned into an all-day rabbit hole.',
    summary:
      'We matched 1.6 million early modern editions against the Library of Congress and other catalogues. The corrected share translated is under 1%.',
    date: '15 March 2026',
    readTime: '8 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/pages/697c8e0fbaa544415f85b6c6/0132-full.jpg',
    imageAlt: 'Hand-coloured plate titled “Der Baum der Erkenntnis Gutes und Böses”: a tree whose branches end in globes and circles of symbols, with German text around it.',
  },
  {
    slug: 'untranslated-renaissance',
    title: 'How Much of the Renaissance Has Been Translated?',
    subtitle: '1.4 million editions, every English translation catalog we could find. The numbers are rough, but the gap is enormous.',
    summary:
      'A first translation census: 1.4 million early modern editions matched against every English translation catalogue we found. The gap is enormous.',
    date: '15 March 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://api.digitale-sammlungen.de/iiif/image/v2/bsb11057772_00219/full/1000,/0/default.jpg',
    imageAlt: 'Engraving of a man in profile with diagrams of the sensible, imaginable and intellectual worlds connected to his head, from a page headed “De tripl. anim. in corp. vision.”',
  },
  {
    slug: 'origin-story',
    title: 'Where Source Library Came From',
    subtitle: 'One untranslated Ficino manuscript at the Embassy of the Free Mind, 5,000 books later.',
    summary:
      'How Source Library began in 2022 with Ficino’s untranslated Liber de Voluptate at the Embassy of the Free Mind, and grew to over 5,000 books.',
    date: '15 March 2026',
    readTime: '8 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/blog/ficino-bust-laptop.jpg',
    imageAlt: 'Bronze bust of Marsilio Ficino with a laptop at the Embassy of the Free Mind',
    imagePosition: 'center 30%',
  },
  {
    slug: 'hieroglyph-ocr',
    title: 'Can AI Read Hieroglyphs? (No.)',
    subtitle: 'Four approaches to hieroglyphic OCR, four failures. The Unicode block has 1,071 characters and Gemini can\'t reliably pick the right ones.',
    summary:
      'Four ways of getting Gemini 3 Flash to read hieroglyphs, from Unicode to glyph-by-glyph description, tested on Budge’s 1896 reader. All failed.',
    date: '14 March 2026',
    readTime: '12 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/met-e-harold-jones-facsimile-siptah-kv-47.jpg',
    imageAlt: 'E. Harold Jones, facsimile of a painting in the tomb of Siptah (KV 47), 1909–1910, original ca. 1188 BCE (The Metropolitan Museum of Art): a kneeling winged goddess beneath columns of hieroglyphs.',
    imagePosition: 'center 60%',
  },
  {
    slug: 'clustering',
    title: 'What Does a Library of 3,400 Rare Books Look Like?',
    subtitle: 'Embedding summaries and letting HDBSCAN find the structure. 48 clusters, six intellectual traditions, from alchemy to Sanskrit astronomy.',
    summary:
      'We embedded 3,424 book summaries and let HDBSCAN find the structure: 48 clusters, curated to 34 in seven traditions, from alchemy to Sanskrit astronomy.',
    date: '14 March 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/a5d0c381-d4ea-42cd-8864-44457e7fda33/366.jpg',
    imageAlt: "Kircher's Sciathericon chart of the fixed stars, from Ars Magna Lucis et Umbrae, 1646",
  },
  // Hidden: needs rewrite with proper import session data
  // {
  //   slug: 'autonomous-agents',
  //   title: 'How We Added 950 Books in a Weekend',
  //   subtitle: 'A human curator and three AI agents worked in parallel...',
  //   date: '9 March 2026',
  //   readTime: '12 min read',
  //   image: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/9.jpg',
  //   imageAlt: 'Page from a 16th-century manuscript showing mechanical diagrams',
  // },
  {
    slug: 'progress-studies',
    title: 'The Deeper Roots of Progress',
    subtitle: 'Mokyr, Howes, and Crawford ask why innovation happens. 5,000 newly translated books show where the experimental mindset came from.',
    summary:
      'Mokyr, Howes and Crawford ask why innovation happens. Newly translated books show experimental habits inside alchemy and natural magic.',
    date: '8 March 2026',
    readTime: '15 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/9.jpg',
    imageAlt: 'The opening of Hero of Alexandria\'s Pneumatica in a 16th-century Greek manuscript: a red interlace headpiece and initial over Greek minuscule.',
  },
  {
    slug: 'ocr-consistency',
    title: 'How Consistent Is AI OCR?',
    subtitle: 'A digitization error gave us 1,448 natural experiments: two photos of the same page, OCR\'d independently. Median disagreement: 1.8%.',
    summary:
      'A scanning error left 1,448 pages photographed more than once. OCR’d independently, the copies differ by a median 1.8% across six languages.',
    date: '7 March 2026',
    readTime: '12 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/artwork/art-sadeler-fabel-van-de-hond-en-zijn-spiegelbeeld.jpg',
    imageAlt: 'Aegidius Sadeler, The Dog and Its Reflection (Fabel van de hond en zijn spiegelbeeld), print, 1608 (Rijksmuseum): a dog with a piece of meat in its mouth looks down at its reflection in a stream.',
    imagePosition: 'center 70%',
  },
  {
    slug: 'cuneiform-ocr',
    title: 'Can AI Read Cuneiform?',
    subtitle: 'Gemini identified the Code of Hammurabi and caught a 2,500-year-old forgery. It also hallucinated an entire document.',
    summary:
      'Gemini named Law 196 of the Code of Hammurabi and spotted a 2,500-year-old forgery, then invented a Sumerian document. AI on cuneiform tablets.',
    date: '7 March 2026',
    readTime: '20 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/blog/cuneiform/P464358_d-sBPv8Z5dT88Vwi9ZcuAMnSz4nYflrw.jpg',
    imageAlt: 'Code of Hammurabi stele detail showing cuneiform inscription, ca. 1750 BCE',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'A mathematical board game played for six centuries. You capture by arithmetic and win by creating harmony.',
    summary:
      'Rithmomachia, the board game where you capture by arithmetic and win by harmony, from five treatises of 1496 to 1616, all now in English.',
    date: '2 March 2026',
    readTime: '18 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/498.jpg',
    imageAlt: 'Copperplate engraving of a Rithmomachia game board from Selenus, Das Schach- oder König-Spiel, 1616',
  },
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside spell books and alchemy. One 16th-century manuscript binds Hero\'s steam engines with the Corpus Hermeticum.',
    summary:
      'Before engineering was a discipline it lived in books of magic and alchemy. One manuscript binds Hero’s steam engines with the Corpus Hermeticum.',
    date: '27 February 2026',
    readTime: '22 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/695230c6ab34727b1f044784/93.jpg',
    imageAlt: 'Page from a 16th-century Greek manuscript showing Hero of Alexandria\'s Aeolipile diagram',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone?",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb. Eight primary sources, eight different answers.',
    summary:
      'Eight sources, eight answers on the Philosopher’s Stone: Lambspringk’s emblems, Ali Puli’s salt of nature, and Edward Kelly’s red powder.',
    date: '27 February 2026',
    readTime: '20 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/lambspring-de-lapide-philosophico-1625-stag-and-unicorn.jpg',
    imageAlt: 'A stag and a unicorn facing each other in a forest: an emblem from Lambspringk’s De lapide philosophico, Frankfurt 1625.',
    imagePosition: 'center 55%',
  },
  {
    slug: 'first-translation-methodology',
    title: 'How We Identify First Translations',
    subtitle: 'AI enrichment, bibliographic heuristics, six-level status system, and the limitations we know about.',
    summary:
      'How we decide a book has never been translated into English: AI enrichment, bibliographic heuristics, a six-level status system and known limits.',
    date: '23 February 2026',
    readTime: '10 min read',
    kind: 'research',
    image: 'https://images.sourcelibrary.org/archived/6952587bab34727b1f045546/3.jpg',
    imageAlt: 'Title page of Symbola Aureae Mensae by Michael Maier, with twelve alchemist portrait medallions, 1617',
  },
  {
    slug: 'astrological-diagrams',
    title: 'Astrological Diagrams from Nine Centuries',
    subtitle: 'From the 10th-century Dunhuang Star Chart to Kepler\'s cosmic harmonics.',
    summary:
      'Astrological diagrams in the library, from the 10th-century Dunhuang Star Chart to Kepler’s cosmic harmonics, in Greek, Latin, Arabic and Chinese.',
    date: '22 February 2026',
    readTime: '15 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/694b3b5b58a47807cc735dce/34.jpg',
    imageAlt: "The heliocentric diagram of the planetary spheres from Copernicus's De Revolutionibus, 1543",
  },
  {
    slug: 'demonology',
    title: 'What Are Demons? Five Answers from the Primary Sources',
    subtitle: 'The Hermetic daemon is your cosmic guardian. The Christian demon is a fallen angel. The same word, reversed.',
    summary:
      'What a demon is, from the primary sources: the Greek daimōn, the Hermetic guardian, the Islamic jinn and the Christian fallen angel.',
    date: '21 February 2026',
    readTime: '18 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/6953b56577f38f6761bd979d/62.jpg',
    imageAlt: 'Illustration of a jinn from the Book of Wonders, 14th century',
  },
  {
    slug: 'history-of-astrology',
    title: 'A History of Astrology Across Traditions',
    subtitle: 'Babylonian omen tablets to Kepler\'s geometrical cosmos, independently across five civilizations.',
    summary:
      'Astrology from Babylonian omen tablets to Kepler’s geometric cosmos, in Greek, Indian, Arabic, Chinese and European texts the library holds.',
    date: '21 February 2026',
    readTime: '22 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/699068948034a3640265b709/311.jpg',
    imageAlt: 'Zodiac Man (Homo Signorum) from a medieval astrological manuscript',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Lab manuals, radical theology, women alchemists, Sanskrit astrology, founding texts of biblical criticism. Never before in English.',
    summary:
      'Nearly 2,000 books here had never been in English: lab manuals, radical theology, women alchemists, Sanskrit astrology, early biblical criticism.',
    date: '20 February 2026',
    readTime: '20 min read',
    kind: 'tours',
    image: 'https://images.sourcelibrary.org/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
    imageAlt: 'Frontispiece of Kircher\'s Oedipus Aegyptiacus, 1653',
  },
  {
    slug: 'mcp-server',
    title: 'Claude Can Now Read Thousands of Rare Books',
    subtitle: 'An MCP server giving Claude direct access to Source Library: historical texts, translations, entity graph, and 90,000+ illustrations.',
    summary:
      'An MCP server that gives Claude direct access to Source Library’s texts, translations, entity graph and illustrations. One command, no API key.',
    date: '18 February 2026',
    readTime: '8 min read',
    kind: 'library',
    image: 'https://images.sourcelibrary.org/archived/699065973dc2ed39a49f1e71/5.jpg',
    imageAlt: 'The red and green lions beneath the radiant sun, from the Ripley Scroll, Bodleian Library, c. 1450',
  },
  {
    slug: 'fire-horse',
    title: 'The Year of the Fire Horse',
    subtitle: 'Double yang fire, a 17th-century arsonist, and the original texts behind Chinese astrology.',
    summary:
      '2026 is the Year of the Fire Horse, yang fire on yang fire. The Chinese texts behind the cycle, and why Japan’s birth rate fell in 1966.',
    date: '17 February 2026',
    readTime: '16 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/6992cac0d4d545ae73feea71/6.jpg',
    imageAlt: 'He Tu (River Map) diagram from Chinese cosmological tradition',
  },
  {
    slug: 'indigenous-traditions',
    title: 'The Sacred Texts That Were Never \'Texts\'',
    subtitle: '90+ volumes: Navajo ceremonies, Yoruba cosmology, Celtic place-lore, Norse Eddas. Every inhabited continent.',
    summary:
      'Over 90 volumes on indigenous traditions from every inhabited continent: Navajo ceremonies, Yoruba cosmology, Celtic place-lore, the Eddas.',
    date: '16 February 2026',
    readTime: '18 min read',
    kind: 'tours',
    image: 'https://archive.org/download/gri_33125009545621/page/n23/full/pct:50/0/default.jpg',
    imageAlt: 'Weighing of the Heart scene from the Book of the Dead, Papyrus of Ani, British Museum, c. 1250 BCE',
  },
  {
    slug: 'fechner-bohme',
    title: 'The Mystic Who Invented Psychophysics',
    subtitle: 'Fechner founded experimental psychology. His real goal was proving the universe has a soul.',
    summary:
      'Gustav Fechner founded experimental psychology to prove the universe has a soul. Seventeen volumes of his German show the Böhme behind his law.',
    date: '16 February 2026',
    readTime: '15 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/archived/6867c580aadfee9e955eca92/4.jpg',
    imageAlt: 'Title page of Aurora by Jakob Bohme, with cosmic diagram and Fraktur typography',
  },
  {
    slug: 'invisible-hand',
    title: 'The Invisible Hand Has a History',
    subtitle: 'Before Adam Smith: Florentine merchants, Salamanca theologians, Cambridge Platonists.',
    summary:
      'The invisible hand before Adam Smith: Aristotle, Florentine merchants, Salamanca theologians and Cambridge Platonists, in original editions.',
    date: '15 February 2026',
    readTime: '20 min read',
    kind: 'stories',
    image: 'https://images.sourcelibrary.org/artwork/met-petrus-christus-a-goldsmith-in-his-shop.jpg',
    imageAlt: 'Petrus Christus, A Goldsmith in his Shop, 1449 (The Metropolitan Museum of Art): a goldsmith in red holds a small balance while a couple stands beside him; jewels and vessels on the shelves.',
    imagePosition: 'center 40%',
  },
  {
    slug: 'chakra-tradition',
    title: 'Recovering the Chakra Tradition',
    subtitle: 'The primary tantric sources on chakras, nadis, and kundalini. Many translated for the first time.',
    summary:
      'The Sanskrit tantric sources on chakras, nadis and kundalini, several never before in a Western language, from the Internet Archive and Wellcome.',
    date: '15 February 2026',
    readTime: '12 min read',
    kind: 'tours',
    image: 'https://iiif.wellcomecollection.org/image/b33599051_0001.jp2/full/1000,/0/default.jpg',
    imageAlt: 'Chakra diagram from the Shaiva tantric tradition, Wellcome Collection',
  },
];
