// The open quality work listed on /research/quality/open. Each row is a GitHub issue; the issue is the
// current record and this list is a dated snapshot of it (AS_OF). Update a row when its issue moves,
// and the date with it. Figures are copied from the issue or the merged write-up it links.

export const AS_OF = '6 October 2026';

export type Status = 'running' | 'defect' | 'planned';

export type OpenIssue = {
  /** GitHub issue number in Embassy-of-the-Free-Mind/sourcelibrary-v2 */
  n: number;
  title: string;
  detail: string;
  status: Status;
  /** an optional reader page that shows the problem */
  example?: { href: string; label: string };
};

export type IssueGroup = { id: string; title: string; intro?: string; issues: OpenIssue[] };

export const GROUPS: IssueGroup[] = [
  {
    id: 'wrong-text',
    title: 'The reader sees the wrong text',
    intro: 'Nothing on the page tells the reader about these errors, so they come first.',
    issues: [
      {
        n: 5803,
        title: 'Text shifted one page against its image in about 1% of books',
        detail: 'A screen of 41,096 books found 151 clean one-page shifts. Five pages in the reference study carry the English of another page.',
        status: 'defect',
        example: { href: '/book/69b2ffad5545150b61b4901a?page=389', label: 'Boyle 1667, p. 389' },
      },
      {
        n: 5699,
        title: 'Right-to-left and bilingual books stored in reverse page order',
        detail: 'The translator’s context from the previous page then comes from the wrong page.',
        status: 'defect',
      },
      {
        n: 5902,
        title: 'Model-written definitions read as the book’s own text',
        detail: 'On 5.9% of pages a definition sits inside a term tag, and with notes switched off it becomes body text. On 34% of pages a model gloss is labelled as a gloss printed in the original.',
        status: 'defect',
        example: { href: '/book/6975158aa88d83c830d99e22?page=83', label: 'example page' },
      },
      {
        n: 5103,
        title: 'Page breaks are a fidelity hotspot',
        detail: 'Catchwords and words split across a page break failed at 10 of 12 breaks checked.',
        status: 'defect',
      },
      {
        n: 5842,
        title: 'Old links to split pages land on the wrong leaf',
        detail: 'A link to a two-page spread that has since been split should open its first leaf, not the book’s first page.',
        status: 'defect',
      },
    ],
  },
  {
    id: 'ocr',
    title: 'Transcription',
    intro: 'Most of the worst pages start with a misread. The English that follows can be fluent and still wrong.',
    issues: [
      {
        n: 5813,
        title: 'Re-reading Greek print that the cheaper engine transcribed',
        detail: 'A 200-page pilot read printed Greek better on 9 of 15 pages checked by eye and worse on none. On manuscripts the engine invented text, so manuscripts are left out. The printed pages are being re-read now, and only pages whose text changed are retranslated.',
        status: 'running',
      },
      {
        n: 5575,
        title: 'Greek is the largest weighted gap',
        detail: 'About a tenth of translated pages. Greek manuscripts score 2.5 of 5 against published translations, and no re-read with the current engines rescues them. Fitting an open edition of the same text is being tried instead (#5619).',
        status: 'running',
      },
      {
        n: 5686,
        title: 'A fixed test set for transcription prompts',
        detail: 'About 40 pages every candidate prompt must pass before it is compared with the current one.',
        status: 'planned',
      },
      {
        n: 5313,
        title: 'A garbled-page detector',
        detail: 'A cheap per-page score so the reader’s warning reaches garbled pages the transcription did not flag.',
        status: 'planned',
      },
      {
        n: 5730,
        title: 'Our own transcription models, trained on pages already corrected',
        detail: 'Latin long-s, Tibetan, Syriac, Persian and Chinese.',
        status: 'planned',
      },
      {
        n: 4735,
        title: 'A standing benchmark for each script',
        detail: 'One page per book, anchored to a known edition where possible, with a public leaderboard.',
        status: 'planned',
      },
    ],
  },
  {
    id: 'translation',
    title: 'Translation and notes',
    issues: [
      {
        n: 5700,
        title: 'Reversed meaning cannot yet be screened across the library',
        detail: 'Latin shows 11 reversed statements per 100 pages, most of them double negatives. Three detectors that work without a published translation all failed (#5748). Only the strongest model catches these reliably.',
        status: 'defect',
      },
      {
        n: 5700,
        title: 'Notes that cite an “original” the page does not contain',
        detail: 'About 173,000 pages. An automatic cleanup failed its precision check when read by eye, so it was not applied.',
        status: 'defect',
      },
      {
        n: 5698,
        title: 'Notes as a typed apparatus',
        detail: 'The book’s own notes, our clarifications, added context and quoted originals kept apart, each of which a reader can switch on or off.',
        status: 'running',
      },
      {
        n: 5647,
        title: 'Checking the facts our notes add',
        detail: 'Names, dates and identifications. Claims are first checked against reference tables, and the rest are verified by a model. See also #5624.',
        status: 'planned',
      },
    ],
  },
  {
    id: 'tengyur',
    title: 'The Tibetan Tengyur',
    issues: [
      {
        n: 5829,
        title: 'The stored draft on a random sample of 150 pages',
        detail: 'Reviewers judged 75% of pages to need only light editing, 23% real work and 1% a specialist. They found about 38 reversed statements or wrong agents per 100 pages. Pramāṇa is the weakest section. The reviewers were AI models, not people.',
        status: 'running',
      },
      {
        n: 5797,
        title: 'The weak sections, read by eye',
        detail: 'The 84000 reference covers 8 texts, none from Madhyamaka or Pramāṇa, so those sections need another check.',
        status: 'running',
      },
    ],
  },
  {
    id: 'measurement',
    title: 'Measurement and publication',
    issues: [
      {
        n: 5873,
        title: 'More reference pages for the languages that switched engines',
        detail: 'Persian, Hebrew, Arabic, Pali, Chinese and Sanskrit are being topped up to 30 books each, so the decision to translate them on the stronger engine rests on enough pages.',
        status: 'running',
      },
      {
        n: 5406,
        title: 'Readers of the source languages check the judges',
        detail: 'Volunteers re-judge 50 pages the model judges already scored. This is the only way to learn how far the judges agree with people. It awaits an ethics approval.',
        status: 'planned',
      },
      {
        n: 5762,
        title: 'The human ceiling',
        detail: 'How far two published translators, or two human transcribers, differ on our own scales. The first figures are in the paper.',
        status: 'running',
      },
      {
        n: 5531,
        title: 'A downloadable quality dataset',
        detail: 'One bundle behind the paper, split by licence, deposited on Zenodo.',
        status: 'planned',
      },
      {
        n: 5576,
        title: 'What an error rate looks like',
        detail: 'Real pages at 0.5, 2, 5, 10 and 20% character error, with what each level still lets a reader do.',
        status: 'planned',
      },
      {
        n: 4920,
        title: 'Review queues that produce a dataset',
        detail: 'Gold items, three votes each, and one use for the result.',
        status: 'planned',
      },
    ],
  },
];

/** Changes already in production that came out of the October 2026 measurements. */
export const SHIPPED: { pr: number; text: string }[] = [
  { pr: 5740, text: 'Greek, Hebrew, Arabic, Persian, Sanskrit, Pali and Chinese are translated on the stronger engine (Flash) instead of Flash-Lite.' },
  { pr: 5761, text: 'Greek manuscripts, Greek print before 1600 and Latin incunabula are not translated until their transcription is redone.' },
  { pr: 5767, text: '277,832 translated pages cleaned: decorative-initial notes moved to the page-information panel and broken markup repaired, with a revision kept for every page.' },
  { pr: 5877, text: 'A written rule for how much evidence is enough before changing an engine, spending on re-reading, changing a prompt or adding a gate.' },
];
