/**
 * Copy and examples for /about/meaning (#6201).
 *
 * Every number here comes from a dated test in scripts/eval/experiments/ and
 * carries its link. Every quotation is a verbatim substring of the page's
 * stored translation (checked 2026-10-07); if a page is re-translated, re-check
 * the quote before changing anything else.
 */
const BLOB = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
const EXP = `${BLOB}scripts/eval/experiments/`;

/** The numbers below were measured on this date. */
export const MEASURED_ON = '7 October 2026';

export const EVIDENCE = {
  untranslated: `${EXP}2026-10-07-orig-lang-embedding-recall-5729.md`,
  traditions: `${EXP}2026-10-07-embedding-granularity-cross-tradition.md`,
  rerank: `${EXP}2026-10-07-tradition-diversity-rerank.md`,
  prototypes: `${EXP}2026-10-07-meaning-prototypes-6201.md`,
  models: `${EXP}2026-10-07-embedding-models-qwen3-dual.md`,
  opportunities: `${BLOB}.claude/docs/embeddings-opportunities.md`,
  howItWorks: `${BLOB}.claude/docs/embeddings.md`,
} as const;

/** A bounded copy of a page image, through the same proxy the reader uses. */
const sized = (url: string, w: number) => `/api/image?url=${encodeURIComponent(url)}&w=${w}&q=80`;

export const PICTURE_EXAMPLE = {
  picture: {
    src: sized('https://images.sourcelibrary.org/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f0441a4-0.jpg', 800),
    width: 1506,
    height: 1346,
    alt: 'A hand-coloured engraving. A man in a fur hat holds a large pair of compasses against a brick wall. On the wall he has drawn a circle around a triangle, the triangle around a square, and the square around a small circle with a naked man and woman inside it.',
    caption: 'Michael Maier, Atalanta fugiens (Oppenheim, 1618), emblem 21. Bibliothèque nationale de France.',
    href: '/book/atalanta-fleeing-new-chemical-emblems-of-the-secrets-of-maier/page/69520c46ab34727b1f0441a4',
  },
  page: {
    src: sized('https://images.sourcelibrary.org/archived/86fe639a-5f3d-4e9e-9d99-128742a10809/84.jpg', 800),
    width: 3831,
    height: 5561,
    alt: 'A page of seventeenth-century English handwriting in brown ink, headed "Discourse 21" and numbered 70. There is no picture on it.',
    caption: 'An English manuscript translation of the same book, about 1625, page 70. Yale, Beinecke Library, Mellon MS 48.',
    href: '/book/atalanta-fugiens-c-1625-english-ms-translator/page/695004edf426a210d109aa56',
    quote: 'If geometry is so natural and easy for children, how does it come to pass that the "squaring of a circle" was not known to Plato himself?',
  },
} as const;

export const IDEA_EXAMPLE = {
  start: {
    who: 'Plato, Republic, book 10 (Greek, Oxford 1894)',
    where: 'Greece, 4th century BCE',
    quote: 'He saw then, in this way, the souls departing through each opening of both heaven and earth after they had been judged',
    href: '/book/platos-republic-greek-text-plato/page/69937706b0a84a576396299a',
  },
  found: [
    {
      who: 'Daqāʾiq al-ḥaqāʾiq (Arabic manuscript, Leiden Or. 7008)',
      where: 'Islamic',
      quote: 'the angels of mercy raise them to the fourth heaven with honor and exaltation',
      href: '/book/daqaiq-al-haqaiq-or-7008/page/6a2032a118654bf8e1903319',
    },
    {
      who: 'Brahma Purana (Sanskrit, printed in Bombay)',
      where: 'Hindu',
      quote: 'Joined with Adharma, he goes to the realm of Yama.',
      href: '/book/brahma-purana-press/page/69d395ffbc23f0b82634a51c',
    },
    {
      who: 'The Vision of Tundale (German, printed 1476 with the Dialogues of Gregory the Great)',
      where: 'Christian',
      quote: 'they saw a green field that smelled sweetly and was full of beautiful flowers, and it was wonderfully clear and bright.',
      href: '/book/dialogorum-libri-quattuor-german-das-buch-der-zweyer-red-mit-gregorius-i/page/69dbca1d1040d1d5e20a9887',
    },
  ],
} as const;

