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
// Unit-cost provenance: the machine cost of a single pass is MEASURED on
// /admin/spend (September 2026 bill: translation ≈ $0.003/page, OCR ≈ $0.0006/page,
// whole backlog ≈ $48–63K at list price). The 2.3¢/page budget rate is a PROGRAMME
// rate (repeat passes, hard scripts, image extraction, failed runs); the copy below
// must say so and never present it as the bare cost of one pass.
//
// Authored copy: the letter text is Derek's (last direct edit on the page
// 2026-09-29). Fix typos; do not reword without asking.

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
  dateline: 'Amsterdam, September 2026',
  salutation: 'Dear friend,',
  lead: 'The last time the world translated its ancient wisdom, it ignited the Renaissance. I think we can do it again.',
  bodyBeforeQuote: [
    'Just after the arrival of the printing press, Cosimo de’ Medici commissioned Marsilio Ficino to translate ancient Greek and African wisdom texts into Latin. These ancient ideas lit up Europe and sparked what we know of as the Renaissance.',
    'Source Library began when I learned that I couldn’t read Marsilio Ficino’s own philosophical works — because most of the Renaissance itself has never been translated. Debora Shuger, a Renaissance scholar at UCLA, estimates that **“90 percent of the Latin texts from the Renaissance have never been available in translation”** ([UCLA, 2012](https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883)). At current rates of human translation, it would take more than 10,000 years to finish it all.',
    'And, of course, there is so much more than Latin: massive bodies of untranslated texts in Chinese, Sanskrit, Tibetan, Arabic, Hebrew and dozens of other languages.',
    'At the onset of Superintelligence, we want to make sure that all ancient source texts are available to AI — and to people, through AI.',
    'How can you trust it? Every translation is shown next to the scanned page it came from, so you can check any line against the original before you quote it. All of it is free under a Creative Commons share-alike licence, and it is open by API and MCP, which means the AI assistant you use can look up the actual page instead of guessing at it.',
  ],
  bodyBeforeImage1: [
    'Today, Source Library holds more than **40,000 books** in over fifty languages, and more than **18,000** of them can be read in translation, nearly five million pages, most of them in English for the first time. To get a sense of the scale, the library already holds more words than English Wikipedia.',
    'Source Library is based at the [Embassy of the Free Mind](https://embassyofthefreemind.com) in Amsterdam, home of the Bibliotheca Philosophica Hermetica, a UNESCO “Memory of the World” rare-book library. It has a [Guinness record](https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism) for the largest library devoted to magic and mysticism. Here is a picture of the statue of Marsilio Ficino assisting with the Source Library translation work.',
  ],
  image1: {
    src: '/vision/ficino-laptop.jpg',
    alt: 'Bronze bust of Marsilio Ficino with a laptop open to translation work, at the Embassy of the Free Mind',
    caption: 'Marsilio Ficino, Divinus Interpres, with a laptop open to the translation of Plotinus. Embassy of the Free Mind, Amsterdam.',
  },
  bodyAfterImage1: [],
  buildHeading: 'What we need to finish',
  bodyBuild: [
    'Source Library has been a labor of love and now we want to open it up so that others can pour theirs in — through contributions of time and funding.',
    'When it comes to funding, we’ve raised $60,000 so far from two incredible donors, but yet have spent over $120,000 to make this resource free and open. It is my hope to find other donors who want to help participate in the *largest historical translation project in history.* We can, of course, offer in return our good karma, amazing parties, and specially collected rare books from our collection.',
    'Let me share more about our costs. To run something the size of Wikipedia, we have monthly costs for hosting, databases and processing. This comes to about $3,000 per month, not including any human labor. On the AI translations, we’ve spent about $85,000 in tokens to create about 20,000 translated books. Yet we’ve made huge progress in cost optimization. The current costs are about $5/book in total. That means another $360,000 could help us to immediately make available **another 70,000+ books from diverse traditions around the world.** These books are already scanned and catalogued. This money would pay for the OCR, the translation, for quality control, for the scripts that need special handling, such as Tibetan and Syriac, for pulling out the illustrations, and for the retries and failed runs that every job of this size carries. When it is finished the library will hold roughly four times the words of English Wikipedia.',
    'Then, there are books that still need to be scanned. At the Embassy of the Free Mind, there are about three thousand books printed before 1920 that have no digital copy anywhere, and some two thousand of them exist in no other collection. Scanning them at the Embassy, at its own pace and rates, is another $550,000. Then, there are books and manuscripts in libraries in India, in Indonesia and in libraries all around the world — we want to open these up and make them available for all the world, for all time.',
    'Our vision is not merely to get everything “done” and walk away. We want to create a living archive, something that can improve and evolve over time. We want to create a stewardship community that can improve our translations and interpretations. We want to create a global community of amateur and professional scholars who care to create a sustainable and trusted resource. It is important for scholars to check the translations against the originals, language by language. Similarly, it is important to revise translations and interpretations over time as AI improves. Everything so far has been done entirely by volunteers.',
    'Over five years it comes to **$2.8 million**: $2.4 million for the work itself and $400,000 to run the organization that does it. The first year needs **$742,000**, and each year after that about $520,000.',
  ],
  montage: {
    images: [
      { src: '/vision/embassy.jpg', alt: 'The Embassy of the Free Mind, Amsterdam' },
      { src: '/vision/bibliotheca.jpg', alt: 'Guests in the Bibliotheca Philosophica Hermetica' },
      { src: '/vision/embassy-crowd.jpg', alt: 'A gathering outside the Embassy of the Free Mind, Amsterdam' },
    ],
    caption: 'The Embassy of the Free Mind, Amsterdam — home of the Bibliotheca Philosophica Hermetica.',
  },
  bodyConvener: [
    'If you want to participate in this historical project, please reach out. I would be happy to arrange a time online or on location at the Embassy of the Free Mind.',
  ],
  signoff: 'With gratitude,',
  signature: {
    name: 'Derek Lomas, PhD',
    role: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
    email: 'team@sourcelibrary.org',
    photo: '/founder-derek.jpg',
  },
  plan: {
    heading: 'The five-year budget: $2.8 million',
    intro: 'Each line below comes from a unit cost we have measured in practice. The first year needs **$742,000**, and each year after that about **$520,000**.',
    items: [
      { work: 'Translate the 72,000 books (16 million pages) we already hold, then re-read them as the engines improve', resource: '$360K' },
      { work: 'Scholars reviewing the translations against the originals, language by language', resource: '$150K' },
      { work: 'Scanning the Embassy’s last 3,000 books: 2,400 at about €70, and 600 fragile volumes on the KNAW slow scanner at about €400', resource: '$550K' },
      { work: 'A director, a part-time engineer to run the pipeline, and a community manager, for five years', resource: '$800K' },
      { work: 'Keeping every page online for five years — hosting, storage, database', resource: '$170K' },
      { work: 'Research commissions, grant-writing, conferences and gatherings at the Embassy', resource: '$150K' },
      { work: 'Legal foundations (entity, trademark, rights policy), administration and contingency', resource: '$240K' },
      { work: 'Running the organization: fundraising help, tools, insurance, payment processing, and a three-month reserve', resource: '$400K' },
    ],
    footnote: 'Translation is budgeted at 2.3 cents a page. Our measured cost in September 2026 was about a third of a cent a page for a single pass on the cheapest engine; the budget rate covers repeat passes with better models, the harder scripts, illustration extraction and failed runs. Scanning is costed at the Embassy’s own throughput (200 pages an hour on the standard scanners, 25 an hour on the KNAW scanner for fragile volumes) at working-student rates, and is funded through the Embassy. Hosting is our measured run rate with room for the collection to grow. The team lines are part-time contractor rates in the Netherlands. Administration covers bookkeeping, audit and compliance. A full line-by-line budget, by year, is available on request.',
  },
  ways: {
    heading: 'Ways to take part',
    intro: 'Across the translation programme the budget works out to about $5 a book, and the levels below are priced on that. With your consent, every gift is recorded in the register under your name, permanently.',
    tiers: [
      { gift: '$100', label: 'Translates 20 books' },
      { gift: '$275', label: 'Adopt a book — one unscanned volume at the Embassy, scanned and translated, named for you; a fragile volume on the slow scanner from $500' },
      { gift: '$1,000+', label: 'Founding Member — 200 books translated; your name in the founding register' },
      { gift: '$10,000+', label: 'Founding Benefactor — a named shelf of 2,000 books translated' },
      { gift: '$50,000+', label: 'Founding Patron — 10,000 books translated; your name on the institution, and an evening with us in the Bibliotheca' },
      { gift: 'from $150,000', label: 'Underwrite a language — bring the whole library into Spanish, Arabic or Hindi, expert-reviewed, with your name on the edition' },
    ],
    footnote: 'Gifts are tax-deductible in the Netherlands (Stichting het Wereldhart, a cultural ANBI). US donors can give tax-deductibly today through the Netherland-America Foundation; Wisdom Frontiers (US) has applied for 501(c)(3) status, and a pledge can be paid on determination.',
  },
  cta: {
    heading: 'Let’s talk',
    body: 'I would be glad to show you the library, in person at the Embassy in Amsterdam or on a call, and to go through the budget with you.',
    primaryLabel: 'Let’s talk',
    primaryHref: 'mailto:team@sourcelibrary.org?subject=Source%20Library%20%E2%80%94%20let%E2%80%99s%20talk',
    secondaryLabel: 'Make a gift',
    secondaryHref: '/support',
    footer: 'This address comes straight to me.',
  },
};
