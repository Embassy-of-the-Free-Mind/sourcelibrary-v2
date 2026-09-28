// ── Vision page content ──────────────────────────────────────────────────
// This object is the single source of truth for all the text on /vision.
// Edit it here directly, OR use the in-browser editor at /vision?edit:
// change the text on the page, click "Copy JSON", and paste the result back
// over `visionContent` below (then redeploy). Collaborators can do the same
// and send you their JSON.
//
// Light formatting inside any text field: **bold**, *italic*, [label](url).
//
// Budget provenance: the five-year budget and every unit cost quoted below are
// derived in the private ops repo, docs/program-budget-5yr-2026-09.md. Corpus
// figures measured 2026-09-07 (visible books at the site's readable bar; the
// untranslated pool = books with pages_count > 0 under 90% translated).

export interface PlanItem {
  work: string;
  resource: string;
}

export interface VisionContent {
  hero: { title: string; subtitle: string; image: string; imageAlt: string };
  dateline: string;
  salutation: string;
  lead: string;
  bodyBeforeQuote: string[];
  quote: { en: string; la: string; source: string; url: string; linkLabel: string };
  bodyBeforeImage1: string[];
  image1: { src: string; alt: string; caption: string; href: string };
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
  lead: 'The last time the world translated its ancient wisdom, it set off the Renaissance. I think we can do it again, and this time most of the books are already on the shelf.',
  bodyBeforeQuote: [
    'The Renaissance began with translation. When Marsilio Ficino translated Plato and the Hermetic writings from Greek into Latin in Florence in the 1460s, Europe got back a body of thought it had been missing for a thousand years, and spent the next two centuries working out what to do with it.',
    'Most of what those two centuries wrote has still not been read. Debora Shuger, a Renaissance scholar at UCLA, estimates that **“90 percent of the Latin texts from the Renaissance have never been available in translation”** ([UCLA, 2012](https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883)). Then there are the thousands of texts in Chinese, Sanskrit, Arabic, Hebrew and other languages, which nobody reads unless they have the language, and which are missing from the data that today’s AI systems learn from.',
    'Pico della Mirandola put the method in a sentence. You can open the book in our library:',
  ],
  quote: {
    en: 'Magic does not so much work wonders as serve nature while she works them.',
    la: 'Non tam facit miranda quam facienti naturæ sedula famulatur.',
    source: 'Giovanni Pico della Mirandola, *Oration on the Dignity of Man* (1496)',
    url: '/q/Bek54SCHDUKr4EJMnM4',
    linkLabel: 'read it at the source',
  },
  bodyBeforeImage1: [
    'Source Library goes back to the source. Today it holds more than **40,000 books** in over fifty languages, and more than **18,000** of them can be read in translation, nearly five million pages, most of them in English for the first time. If you count originals and translations together, the library already holds more words than English Wikipedia.',
    'Every translation is shown next to the scanned page it came from, so you can check any line against the original before you quote it. All of it is free under a Creative Commons share-alike licence, and it is open by API and MCP, which means the AI assistant you use can look up the actual page instead of guessing at it.',
  ],
  image1: {
    src: 'https://images.sourcelibrary.org/pages/69520c46ab34727b1f044141/0019.jpg',
    alt: "An emblem from Michael Maier's Atalanta Fugiens (1618)",
    caption: 'One of millions of pages now readable and quotable — an emblem from Maier’s *Atalanta Fugiens*, 1618.',
    href: '/book/atalanta-fleeing-new-chemical-emblems-of-the-secrets-of-maier/page/69520c46ab34727b1f044154',
  },
  bodyAfterImage1: [
    'We are based at the [Embassy of the Free Mind](https://embassyofthefreemind.com) in Amsterdam, home of the Bibliotheca Philosophica Hermetica, a UNESCO “Memory of the World” rare-book library. Source Library was created with the support of the Wisdom Frontiers Society of La Jolla, California, and the Gambrell Foundation, and runs as an open initiative of the Embassy, a Dutch nonprofit with 501(c)(3) status. Gifts are tax-deductible in the US and the Netherlands ([give here](/support)).',
  ],
  buildHeading: 'What we need to finish',
  bodyBuild: [
    'We hold **another 72,000 books, sixteen million pages, that nobody can read yet.** They are already scanned and catalogued. What they are waiting for is the translation run, which costs about two cents a page, or about $360,000 for all of them. There is nothing left to invent in this part of the work. The pipeline runs, and the only thing missing is the money to keep it running. When it is finished the library will hold roughly four times the words of English Wikipedia, and a good deal of it will be the material Wikipedia’s own articles were written from.',
    'The rest of the budget is what a library needs if people are going to trust it and it is going to last. Scholars have to check the translations against the originals, language by language. The Embassy holds about two thousand books that exist in no other collection, and they have to be scanned before they can be translated at all. Every page has to stay online, and someone has to be paid to keep the whole thing running. So far a handful of people have done all of this, mostly unpaid. Over five years it comes to **$2.4 million**: $2 million for the work itself and $400,000 to run the organization that does it. The first year needs **$672,000**, and each year after that about $430,000.',
  ],
  montage: {
    images: [
      { src: '/vision/embassy.jpg', alt: 'The Embassy of the Free Mind, Amsterdam' },
      { src: '/vision/bibliotheca.jpg', alt: 'Guests in the Bibliotheca Philosophica Hermetica' },
      { src: '/vision/ficino.jpg', alt: 'Bust of Marsilio Ficino at the Embassy of the Free Mind' },
      { src: '/vision/embassy-crowd.jpg', alt: 'A gathering outside the Embassy of the Free Mind, Amsterdam' },
    ],
    caption: 'The Embassy of the Free Mind, Amsterdam — home of the Bibliotheca Philosophica Hermetica.',
  },
  bodyConvener: [
    'If you are able to help fund this, or you know someone who might, I would like to hear from you. The work is easier to understand in person than on paper, and I am happy to show it to anyone who is curious.',
  ],
  signoff: 'With gratitude,',
  signature: {
    name: 'Derek Lomas, PhD',
    role: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
    email: 'team@sourcelibrary.org',
    photo: '/founder-derek.jpg',
  },
  plan: {
    heading: 'The five-year budget: $2.4 million',
    intro: 'Each line below comes from a unit cost we have measured in practice. The first year needs **$672,000**, and each year after that about **$432,000**.',
    items: [
      { work: 'Translate the 72,000 books (16 million pages) we already hold — about 2 cents a page', resource: '$360K' },
      { work: 'Scholars reviewing the translations against the originals, language by language', resource: '$150K' },
      { work: 'Scanning about 2,000 rare books at the Embassy that exist in no other collection', resource: '$130K' },
      { work: 'A director, a part-time engineer to run the pipeline, and a community manager, for five years', resource: '$800K' },
      { work: 'Keeping every page online for five years — hosting, storage, database', resource: '$170K' },
      { work: 'Research commissions, grant-writing, conferences and gatherings at the Embassy', resource: '$150K' },
      { work: 'Legal foundations (entity, trademark, rights policy), administration and contingency', resource: '$240K' },
      { work: 'Running the organization: fundraising help, tools, insurance, payment processing, and a three-month reserve', resource: '$400K' },
    ],
    footnote: 'Translation is priced at 2.3 cents a page, above what our pipeline currently costs, to cover retries and the harder scripts. Scanning is $60 a book, all in. Hosting is our measured run rate with room for the collection to grow. The team lines are part-time contractor rates in the Netherlands. Administration covers bookkeeping, audit and compliance. A full line-by-line budget, by year, is available on request.',
  },
  ways: {
    heading: 'Ways to take part',
    intro: 'A book costs about $5 to translate. Every gift below is recorded in the register under your name, permanently.',
    tiers: [
      { gift: '$100', label: 'Translates 20 books' },
      { gift: '$275', label: 'Adopt a rare manuscript — one unscanned volume at the Embassy, scanned and translated, named for you' },
      { gift: '$1,000+', label: 'Founding Member — 200 books translated; your name in the founding register' },
      { gift: '$10,000+', label: 'Founding Benefactor — a named shelf of 2,000 books translated' },
      { gift: '$50,000+', label: 'Founding Patron — 10,000 books translated; your name on the institution, and an evening with us in the Bibliotheca' },
      { gift: 'from $150,000', label: 'Underwrite a language — bring the whole library into Spanish, Arabic or Hindi, expert-reviewed, with your name on the edition' },
    ],
    footnote: 'Gifts are tax-deductible in the US and the Netherlands.',
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
