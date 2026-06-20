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
    url: 'https://sourcelibrary.org/q/Bek54SCHDUKr4EJMnM4',
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
    href: '/book/atalanta-fleeing-new-chemical-emblems-of-the-secrets-of-maier/page/19',
  },
  bodyAfterImage1: [
    'We are embedded within one of the world’s great collections of ancient texts: the [Embassy of the Free Mind](https://embassyofthefreemind.com) in Amsterdam, home to the Bibliotheca Philosophica Hermetica, a UNESCO “Memory of the World” rare-book library. Source Library was created with the support of the Wisdom Frontiers Society of La Jolla, California, and runs as an open initiative of the Embassy, a Dutch nonprofit with 501(c)(3) status. You can make a tax-deductible gift [here](/support).',
  ],
  buildHeading: 'What I want to build',
  bodyBuild: [
    'Everything so far has been made possible by a handful of people who believed in the work early. Now I want to build something lasting: a world-class humanist institution devoted to the stewardship of ancient wisdom — from books to oral histories to expeditions in the field. The wisdom, after all, is more than the books.',
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
    heading: 'A brief plan',
    intro: 'Over the next five years we aim to grow Source Library into a permanent institution. We are seeking roughly **$15 million** in philanthropic support to make it possible. Here is the work, and what each part of it asks for.',
    items: [
      { work: 'Translate 250,000+ more ancient works', resource: '$1M' },
      { work: 'Scan 50,000+ works that have never been online', resource: '$3M' },
      { work: 'Partner with 1,000+ libraries and archives worldwide', resource: '$2M' },
      { work: 'Convene a braintrust of linguists and scholars', resource: '$2M' },
      { work: 'Build a technical foundation that will last', resource: '$1M' },
      { work: 'Gatherings and expeditions to bring the community together', resource: '$2M' },
      { work: 'A small full-time team and direct support for partner libraries', resource: '$4M' },
    ],
    footnote: 'These figures are illustrative of the scale of the work, not a fixed budget. As much as they fund translation and scanning, they sustain people: the gatherings that bring the community together, the expeditions that gather and preserve materials, and the libraries we partner with around the world.',
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
