// The hand-written parts of /quality (#5918). Everything else on the page is read from data
// files at build time. Change the date below whenever you edit this file or page.tsx's prose:
// scripts/audit/quality-center-freshness.mjs fails, and the weekly quality-center-watch
// workflow files an issue, once this date is more than 30 days older than the newest
// experiment write-up in scripts/eval/experiments/.

/** ISO date the prose on /quality was last checked against the data. */
export const PROSE_AS_OF = '2026-10-06';

/**
 * The leaf the page opens on (#5918 design direction): a real page whose margins hold a later
 * reader's notes. Chosen by eye from three candidates posted on #5918; Derek picks the final one.
 * Crop boxes are in pixels of `image` (1000 × 1565) and were checked by eye.
 */
export const LEAF = {
  bookId: '6952b0fb77f38f6761bc28b7',
  page: 272,
  title: 'Angelo Poliziano, Omnium operum tomus prior',
  date: '1519',
  image: 'https://images.sourcelibrary.org/archived/6952b0fb77f38f6761bc28b7/272.jpg',
  width: 1000,
  height: 1565,
  alt: 'A printed folio page of Latin commentary with a woodcut initial A. A reader has written notes in ink in the left margin and a full line at the foot of the page, and underlined words in the text.',
  /** The end of one printed line: the worked example of a check. */
  line: { x: 630, y: 185, w: 370, h: 17 },
  /** The reader's line at the foot of the page. */
  note: { x: 10, y: 1330, w: 680, h: 110 },
  /** Blank paper beside it: where a reader's note on our page would go. */
  margin: { x: 660, y: 1310, w: 280, h: 240 },
} as const;

export const leafHref = `/book/${LEAF.bookId}?page=${LEAF.page}`;

export type Door = { label: string; href: string };

export type Way = {
  name: string;
  what: string;
  leaves: string;
  door: Door | null;
  /** true when the way is not built yet; it is listed so nobody has to guess. */
  planned?: boolean;
};

export const WAYS: Way[] = [
  {
    name: 'Report a problem on a page',
    what: 'Use the Feedback button at the foot of any page, including every page of every book. Say what looks wrong.',
    leaves: 'A note tied to that page. Someone checks it against the page image, then fixes the page or files a public issue.',
    door: null,
  },
  {
    name: 'Check pages',
    what: 'Short review queues. In the translation check you read a page in a language you know and say whether our English says what the original says, and whether the transcription is right.',
    leaves: 'An answer stored with that page. Answers from readers of the language are how we will learn how far our model judges agree with people.',
    door: { label: 'Check pages', href: '/review' },
  },
  {
    name: 'Correct a page',
    what: 'Editors fix a transcription or a translation directly in the reader. Ask for editing access.',
    leaves: 'A corrected page. The earlier text is kept as a revision, so every change can be traced and undone.',
    door: { label: 'Ways to contribute', href: '/contribute' },
  },
  {
    name: 'Introduce yourself',
    what: 'After you sign in, a short form asks which languages you read and what you would like to help with. Everything is optional.',
    leaves: 'A record of who reads what, so we can ask the right person about a page.',
    door: { label: 'Introduce yourself', href: '/welcome' },
  },
  {
    name: 'Paid review rounds',
    what: 'For some collections we need specialists to read a defined sample, for example Tibetan scholars reading the Tengyur draft. These rounds are paid and planned one at a time.',
    leaves: 'A judged sample, published with its method, like the experiments listed above.',
    door: { label: 'team@sourcelibrary.org', href: 'mailto:team@sourcelibrary.org?subject=Paid%20review%20round' },
  },
  {
    name: 'Reading groups',
    what: 'Read one book together, closely. Write to us with the book and the group.',
    leaves: 'Close reading of one text. What the group finds comes back through the Feedback button or as corrections.',
    door: { label: 'Propose a group', href: 'mailto:team@sourcelibrary.org?subject=Study%20group%20idea' },
  },
  {
    name: 'Your own project',
    what: 'Use the texts in your own research, teaching or software, through the site or the public API.',
    leaves: 'Your work, citing the pages it uses. Tell us about it at team@sourcelibrary.org.',
    door: { label: 'For developers', href: '/developers' },
  },
  {
    name: 'Highlight and comment',
    what: 'Select a passage in the reader and attach a note that other readers can see.',
    leaves: 'A note anchored to the words it is about.',
    door: null,
    planned: true,
  },
  {
    name: 'Signed notes and a “reviewed by” credit',
    what: 'A reviewer’s name shown on the pages they checked, and notes signed by the person who wrote them.',
    leaves: 'Public credit, and a page a reader can trust because they can see who checked it.',
    door: null,
    planned: true,
  },
  {
    name: 'Review on a recorded call',
    what: 'A specialist reads pages with us on a video call, and the recording is kept with the review.',
    leaves: 'A review that others can watch and check.',
    door: null,
    planned: true,
  },
];

/**
 * One error and its fix, worked end to end (#5918, Derek 2026-10-06: "a great example of a type of
 * error and a type of fix"). Every figure is copied from the write-up in `writeup`; change them only
 * together with it. Taxonomy classes: O7 (sub-variant) and O18 in .claude/docs/page-error-taxonomy.md.
 */
export const WORKED_FIX = {
  issue: 4686,
  title: 'Numbers read as letters, on pages that were blank',
  writeup: 'scripts/eval/experiments/2026-10-06-glm-digit-repair-4686.md',
  example: { href: '/book/6ac2798d02c7f994f8506911?page=287', label: 'Birch, History of the Royal Society, 1756, vol. II, page 287' },
  saw: 'Our usual transcription engine refuses to read pages of famous published texts. It returns nothing at all, so 715 pages of the Philosophical Transactions (1669–78) and of Birch’s History of the Royal Society (1756) show a scan and no text.',
  line: { scan: 'whoſe angle is about 66 or 67 degrees', before: 'whoſe angle is about cé or éy degrees', after: 'whoſe angle is about 66 or 67 degrees' },
  measured: 'A free engine with no refusal, Kraken, read 20 of these pages, drawn before the test. Each was checked against a careful transcription of the same scan. The letters came out very well, with 0.9% of characters wrong. The numbers did not: 17th-century type sets figures that hang below the line, and Kraken read them as letters. Only 79% of printed numbers came out right, against a bar of 90% set before the test.',
  fix: 'Keep Kraken’s letters, and take only the numbers from a second engine that reads figures as figures (GLM-OCR), wherever the two readings line up word for word.',
  after: 'On the same 20 pages, 89% of printed numbers were right (83 of 93), and 96% in the body text, with no extra errors in the letters. That is one number short of the bar. The numbers still missed are in the running heads: dates printed one above the other, and page numbers the second engine leaves out. So the pages have not been filled yet, and the next step is decided in the open on the issue.',
} as const;
