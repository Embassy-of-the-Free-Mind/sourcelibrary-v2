/**
 * Data for /admin/page-cleanup: the page check of sourcelibrary.org run on 17 October 2026
 * (every page route on main, loaded as raw HTML and in Chrome) and the cleanup plan that followed.
 *
 * TRIAGE and NUMBERS are the check's findings as written. STEPS is the plan's order of work:
 * update a step's `status` and `prs` when its pull request opens or merges. Visitor counts are
 * human visitors over the 90 days before the check (analytics_pageviews, bots removed).
 */

export type Action = 'archive' | 'internal' | 'draft' | 'merge' | 'fix' | 'link';

/** [page, action, where it goes or what it becomes, why, visitors in 90 days (null = not measured)] */
export type TriageRow = [string, Action, string, string, number | null];

/** [where it shows, file, what it says, note] */
export type NumberRow = [string, string, string, string];

export const TRIAGE: TriageRow[] = [
  // Archive: public visitors are sent to the successor, the team can still open the page
  ['/about/by-the-numbers', 'archive', '/about/progress', 'Frozen May snapshot; Progress is the live version.', 0],
  ['/beta', 'archive', '/auth/signin', 'Old early-access sign-up with 10,000-book copy.', 0],
  ['/roadmap', 'archive', '/about', 'Blank.', 0],
  ['/collection-areas', 'archive', '/collections', 'Third way of grouping books by theme; orphaned.', 0],
  ['/categories and its 29 pages', 'archive', 'a matching collection (or a mapped one), else /browse/subjects', 'Orphaned, 15 to 24 seconds to load, duplicates collections. 9 of the 29 slugs exist as collections already; the other 20 need a mapping (hermeticism → hermetica and so on).', 11],
  ['/taxonomy', 'archive', '/browse/subjects', 'Stuck on "Loading taxonomy…", already noindex.', 0],
  ['/topics, /topics/clusters', 'archive', '/browse/subjects', 'Orphaned; only a quarter of books are tagged.', 0],
  ['/data', 'archive', '/about/progress', 'Third stats page; disagrees with the others (231 languages).', 4],
  ['/research/translation-gap', 'archive', '/census', 'Same tables as the census.', 5],
  ['/research/image-pixplot', 'archive', '/research/atlas', 'Second view of the same 35,532-image sample.', 0],
  ['/search/visual', 'archive', '/identify', 'Image search; /identify does this and has 310 visitors.', 0],
  ['/hieroglyphs', 'archive', '/blog/hieroglyph-ocr', 'Shows 0 pages; the data is gone.', 0],
  ['/tablets', 'archive', '/blog/cuneiform-ocr', 'Shows 0 tablets; the data is gone.', 1],
  ['/learn', 'archive', '/', 'Orphaned vocabulary quiz, no visitors.', 0],
  ['/volunteers', 'archive', '/contribute/volunteer', 'Second volunteer welcome page.', 0],
  ['/blog/2000-first-translations', 'archive', '/blog/counting-first-translations', 'posts.ts already marks it superseded.', null],
  ['/blog/worlds-largest-collection', 'archive', '/blog/how-big-is-the-library', 'posts.ts already marks it superseded.', null],
  ['/blog/autonomous-agents', 'archive', '/blog', 'posts.ts marks it withdrawn.', null],
  ['/book/[id]/page/[pageId]/v2a, v2c', 'archive', 'the normal reader', 'Old reader prototypes still routable.', null],
  ['/book/[id]/preview', 'archive', '/book/[id]', 'Returns 404 already.', null],
  ['/book/[id]/summary', 'archive', '/book/[id]/guide', 'Already redirects; only the file is left.', null],
  ['/timeline, /design-options', 'archive', 'existing redirects', 'Already redirected; only the files are left.', 0],
  ['/press/trouw-interview-english', 'fix', 'a new page under /press-releases', 'Move it so it can be seen; a redirect swallows it today.', 0],

  // Internal: team only, same URL
  ['/processing', 'internal', '', 'Pipeline dashboard.', 0],
  ['/qa', 'internal', '', 'QA sampling tool; empty when signed out.', 0],
  ['/upload', 'internal', '', 'Upload form.', 0],
  ['/about/sources', 'internal', '', 'Import tracker with developer notes.', 15],
  ['/brand, /brand/mockups', 'internal', '', 'Brand guide and mockups.', 15],
  ['/specimen/aldine', 'internal', '', 'Type specimen.', 7],
  ['/research/sessions', 'internal', '', 'Internal notes.', 0],
  ['/research/ocr-diff, /research/ocr-heatmap, /research/thumbnail-compare', 'internal', '', 'Engineering views.', 0],
  ['/research/image-atlas', 'internal', '', 'Sample image map; keep /research/atlas public.', 0],
  ['/review/spanish-copy', 'internal', '', 'Spanish copy review for the team.', 7],
  ['/gallery/review, /gallery/curate', 'internal', '', 'Curation queues.', 0],
  ['/feedback', 'internal', '', 'Feedback inbox; empty when signed out.', 41],
  ['/status', 'internal', '', 'Uptime page. Or keep public with noindex.', 0],
  ['/prototype/shelf, /prototype/deep-zoom, /prototype/prehistoric-art', 'internal', '', 'Prototypes (already noindex).', 2],

  // Draft: team only with a Draft banner, meant to go live later
  ['/research/quality, /research/page-errors', 'draft', '', 'Titles already say "(draft)". /research/quality has 37 visitors via /quality, so unlink it first.', 37],
  ['/ideas', 'draft', '', 'Unfinished, already noindex.', 0],
  ['/librarian/voice', 'draft', '', 'Voice Librarian, orphaned.', 3],
  ['/collections/jung-resonances', 'draft', '', 'Has a page but the collection is hidden (404 today).', null],
  ['/ficino-society and 2 sub-pages', 'draft', '', 'Public visitors already go to /support; the team could preview it.', 0],
  ['/blog/tibetan-reocr', 'draft', '', 'Already a draft with noindex.', null],

  // Merge: needs your call on which one stays
  ['/curated, /collections/all, /browse/subjects, /works', 'merge', '/collections + /browse', 'After the archives above, these are what is left of the subject listings.', 173],
  ['/give, /support, /support/business, /sponsors', 'merge', 'one giving page', '/give 250 visitors, /support 135 and in the top menu. Both in the footer.', 250],
  ['/for-researchers, /developers, /dataset, /licensing, /connect', 'merge', 'one page for researchers and developers', 'Three different book counts; /for-researchers has no visitors.', 256],

  // Fix: stays live, something is broken
  ['/login', 'fix', '', 'Redirect to /auth/signin.', 8],
  ['/languages/greek/latin', 'fix', '', 'Remove from sitemap.', null],
  ['/es/collections/school-of-athens', 'fix', '', 'Hide the "Leer en español" link when no Spanish page exists.', null],
  ['/collections/contemplative-traditions', 'fix', '', 'Shows 1 text, 0 languages.', null],
  ['/explore', 'fix', '', 'Hide the "Coming soon" card.', 546],
  ['/review', 'fix', '', 'Hide the "Coming soon" queue.', 52],
  ['/blog/clustering', 'fix', '', 'Chart fails to draw (Plotly not loaded).', null],
  ['/languages', 'fix', '', 'Clean junk slugs (e, ne, lat, unknown, auto-detect, multiple, mixed pairs) and link it from /browse.', 7],

  // Link: good page nobody can find
  ['/for-libraries', 'link', '', 'From /libraries and the footer.', 0],
  ['/contribute/wikipedia', 'link', '', 'From /contribute.', 0],
  ['/quality/methods', 'link', '', 'From /quality.', 0],
  ['/encyclopedia', 'link', '', 'Only linked from /how-it-works.', 40],
  ['/about/faq', 'link', '', 'Check it is in the About menu.', 17],
];

