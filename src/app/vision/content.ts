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
  lead: 'The last time the world translated its ancient wisdom, it set off the Renaissance. I think we can do it again — and this time most of the books are already on the shelf.',
  bodyBeforeQuote: [
    'The Renaissance began with translation. When a small circle in fifteenth-century Florence brought Plato and the Hermetic writings out of Greek into Latin, the ideas they set loose reshaped a civilization.',
    'Most of what that civilization then wrote is still locked up. As the UCLA scholar Debora Shuger has observed, **“90 percent of the Latin texts from the Renaissance have never been available in translation”** ([UCLA, 2012](https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883)). Beyond Latin lie thousands of texts in Chinese, Sanskrit, Arabic, Hebrew and more, unread by anyone who does not have the language — and absent from the data that trains today’s AI.',
    'Pico della Mirandola described the method well, in a book you can open in our library:',
  ],
  quote: {
    en: 'Magic does not so much work wonders as serve nature while she works them.',
    la: 'Non tam facit miranda quam facienti naturæ sedula famulatur.',
    source: 'Giovanni Pico della Mirandola, *Oration on the Dignity of Man* (1496)',
    url: '/q/Bek54SCHDUKr4EJMnM4',
    linkLabel: 'read it at the source',
  },
  bodyBeforeImage1: [
    'That is what Source Library does: it goes back to the source and lets anyone — a reader, a scholar, an AI — do the same. Today it holds more than **40,000 books** in over fifty languages. More than **18,000** of them can be read in translation, nearly five million pages, most of them in English for the first time. Counting originals and translations, the library already holds more words than English Wikipedia.',
    'Every translation sits beside the scanned original, so any line can be checked, quoted and cited. It is free, Creative Commons share-alike, and open by API and MCP, so the AI you use can reach for the actual page.',
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
    'Here is the situation. We hold **72,000 more books — sixteen million pages — that no one can read yet.** They are scanned and catalogued and waiting for the pipeline. Translating a page costs about two cents; translating all of them costs about $360,000. That is the single largest thing your money can do here, and it is entirely mechanical: fund it, and the books get read. Finished, the library will hold about four times the words of English Wikipedia. Wikipedia is what we know; this is the shelf it was written from.',
    'Around that core sit the things a library needs in order to be trusted and to last: scholars checking the translations against the originals, a scanner at the Embassy for the books that exist nowhere else, the hosting that keeps every page online, and a small team to run it. Everything so far has been done by a handful of people, mostly unpaid. The budget below is what it takes to do the next five years properly. It comes to **$2 million**, about $400,000 a year, and the first year needs **$520,000**.',
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
    'If you can help fund this, I would be grateful. If you know the people who can, I would be grateful for an introduction. Either way, the best way to understand the work is to see it, and I would be glad to show you.',
  ],
  signoff: 'With gratitude,',
  signature: {
    name: 'Derek Lomas, PhD',
    role: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
    email: 'team@sourcelibrary.org',
    photo: '/founder-derek.jpg',
  },
  plan: {
    heading: 'The five-year budget: $2 million',
    intro: 'Every line is built from a unit cost we have measured. The first year needs **$520,000**; each year after that, about **$370,000**.',
    items: [
      { work: 'Translate the 72,000 books (16 million pages) we already hold — about 2 cents a page', resource: '$360K' },
      { work: 'Scholars reviewing the translations against the originals, language by language', resource: '$150K' },
      { work: 'Scanning about 2,000 rare books at the Embassy that exist in no other collection', resource: '$130K' },
      { work: 'A director, a part-time engineer to run the pipeline, and a community manager, for five years', resource: '$800K' },
      { work: 'Keeping every page online for five years — hosting, storage, database', resource: '$170K' },
      { work: 'Research commissions, grant-writing, conferences and gatherings at the Embassy', resource: '$150K' },
      { work: 'Legal foundations (entity, trademark, rights policy), administration and contingency', resource: '$240K' },
    ],
    footnote: 'Translation is priced at 2.3 cents a page, above what our pipeline currently costs, to cover retries and the harder scripts. Scanning is $60 a book, all in. Hosting is our measured run rate with room for the collection to grow. The team lines are part-time salaries at Dutch rates. Administration is the Embassy’s fiscal sponsorship. A full line-by-line budget is available on request.',
  },
  ways: {
    heading: 'Ways to take part',
    intro: 'A book costs about $5 to translate. Every gift below is named for you in the register, in perpetuity.',
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
    body: 'I’d be glad to show you the library — in person at the Embassy in Amsterdam, or on a call — and to walk through the budget with you.',
    primaryLabel: 'Let’s talk',
    primaryHref: 'mailto:team@sourcelibrary.org?subject=Source%20Library%20%E2%80%94%20let%E2%80%99s%20talk',
    secondaryLabel: 'Make a gift',
    secondaryHref: '/support',
    footer: 'I read every message myself.',
  },
};