export type Row = { title: string; body: string; href?: string; link?: string };

export const LIVE: Row[] = [
  { title: 'Search', body: 'Type a question or a description. Results include pages that say the same thing in other words, beside pages that contain your words.', href: '/search', link: 'Search the library' },
  { title: 'Search inside one book', body: 'The same, limited to the book you are reading.' },
  { title: 'The Librarian', body: 'An assistant that looks up passages and answers with quotations and page links.', href: '/librarian', link: 'Ask the Librarian' },
  { title: 'Pictures', body: 'Describe a picture in words, or pick one and see pictures that look like it.', href: '/gallery', link: 'Open the gallery' },
  { title: 'For AI assistants', body: 'Any assistant that speaks the MCP protocol can search the library and quote pages with their links.', href: '/developers', link: 'Developer notes' },
];

export type Gap = { title: string; body: string; evidence: string; more?: { href: string; link: string } };

export const GAPS: Gap[] = [
  {
    title: 'Pages we have not translated are hard to find in English.',
    body: 'We wrote 40 questions in English whose answer is on a Latin, German, French or Chinese page with no translation. Search put the right page in its first ten results for 4 of them. The page’s numbers were sound: searched apart from the translated pages, they found 18 of 28. Translated pages crowd the others out. A separate index for untranslated pages is being built.',
    evidence: EVIDENCE.untranslated,
  },
  {
    title: 'A search for an idea mostly returns one tradition.',
    body: 'For 25 ideas that several traditions wrote about, the first ten results held relevant passages from 1.88 traditions on average, and from one or none for 10 of the 25. That is after search began spreading its results across traditions on 7 October; before, it was 1.68 and 15. Counting every passage, relevant or not, the first ten now come from 4.16 groups of traditions. Each tradition has its own vocabulary, and the numbers follow the vocabulary. Describing each page in two plain sentences first, and searching those, raised the average to 2.8.',
    evidence: EVIDENCE.traditions,
    more: { href: EVIDENCE.rerank, link: 'The test of the spread' },
  },
  {
    title: 'One page cannot yet suggest its own parallels.',
    body: 'We took 25 pages and asked for the nearest page in each other tradition. A reader who did not know how the pages were chosen judged 13 of 75 suggestions to be about the same idea. That is too few to show on a page, so we do not.',
    evidence: EVIDENCE.prototypes,
  },
  {
    title: 'Some stored numbers are out of date.',
    body: 'In a sample of 10,888 pages, 16 in 100 had numbers that no longer matched the page’s current text. They are being found and refreshed.',
    evidence: EVIDENCE.models,
  },
];

export type Plan = { title: string; body: string; status: 'tested' | 'planned' };

export const PLANS: Plan[] = [
  { title: 'A page for each idea', status: 'tested', body: 'One page that gathers what Greek, Hebrew, Arabic, Sanskrit, Chinese, Tibetan and Latin sources say about the same idea, each passage quoted and linked, each one checked by a reader before it appears.' },
  { title: 'From a picture to its text', status: 'tested', body: 'Every emblem and plate linked to the page that explains it, and every such page linked back to the picture.' },
  { title: 'An open test set', status: 'planned', body: 'Our questions and their checked answers, published so that anyone can test a search system on old books in several languages. The standard collections of such tests have none for historical texts.' },
  { title: 'Translating what readers look for', status: 'planned', body: 'Counting which untranslated books searches keep reaching, and translating those first.' },
  { title: 'The same passage in another book', status: 'planned', body: 'Finding where one text quotes, translates or borrows from another, across languages.' },
];