// Every hard-coded library count that should read from the live stats instead.
export const NUMBERS: NumberRow[] = [
  ['Sign-in email', 'src/lib/auth.ts:74', '"over 2,000 rare books"', 'Every magic-link email.'],
  ['Membership email', 'src/lib/membership-email.ts:101', '"over 10,000 digitized texts"', ''],
  ['Librarian (what the AI tells readers)', 'src/lib/embassy/librarian.ts:1530', '"over 10,000 rare books"', 'The Librarian repeats this to users.'],
  ['Librarian page intro (EN and ES)', 'src/lib/librarian-i18n.ts:78-79', '"over 10,000 rare books"', ''],
  ['Claude connect consent screen', 'src/app/oauth/authorize/route.ts:86', '"90,000+ historical illustrations"', ''],
  ['Identify loading message', 'src/app/identify/page.tsx:219', '"Comparing against 152,000 illustrations"', ''],
  ['Site search and MCP feature list', 'src/lib/site-features.json:53, 136', '"10,000+ books", "19,000+ texts in 200+ languages"', 'Feeds site search and the AI tools.'],
  ['/connect', 'src/app/connect/page.tsx:33, 40, 96, 213', '15,000 books, 200,000 illustrations', ''],
  ['/developers', 'src/app/developers/page.tsx:47, 59', '15,000+ texts', ''],
  ['/developers/pipeline', 'src/app/developers/pipeline/page.tsx:11, 158', '10,000+ books', ''],
  ['/for-researchers', 'src/app/for-researchers/page.tsx:8, 50, 58', '17,000 books', ''],
  ['/dataset', 'src/app/dataset/page.tsx:15', '19,000+ texts in 200+ languages', ''],
  ['/explore/map', 'src/app/explore/map/page.tsx:104', '10,000+ books', 'The map itself says 53,042.'],
  ['/explore/constellation', 'src/app/explore/constellation/page.tsx:11, 16', '33,000 books and artworks', 'Read from the map data, not the library total.'],
  ['/upload', 'src/app/upload/page.tsx:274', '~37k books', ''],
  ['/libraries', 'src/app/libraries/page.tsx', '14,000 works', ''],
  ['/terms', 'src/app/terms/page.tsx:229', '17,000+ texts', 'Legal text: drop the number rather than make it move.'],
  ['/about/by-the-numbers', 'page.tsx:16-40', 'whole May snapshot', 'Archived in the plan; if kept, rebuild on live stats.'],
  ['/beta', 'BetaLandingClient.tsx', '10,000 books, 85,000 illustrations', 'Archived in the plan.'],
];

