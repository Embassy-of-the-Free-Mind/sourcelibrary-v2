// ── Vision page content ──────────────────────────────────────────────────
// This object is the single source of truth for all the text on /vision.
// Edit it here directly, OR use the in-browser editor at /vision?edit:
// change the text on the page, click "Copy JSON", and paste the result back
// over `visionContent` below (then redeploy). Collaborators can do the same
// and send you their JSON. In edit mode a reviewer can also click into a
// paragraph and press "Add comment"; comments travel in the copied JSON as
// `_comments` (see EditComment) and are for the person applying the edits —
// strip them before pasting here. Workflow: `.claude/skills/edit-on-page/`.
//
// Light formatting inside any text field: **bold**, *italic*, [label](url).
//
// Budget provenance: the five-year budget and every unit cost quoted below are
// derived in the private ops repo, docs/program-budget-5yr-2026-09.md. Corpus
// figures measured 2026-09-07 (visible books at the site's readable bar; the
// untranslated pool = books with pages_count > 0 under 90% translated).
// Rechecked 2026-10-01: 92,198 books with pages (any visibility, incl. 1,517
// Kloss takedowns and duplicates); 16,599 live books at the readable bar
// (homepage_stats.translatedToEnglish) — so the letter said 88,000 / 16,000 /
// 72,000. Rechecked 2026-10-06: 96,230 books with pages, minus 1,603 duplicate_of
// and 1,517 Kloss takedowns = 93,110 held; 19,865 readable in English (live
// homepage) — so the letter says 93,000 / nearly 20,000 / 73,000. The budget's
// $360K line is unchanged (16M pages still to read; 16.4M measured). When #5289
// lands these should read the translation-state views instead of literals.
// Spelling: American (Derek, 2026-10-01).
// Unit-cost provenance: the machine cost of a single pass is MEASURED on
// /admin/spend (September 2026 bill: translation ≈ $0.003/page, OCR ≈ $0.0006/page,
// whole backlog ≈ $48–63K at list price). The 2.3¢/page budget rate is a PROGRAM
// rate (repeat passes, hard scripts, image extraction, failed runs); the copy below
// must say so and never present it as the bare cost of one pass.
//
// Authored copy: the letter text is Derek's (last direct edit on the page
// 2026-09-29). Fix typos; do not reword without asking.
// Structure (2026-09-29, Derek: "make the 5 year vision and plan more clear"):
// letter → `vision` (2031) → `phases` (year 1 / years 2–3 / years 4–5, each with a
// promise and a cost) → montage → sign-off → `plan` (the line-item budget, now the
// appendix) → tiers. Phase costs = the raise by year (ops doc v5 + v6, 2026-09-30).

export interface PlanItem {
  work: string;
  resource: string;
}

/** One reviewer note left in edit mode. Exported in the JSON as `_comments`; never rendered. */
export interface EditComment {
  /** Dotted path of the field the note is about, e.g. `bodyBuild.2`. */
  path: string;
  /** First ~80 characters of the field when the note was written, so it survives a path shift. */
  excerpt: string;
  text: string;
}

/** One phase of the five-year plan. `promise` is the line a donor can check later. */
export interface Phase {
  years: string;
  title: string;
  cost: string;
  body: string[];
  promise: string;
}

export interface VisionContent {
  hero: { title: string; subtitle: string; image: string; imageAlt: string };
  dateline: string;
  salutation: string;
  lead: string;
  bodyBeforeQuote: string[];
  /** Optional pull-quote. Dropped from the letter 2026-09-29 (the Pico line was unrelated); kept in the type so it can come back. */
  quote?: { en: string; la: string; source: string; url: string; linkLabel: string };
  bodyBeforeImage1: string[];
  /** `href` is optional: a photograph with no source page renders without the "Read this page" link. */
  image1: { src: string; alt: string; caption: string; href?: string };
  bodyAfterImage1: string[];
  buildHeading: string;
  bodyBuild: string[];
  /** What exists at the end of the five years. Short lines, each one checkable. */
  vision: { heading: string; intro: string; items: string[] };
  /** The plan by time and outcome; the budget table below is its appendix. */
  phases: { heading: string; intro: string; items: Phase[]; footnote: string };
  montage: { images: { src: string; alt: string }[]; caption: string };
  bodyConvener: string[];
  signoff: string;
  signature: { name: string; role: string; email: string; photo: string };
  plan: { heading: string; intro: string; items: PlanItem[]; footnote: string };
  ways: {
    heading: string;
    intro: string;
    tiers: { gift: string; label: string }[];
    footnote: string;
  };
  cta: {
    heading: string;
    body: string;
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
    footer: string;
  };
}

