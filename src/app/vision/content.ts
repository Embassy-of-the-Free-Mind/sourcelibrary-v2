// ── Vision page content ──────────────────────────────────────────────────
// This object is the single source of truth for all the text on /vision.
// Edit it here directly, OR use the in-browser editor at /vision?edit:
// change the text on the page, click "Copy JSON", and paste the result back
// over `visionContent` below (then redeploy). Collaborators can do the same
// and send you their JSON.
//
// Light formatting inside any text field: **bold**, *italic*, [label](url).

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
  dateline: 'Amsterdam, June 2026',
  salutation: 'Dear friend,',
  lead: 'The last time the world translated its ancient wisdom, it set off the Renaissance. I think we can do it again — this time for the age of AI.',
  bodyBeforeQuote: [
    'That first Renaissance began with an act of translation. When a small circle in fifteenth-century Florence brought Plato and the Hermetic writings out of Greek into Latin, they set loose ideas that reshaped a civilization. Throughout history, the recovery of ancient works has consistently sparked humanity’s most profound and enduring insights.',
    'And yet the Renaissance itself was written largely in Latin. As the UCLA Renaissance scholar Debora Shuger has observed, **“90 percent of the Latin texts from the Renaissance have never been available in translation”** ([UCLA, 2012](https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883)). The rest is legible only to specialists. Beyond it lie thousands upon thousands of texts in Chinese, Sanskrit, Arabic, Hebrew, Egyptian, and more — and most of this heritage is missing from the data that trains today’s AI.',
    'As we enter an uncertain age, a strong foundation in wisdom — and the preservation of our full inheritance — has never felt more pressing. Maybe, just maybe, translating the world’s ancient wisdom could make a global AI renaissance more likely than an AI apocalypse. Perhaps that is magical thinking. But what is magic, anyway? I went looking in our own library, and found a lovely answer from Pico della Mirandola.',
  ],
  quote: {
    en: 'Magic does not so much work wonders as serve nature while she works them.',
    la: 'Non tam facit miranda quam facienti naturæ sedula famulatur.',
    source: 'Giovanni Pico della Mirandola, *Oration on the Dignity of Man* (1496)',
    url: '/q/Bek54SCHDUKr4EJMnM4',
    linkLabel: 'read it at the source',
  },
  bodyBeforeImage1: [
    'That is the whole idea behind Source Library: to go back to the source, and to make it possible for anyone — any reader, any scholar, any AI — to do the same. Today it is the world’s largest library of translated ancient texts: more than **15,000 books** from over fifty languages, more than half of them into English for the first time. Our word count has already passed English Wikipedia.',
    'Every translation sits beside the original scanned page, so any line can be verified, quoted, and trusted. It is almost entirely free, Creative Commons share-alike, and open by API and MCP — so that the AI you use can reach for the actual source.',
  ],
  image1: {
    src: 'https://images.sourcelibrary.org/pages/69520c46ab34727b1f044141/0019.jpg',
    alt: "An emblem from Michael Maier's Atalanta Fugiens (1618)",
    caption: 'One of thousands of pages now readable and quotable — an emblem from Maier’s *Atalanta Fugiens*, 1618.',
    href: '/book/atalanta-fleeing-new-chemical-emblems-of-the-secrets-of-maier/page/69520c46ab34727b1f044154',
  },
  bodyAfterImage1: [
    'We are embedded within one of the world’s great collections of ancient texts: the [Embassy of the Free Mind](https://embassyofthefreemind.com) in Amsterdam, home to the Bibliotheca Philosophica Hermetica, a UNESCO “Memory of the World” rare-book library. Source Library was created with the support of the Wisdom Frontiers Society of La Jolla, California, and the Gambrell Foundation, and runs as an open initiative of the Embassy, a Dutch nonprofit with 501(c)(3) status. You can make a tax-deductible gift [here](/support).',
  ],
  buildHeading: 'Building something lasting',
  bodyBuild: [
    'Everything so far has been made possible by a handful of people who believed in the work early. Now I want to build something enduring: a world-class humanist institution devoted to the stewardship of ancient wisdom — from books to oral histories to expeditions in the field. The wisdom, after all, is more than the books.',
    'I want our founding donors to feel that directly. Picture an evening in the Bibliotheca with the original volumes of Fludd and Ficino open in front of you; an expedition to scan a monastery’s manuscripts before they’re lost; a hand in deciding what humanity translates next; and your name on the work, in perpetuity. I want them in the room, not just on the donor wall.',
  ],
  montage: {
    images: [
      { src: '/vision/embassy.jpg', alt: 'The Embassy of the Free Mind, Amsterdam' },
      { src: '/vision/bibliotheca.jpg', alt: 'Guests in the Bibliotheca Philosophica Hermetica' },
      { src: '/vision/ficino.jpg', alt: 'Bust of Marsilio Ficino at the Embassy of the Free Mind' },
      { src: '/vision/embassy-crowd.jpg', alt: 'A gathering outside the Embassy of the Free Mind, Amsterdam' },
    ],
    caption: 'The Embassy of the Free Mind, Amsterdam — home of the Bibliotheca Philosophica Hermetica, and the community gathering around it.',
  },
  bodyConvener: [
    'And here is the real reason I’m writing to you. I’m not only hoping for your support — I’m hoping you’ll help us *gather* the founding circle, not just join it. If you’re someone who brings remarkable people together around bold ideas, then helping convene the people who will steward humanity’s wisdom for the next century is something you’d be extraordinary at. I’d love to do it with you.',
  ],
  signoff: 'With gratitude,',
  signature: {
    name: 'Derek Lomas, PhD',
    role: 'Founder, Source Library · Asst. Professor of Positive AI, TU Delft',
    email: 'derek@sourcelibrary.org',
    photo: '/founder-derek.jpg',
  },
  plan: {
    heading: 'Year One',
    intro: 'This is **Year One** of a five-year build. The full vision — translating hundreds of thousands of works, scanning tens of thousands that have never been online, partnering with a thousand libraries — is roughly a **$15 million** undertaking. But it starts with proving the engine. We are raising a **first round of $1 million** to run Source Library as a real institution for its first year (it costs about **$550,000 a year**), make good on the six months of work already delivered, and hold a reserve for the next. Here is what that first million builds.',
    items: [
      { work: 'A small founding team — a director, a scanning specialist at the Embassy, community & partnerships, and visiting scholars', resource: '$500K' },
      { work: 'Core technology & AI translation infrastructure — engineering, and keeping every page online', resource: '$270K' },
      { work: 'Begin a Spanish edition of the library — AI-drafted across the collection, validated by expert translators', resource: '$25K' },
      { work: 'Begin expert validation of our Tibetan translations — Tibetan scholars checking the AI against the canon', resource: '$10K' },
      { work: 'A first expedition — endangered Javanese manuscripts with Javanologi (UNS) and B-NICE Amsterdam', resource: '$60K' },
      { work: 'Contingency and a reserve into year two', resource: '$135K' },
    ],
    footnote: 'These figures are illustrative of the scale of the work, not a fixed budget. Prove the engine in year one and the rest follows: over five years, hundreds of thousands of works translated and checked by experts into every major language, tens of thousands scanned for the first time, a thousand libraries joined together, and an endowment to keep it all online for good — the full **$15 million** vision, and the permanence it secures. More than half of this first round funds people, because the careful act of bringing an irreplaceable book into the light — and the scholars who validate every translation — is the part AI cannot do.',
  },
  ways: {
    heading: 'A place in the lineage',
    intro: 'The men and women who translated the last Renaissance are five centuries gone — and their names are still on the work. This is your turn. Every gift below rescues real books and carries your name with them, in perpetuity.',
    tiers: [
      { gift: '$275', label: 'Adopt a rare manuscript — one irreplaceable hand-written treasure brought to the world, named for you' },
      { gift: '$8,500', label: 'A named shelf — 100 books rescued, translated, and yours to name' },
      { gift: '$60K', label: 'Underwrite the Javanese expedition — rescue endangered manuscripts before they are lost' },
      { gift: '$80K', label: 'A named wing — 1,000 books of the digital library' },
      { gift: 'from $150K', label: 'Underwrite a language edition — bring the entire library into Spanish (or Arabic, Hindi, and beyond), expert-validated, your name on it' },
      { gift: '$250K', label: 'Founding patron — underwrite all of Year One; your name on the institution, and a hand in what we translate next' },
    ],
    footnote: 'Every tier funds the people and the careful work behind it — the digitizer at the Embassy, the scholars who validate, the pipeline that keeps each page online. You are not funding overhead; you are rescuing a book for the world, with your name beside it.',
  },
  cta: {
    heading: 'Let’s talk',
    body: 'The best way to understand this is to see it. I’d love to show you the library — in person at the Embassy in Amsterdam, or on a call — and talk about what becoming a founding donor could look like for you.',
    primaryLabel: 'Let’s talk',
    primaryHref: 'mailto:derek@sourcelibrary.org?subject=Source%20Library%20%E2%80%94%20let%E2%80%99s%20talk',
    secondaryLabel: 'Make a gift',
    secondaryHref: '/support',
    footer: 'All gifts are tax-deductible in the US and the Netherlands. I read every message myself.',
  },
};