/** What the 17 October check found, as counted in the report. */
export const CHECK = {
  date: '17 October 2026',
  commit: '40a9590',
  figures: [
    [780, 'URLs checked'],
    [19, 'broken or not working'],
    [13, 'pages with out-of-date numbers'],
    [4, 'numbers that disagree between pages'],
    [11, 'groups of overlapping pages'],
    [35, 'orphan pages'],
    [11, 'internal pages open to Google'],
  ] as [number, string][],
};

/** Ground rules agreed with Laura before any work started. */
export const RULES = [
  'No page is deleted. Old pages are archived: visitors are redirected to the page that replaced it, the file and URL stay.',
  'Unfinished or internal pages become team-only (Internal or Draft) instead of live.',
  'Team means admins only (superadmin and admin), not editors. Decided 18 October.',
  'Every library count quoted on the site reads from the live stats. No typed numbers.',
];

export type StepStatus = 'not started' | 'in review' | 'merged';

export interface Step {
  title: string;
  detail: string;
  status: StepStatus;
  prs: number[];
  /** True when the step waits on one of the decisions below. */
  needsDecision?: boolean;
}

/** One concern per pull request; each gets a preview and waits for a yes before merging. */
export const STEPS: Step[] = [
  {
    title: 'Quick fixes',
    detail: '/login redirect, sitemap entries (/timeline, /languages/greek/latin), the Spanish link on School of Athens, superseded blog redirects, the Trouw interview, hide the two "Coming soon" cards.',
    status: 'in review',
    prs: [6888, 6889],
  },
  {
    title: 'Page states',
    detail: 'The registry (src/lib/page-status.ts), the proxy gate, the Draft and Archived bars, sitemap and robots reading it, and the CI test. Ships with an empty list, so no page changes state yet.',
    status: 'in review',
    prs: [6891],
  },
  {
    title: 'Internal and Draft',
    detail: 'Move the Internal and Draft pages in the table below into the registry.',
    status: 'not started',
    prs: [],
  },
  {
    title: 'Archive',
    detail: 'The Archived pages with their successors. The category mapping (20 slugs) is the only fiddly part.',
    status: 'not started',
    prs: [],
  },
  {
    title: 'Live stats',
    detail: 'Extend getSiteStats() with the figures pages quote that it lacks, add <Stat> and formatStat(), settle one definition of a language.',
    status: 'not started',
    prs: [],
  },
  {
    title: 'Replace hard-coded numbers',
    detail: 'Emails and the Librarian first (people see those most), then the pages in the numbers table, then a CI guard so typed counts cannot come back.',
    status: 'not started',
    prs: [],
  },
  {
    title: 'Merges',
    detail: 'Giving pages, research and developer pages, subject listings.',
    status: 'not started',
    prs: [],
    needsDecision: true,
  },
  {
    title: 'Links',
    detail: 'Menu and footer links to /for-libraries, /languages, /encyclopedia and the other good pages nobody can find.',
    status: 'not started',
    prs: [],
  },
];

/** Triage rows already handled by an open or merged pull request, by page. */
export const HANDLED_BY: Record<string, number> = {
  '/login': 6888,
  '/languages/greek/latin': 6888,
  '/es/collections/school-of-athens': 6888,
  '/press/trouw-interview-english': 6888,
  '/blog/2000-first-translations': 6888,
  '/blog/worlds-largest-collection': 6888,
  '/explore': 6889,
  '/review': 6889,
};

/** Open questions for Laura, from the plan. */
export const DECISIONS: [string, string][] = [
  ['Giving', 'One page or two? /give gets more visitors, /support is the button in the top menu.'],
  ['Subject listings', 'After archiving categories, collection areas, topics and taxonomy, keep /curated as its own page or fold it into /collections?'],
  ['Researchers and developers', 'Merge /for-researchers into /developers, or keep a separate page for scholars?'],
  ['/about/by-the-numbers', 'Archive it (suggested) or rebuild it on live stats?'],
  ['Ficino Society', 'Still planned? If not, Archive instead of Draft.'],
  ['Terms wording', 'Dropping "17,000+" from the database-rights clause may need the Embassy\'s sign-off.'],
];