export const visionContent: VisionContent = {
  hero: {
    title: 'Bringing ancient wisdom into the future',
    subtitle: 'A letter from Derek Lomas, founder of Source Library',
    image: '/vision/hero.jpg',
    imageAlt: 'Historical illustration from the Bibliotheca Philosophica Hermetica',
  },
  dateline: 'Amsterdam, October 2026',
  salutation: 'Dear friend,',
  lead: 'The last time the world translated its ancient wisdom, it ignited the Renaissance. I think we can do it again.',
  bodyBeforeQuote: [
    'Just after the arrival of the printing press, Cosimo de’ Medici commissioned Marsilio Ficino to translate ancient Greek and African wisdom texts into Latin. These ancient ideas lit up Europe and sparked what we know of as the Renaissance.',
    'Source Library began when I learned that I couldn’t read Marsilio Ficino’s own philosophical works, because most of the Renaissance itself has never been translated. Debora Shuger, a Renaissance scholar at UCLA, estimates that **“90 percent of the Latin texts from the Renaissance have never been available in translation”** ([UCLA, 2012](https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883)). At current rates of human translation, it would take more than 10,000 years to finish it all.',
    'And, of course, there is so much more than Latin: massive bodies of untranslated texts in Chinese, Sanskrit, Tibetan, Arabic, Hebrew and dozens of other languages.',
    'At the onset of Superintelligence, we want to make sure that all ancient source texts are available to AI, and to people through AI.',
    'How can you trust it? Every translation is shown next to the scanned page it came from, so you can check any line against the original before you quote it. All of it is free under a Creative Commons share-alike license, and it is open by API and MCP, which means the AI assistant you use can look up the actual page instead of guessing at it.',
  ],
  bodyBeforeImage1: [
    'Today, Source Library holds about **93,000 books** in over fifty languages. Nearly **20,000** of them can already be read in translation, nearly five million pages, most of them in English for the first time. The other **73,000** are scanned and cataloged but not yet readable. To get a sense of the scale, the library already holds more words than English Wikipedia.',
    'Source Library is based at the [Embassy of the Free Mind](https://embassyofthefreemind.com) in Amsterdam, home of the Bibliotheca Philosophica Hermetica, a UNESCO “Memory of the World” rare-book library. It has a [Guinness record](https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism) for the largest library devoted to magic and mysticism. Here is a picture of the bust of Marsilio Ficino that watches over the Source Library translation work.',
  ],
  image1: {
    src: '/vision/ficino.jpg',
    alt: 'Bust of Marsilio Ficino at the Embassy of the Free Mind',
    caption: 'Marsilio Ficino at the Embassy of the Free Mind, Amsterdam.',
  },
  bodyAfterImage1: [],
  buildHeading: 'What we need to finish',
  bodyBuild: [
    'Source Library has been a labor of love and now we want to open it up so that others can pour theirs in, through contributions of time and funding.',
    'When it comes to funding, we’ve raised $60,000 so far from two incredible donors, but have spent over $120,000 to make this resource free and open. It is my hope to find other donors who want to help participate in the *largest historical translation project in history.* We can, of course, offer in return our good karma, amazing parties, and specially collected rare books from our collection.',
    'Let me share more about our costs. To run something the size of Wikipedia, we have monthly costs for hosting, databases and processing. Hosting alone is about $3,000 per month; at full working pace, with the AI translation running, it is $11,000 to $15,000 per month, not including any human labor. On AI translation, we’ve spent about $85,000 in tokens so far, on some 20,000 books. Since then the cost has fallen sharply: a single pass now costs under a dollar a book. We budget $5 a book so that every book is re-read as better models arrive, the hard scripts get special handling, and scholars can check the results. Everything so far has been done entirely by volunteers.',
  ],
  vision: {
    heading: 'Where we will be in 2031',
    intro: 'Here is what exists at the end of five years, if this is funded.',
    items: [
      '**On the order of a million books readable in translation**: every ancient source text that anyone has scanned, from the Renaissance Latin that was never translated to the Chinese, Sanskrit, Tibetan and Arabic corpora, open to anyone and to AI.',
      '**Every line checkable against its scan.** Translation and original side by side, on every page of every book.',
      '**The core of the tradition in scholarly editions**, reviewed by experts language by language and citable by DOI.',
      '**The Embassy’s three thousand undigitized books scanned and translated**, two thousand of which exist in no other collection, with collections from partner libraries in India, Indonesia and elsewhere joining on the same open terms.',
      '**A global stewardship community** of amateur and professional scholars who decide what belongs, correct and annotate the translations, and keep the archive improving every year instead of going stale.',
      '**A foundation that runs it**, with the staff, the reserve and the legal footing to keep every page online for the long term.',
    ],
  },
  phases: {
    heading: 'The plan, year by year',
    intro: 'Three phases. Each one ends with a promise you can check.',
    items: [
      {
        years: 'Year 1',
        title: 'Read everything we hold',
        cost: '$762,000',
        body: [
          'We hold **another 73,000 books, sixteen million pages, that nobody can read yet.** They are already scanned and cataloged. Today the pipeline runs on a budget of $5 a day. At full speed, about two million pages a month, which is the most we have ever run, the AI costs **$8,000 to $12,000 a month** on top of about $3,000 a month for hosting, and everything we hold is read in about nine months: the OCR, the translation, the illustrations, and the scripts that need special handling, such as Tibetan and Syriac. Quality comes first: each kind of page gets the engine that reads it best in our measurements, and the hardest pages are read twice. [The reading plan](/research/reading-plan) shows what that costs and what we are still testing.',
          'The rest of the first year builds the organization that makes those translations trustworthy: the foundation and its legal footing, a director, a part-time engineer to run the pipeline, and the hosting that keeps every page online.',
        ],
        promise: 'By next summer, every one of the 93,000 books we hold has a first translation, and there is an organization responsible for it.',
      },
      {
        years: 'Years 2–3',
        title: 'Read the world’s scanned record, and make it trustworthy',
        cost: 'about $540,000 a year',
        body: [
          'Far more has been scanned than we hold. HathiTrust, the Internet Archive, Gallica, the Munich Digitization Center and the Tibetan and Chinese digital libraries hold millions of volumes that nobody can read. We bring them in shelf by shelf, starting with Renaissance Latin, Chinese, Sanskrit and Arabic. At today’s rates each additional 100,000 books costs $60,000 to $175,000 to read, depending on how carefully each page is checked, and the shelf and language gifts below scale that directly.',
          'It is important for scholars to check the translations against the originals, language by language. That starts with Renaissance Latin, and the core works become scholarly editions with DOIs, so they can be cited.',
          'At the Embassy of the Free Mind, there are about three thousand books printed before 1920 that have no digital copy anywhere, and some two thousand of them exist in no other collection. Scanning them at the Embassy, at its own pace and rates, is another $550,000, and we translate them as they come off the scanner.',
          'The stewardship community begins here: reviewers, annotators and translators who take responsibility for a language, a tradition or a shelf, and whose corrections flow back into the texts.',
        ],
        promise: 'By the end of year three, several hundred thousand books are readable, the Embassy’s unique holdings are online, and the most important texts carry an expert’s review.',
      },
      {
        years: 'Years 4–5',
        title: 'A million books, alive',
        cost: 'about $540,000 a year',
        body: [
          'Our vision is not merely to get everything “done” and walk away. We want to create a living archive, something that can improve and evolve over time. Translations are re-read as AI improves, and the community’s work is what keeps them honest.',
          'The library comes out in Spanish, Arabic and Hindi, expert-reviewed. Then, there are books and manuscripts in libraries in India, in Indonesia and in libraries all around the world. We want to open these up and make them available for all the world, for all time.',
          'The foundation builds its reserve and an endowment path, so the archive outlives its founders.',
        ],
        promise: 'By the end of year five, a living archive on the order of a million books, stewarded by a global community, improving every year.',
      },
    ],
    footnote: 'Over five years it comes to **$2.9 million**: $2.5 million for the work itself and $400,000 to run the organization that does it. The first year needs **$762,000**, and each year after that about $540,000. The line-by-line budget is below.',
  },
  montage: {
    images: [
      { src: '/vision/embassy.jpg', alt: 'The Embassy of the Free Mind, Amsterdam' },
      { src: '/vision/bibliotheca.jpg', alt: 'Guests in the Bibliotheca Philosophica Hermetica' },
      { src: '/vision/embassy-crowd.jpg', alt: 'A gathering outside the Embassy of the Free Mind, Amsterdam' },
    ],
    caption: 'The Embassy of the Free Mind, Amsterdam, home of the Bibliotheca Philosophica Hermetica.',
  },
  bodyConvener: [
    'So here is the ask. The first year needs **$762,000**, and it buys something you can check: by next summer, every book we hold has a first translation, and there is an organization responsible for it. Simply keeping the library running at its current pace, while that is raised, takes about **$150,000 to $200,000** for the coming year.',
    'If you want to participate in this historical project, please reach out. I would be happy to arrange a time online or on location at the Embassy of the Free Mind.',
  ],
  signoff: 'With gratitude,',
  signature: {
    name: 'Derek Lomas, PhD',
    role: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
    email: 'derek@sourcelibrary.org',
    photo: '/founder-derek.jpg',
  },
  plan: {
    heading: 'The five-year budget: $2.9 million',
    intro: 'The plan above, line by line. Each line comes from a unit cost we have measured in practice. The first year needs **$762,000**, and each year after that about **$540,000**.',
    items: [
      { work: 'Translate the 73,000 books (16 million pages) we already hold, then re-read them as the engines improve', resource: '$360K' },
      { work: 'Scholars reviewing the translations against the originals, language by language', resource: '$150K' },
      { work: 'Scanning the Embassy’s last 3,000 books: 2,400 at about €70, and 600 fragile volumes on the KNAW slow scanner at about €400', resource: '$550K' },
      { work: 'A director, a part-time engineer to run the pipeline, and a community manager, for five years', resource: '$800K' },
      { work: 'Keeping every page online for five years: hosting, storage, database, growing with the shelf toward a million books', resource: '$270K' },
      { work: 'Research commissions, grant-writing, conferences and gatherings at the Embassy', resource: '$150K' },
      { work: 'Legal foundations (entity, trademark, rights policy), administration and contingency', resource: '$240K' },
      { work: 'Running the organization: fundraising help, tools, insurance, payment processing, and a three-month reserve', resource: '$400K' },
    ],
    footnote: 'Translation is budgeted at 2.3 cents a page. Our measured cost in October 2026 is about a quarter of a cent a page for a single pass on the cheapest engine, and about seven-tenths of a cent for the most careful pass, in which every page is read twice and disagreements are re-read by a stronger model ([the reading plan](/research/reading-plan)); the budget rate covers repeat passes with better models, the harder scripts, illustration extraction and failed runs. Scanning is costed at the Embassy’s own throughput (200 pages an hour on the standard scanners, 25 an hour on the KNAW scanner for fragile volumes) at working-student rates, and is funded through the Embassy. Hosting is our measured run rate plus storage growth toward a million books, about $250 a month for every 18 million pages added. The team lines are part-time contractor rates in the Netherlands. Administration covers bookkeeping, audit and compliance. A full line-by-line budget, by year, is available on request.',
  },
  ways: {
    heading: 'Ways to take part',
    intro: 'Across the translation program the budget works out to about $5 a book, and the levels below are priced on that. The first levels fund year one; adopting a manuscript funds the scanning in years two and three; underwriting a language funds years four and five. With your consent, every gift is recorded in the register under your name, permanently.',
    tiers: [
      { gift: '$100', label: 'Translates 20 books' },
      { gift: '$275', label: 'Adopt a book: one unscanned volume at the Embassy, scanned and translated, named for you; a fragile volume on the slow scanner from $500' },
      { gift: '$1,000+', label: 'Founding Member: 200 books translated; your name in the founding register' },
      { gift: '$10,000+', label: 'Founding Benefactor: a named shelf of 2,000 books translated' },
      { gift: '$50,000+', label: 'Founding Patron: 10,000 books translated; your name on the institution, and an evening with us in the Bibliotheca' },
      { gift: 'from $150,000', label: 'Underwrite a language: bring the whole library into Spanish, Arabic or Hindi, expert-reviewed, with your name on the edition' },
    ],
    footnote: 'Gifts are tax-deductible in the Netherlands (Stichting het Wereldhart, a cultural ANBI). US donors can give tax-deductibly today through the Netherland-America Foundation; Wisdom Frontiers (US) has applied for 501(c)(3) status, and a pledge can be paid on determination.',
  },
  cta: {
    heading: 'Let’s talk',
    body: 'I would be glad to show you the library, in person at the Embassy in Amsterdam or on a call, and to go through the budget with you.',
    primaryLabel: 'Let’s talk',
    primaryHref: 'mailto:derek@sourcelibrary.org?subject=Source%20Library%3A%20let%E2%80%99s%20talk',
    secondaryLabel: 'Make a gift',
    secondaryHref: '/support',
    footer: 'Write to me at [derek@sourcelibrary.org](mailto:derek@sourcelibrary.org). I’m happy to talk by phone, video or WhatsApp, whichever suits you.',
  },
};
