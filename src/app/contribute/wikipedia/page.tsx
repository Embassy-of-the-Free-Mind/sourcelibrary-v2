import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { WikipediaPlaybook, TalkPagePost } from './WikipediaPlaybook';
import { getDb } from '@/lib/mongodb';

export const metadata: Metadata = {
  title: 'Wikipedia Contributions - Source Library',
  description: 'Help add Source Library translations to Wikipedia, Wikidata, and Wikimedia Commons. Step-by-step guide for volunteers.',
  alternates: {
    canonical: '/contribute/wikipedia',
  },
  openGraph: {
    title: 'Help Bring Historical Texts to Wikipedia',
    description: 'Copy-paste Talk page posts to help Wikipedia readers discover thousands of translated primary sources — Copernicus, Galileo, Kepler, and more.',
  },
  twitter: {
    title: 'Help Bring Historical Texts to Wikipedia',
    description: 'Copy-paste Talk page posts to help Wikipedia readers discover thousands of translated primary sources — Copernicus, Galileo, Kepler, and more.',
  },
};

// Dynamic — DB queries are too slow for build-time prerendering
export const dynamic = 'force-dynamic';

// Config: which books to feature and where to post
const FEATURED_BOOKS: {
  slug: string;
  talkPageUrl: string;
  tier: 1 | 2 | 3;
  wikiTitle: string; // Title to use in wiki markup (may differ from DB title)
  wikiDesc?: string; // Optional extra context for the wiki post
}[] = [
  // Tier 1 — Highest-traffic Wikipedia articles
  {
    slug: 'de-revolutionibus-1543-first-edition-copernicus',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_revolutionibus_orbium_coelestium',
    tier: 1,
    wikiTitle: 'De Revolutionibus (1543 First Edition)',
    wikiDesc: 'page-by-page English translation of the complete 1543 first edition',
  },
  {
    slug: 'sidereus-nuncius-1610-venice-galilei',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Sidereus_Nuncius',
    tier: 1,
    wikiTitle: 'Sidereus Nuncius (1610 Venice)',
    wikiDesc: "page-by-page English translation of Galileo's 1610 text",
  },
  {
    slug: 'kepler-astronomia-nova-1609-prague-kepler',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Astronomia_nova',
    tier: 1,
    wikiTitle: 'Astronomia Nova (1609 Prague)',
    wikiDesc: "page-by-page English translation of Kepler's 1609 text",
  },
  {
    slug: 'vesalius-de-humani-corporis-fabrica-1555-vesalius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_Humani_Corporis_Fabrica_Libri_Septem',
    tier: 1,
    wikiTitle: 'De Humani Corporis Fabrica (1555)',
  },
  {
    slug: 'elements-euclid',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Euclid%27s_Elements',
    tier: 1,
    wikiTitle: 'Elements (1482 edition)',
    wikiDesc: 'page-by-page English translation of the 1482 first printed edition',
  },
  {
    slug: 'three-books-of-occult-philosophy-nettesheim',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Three_Books_of_Occult_Philosophy',
    tier: 1,
    wikiTitle: 'Three Books of Occult Philosophy (1550)',
  },
  {
    slug: 'the-hieroglyphic-monad-dee',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Monas_Hieroglyphica',
    tier: 1,
    wikiTitle: 'Monas Hieroglyphica (1564)',
    wikiDesc: "page-by-page English translation of John Dee's 1564 text",
  },
  {
    slug: 'of-heroic-frenzies-bruno',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_gli_eroici_furori',
    tier: 1,
    wikiTitle: 'De gli eroici furori (Of Heroic Frenzies, 1585)',
  },
  // Tier 2 — Strong candidates
  {
    slug: 'the-great-art-of-light-and-shadow-kircher',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Ars_Magna_Lucis_et_Umbrae',
    tier: 2,
    wikiTitle: 'Ars Magna Lucis et Umbrae (1671)',
  },
  {
    slug: 'lives-and-opinions-of-eminent-philosophers-laertius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Lives_and_Opinions_of_Eminent_Philosophers',
    tier: 2,
    wikiTitle: 'Lives and Opinions of Eminent Philosophers (1570 edition)',
    wikiDesc: 'page-by-page English translation of the 1570 Latin text',
  },
  {
    slug: 'mysterium-cosmographicum-1596-first-edition-kepler',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Mysterium_Cosmographicum',
    tier: 2,
    wikiTitle: 'Mysterium Cosmographicum (1596 First Edition)',
  },
  {
    slug: 'magia-naturalis-libri-xx-1607-porta',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Magia_Naturalis',
    tier: 2,
    wikiTitle: 'Magia Naturalis Libri XX (1607)',
  },
  {
    slug: 'orbis-sensualium-pictus-1659-first-english-comenius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Orbis_Pictus',
    tier: 2,
    wikiTitle: 'Orbis Sensualium Pictus (1659 First English Edition)',
    wikiDesc: 'page-by-page scan with translation',
  },
  {
    slug: 'arcana-coelestia-heavenly-arcana-swedenborg',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Arcana_Coelestia',
    tier: 2,
    wikiTitle: 'Arcana Coelestia (1749)',
  },
  {
    slug: 'alciato-emblemata-1548-lyon-alciato',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Emblemata',
    tier: 2,
    wikiTitle: 'Emblemata (1548 Lyon edition)',
    wikiDesc: 'page-by-page English translation with original woodcuts',
  },
  // Tier 3 — Major author articles
  {
    slug: 'pymander-asclepius-on-the-mysteries-of-the-egyptians-on-trismegistus',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Corpus_Hermeticum',
    tier: 3,
    wikiTitle: 'Pymander, de potestate et sapientia Dei (1532)',
    wikiDesc: 'page-by-page English translation of the 1532 Latin Corpus Hermeticum',
  },
  {
    slug: 'the-notebooks-of-leonardo-da-vinci-richter',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Leonardo_da_Vinci',
    tier: 3,
    wikiTitle: "The Notebooks of Leonardo da Vinci (Richter, 1883)",
    wikiDesc: "complete digitized edition of Jean Paul Richter's compilation",
  },
  {
    slug: 'enneads-1580-basel-editio-princeps-plotinus-ficino',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Enneads',
    tier: 3,
    wikiTitle: 'Plotini Enneades (1580 Basel)',
    wikiDesc: "page-by-page English translation of Ficino's Latin Enneads",
  },
  {
    slug: 'complete-works-1557-basel-edition-pico-della-mirandola',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Giovanni_Pico_della_Mirandola',
    tier: 3,
    wikiTitle: 'Opera Omnia (1557 Basel edition)',
    wikiDesc: "page-by-page English translation of Pico's complete works",
  },
  {
    slug: 'history-of-both-worlds-macrocosm-fludd',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Robert_Fludd',
    tier: 3,
    wikiTitle: 'Utriusque Cosmi Historia Vol. 1 (1617)',
    wikiDesc: 'page-by-page English translation with all illustrations',
  },
];

async function getBookStats() {
  const db = await getDb();
  const slugs = FEATURED_BOOKS.map(b => b.slug);

  const books = await db.collection('books').find(
    { slug: { $in: slugs } },
    { projection: { slug: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_translated: 1, pages_blank: 1, language: 1 } }
  ).toArray();

  const bySlug = new Map(books.map(b => [b.slug, b]));

  // Also get Fludd vol 2 for the combined post
  const fludd2 = await db.collection('books').findOne(
    { slug: 'history-of-both-worlds-microcosm-fludd' },
    { projection: { pages_count: 1, pages_translated: 1, pages_blank: 1 } }
  );

  return { bySlug, fludd2 };
}

interface BookStats { pages_count: number; pages_translated: number; pages_blank?: number; language?: string }

function buildWikiText(config: typeof FEATURED_BOOKS[number], book: BookStats, fludd2?: BookStats | null) {
  const bookUrl = `https://sourcelibrary.org/book/${config.slug}`;
  const denom = Math.max(book.pages_count - (book.pages_blank || 0), 1);
  const pct = book.pages_count > 0 ? Math.round(book.pages_translated / denom * 100) : 0;
  const lang = book.language || 'Latin';
  const langNote = lang !== 'English' ? ` Original ${lang} alongside translation.` : '';
  const desc = config.wikiDesc
    ? `${config.wikiDesc}. ${book.pages_count.toLocaleString()} pages, ${pct}% complete.`
    : `page-by-page English translation. ${book.pages_count.toLocaleString()} pages, ${pct}% complete.`;

  const heading = config.slug.includes('corpus-hermeticum') || config.slug.includes('pymander')
    ? '== External link suggestion: 1532 Latin edition at Source Library =='
    : config.slug.includes('laertius')
    ? '== External link suggestion: 1570 Latin edition translation at Source Library =='
    : config.slug.includes('notebooks-of-leonardo')
    ? "== External link suggestion: Richter's Notebooks of Leonardo at Source Library =="
    : config.slug.includes('enneads')
    ? '== External link suggestion: 1580 Ficino translation at Source Library =='
    : config.slug.includes('pico-della-mirandola')
    ? '== External link suggestion: 1557 Opera Omnia at Source Library =='
    : config.slug.includes('fludd')
    ? '== External link suggestion: Utriusque Cosmi Historia at Source Library =='
    : '== External link suggestion: English translation at Source Library ==';

  let body = `* [${bookUrl} ${config.wikiTitle}] — ${desc}${langNote} Free access, CC-BY-4.0.`;

  // Add Fludd vol 2 if applicable
  if (config.slug === 'history-of-both-worlds-macrocosm-fludd' && fludd2) {
    const f2denom = Math.max(fludd2.pages_count - (fludd2.pages_blank || 0), 1);
    const f2pct = fludd2.pages_count > 0 ? Math.round(fludd2.pages_translated / f2denom * 100) : 0;
    body += `\n* [https://sourcelibrary.org/book/history-of-both-worlds-microcosm-fludd Utriusque Cosmi Historia Vol. 2 (1619)] — ${fludd2.pages_count.toLocaleString()} pages, ${f2pct}% complete.`;
  }

  return `${heading}\n\n{{edit COI}} I'm affiliated with Source Library.\n\n${body}\n\n~~~~`;
}

export default async function WikipediaContributePage() {
  const { bySlug, fludd2 } = await getBookStats();

  const posts = FEATURED_BOOKS.map(config => {
    const book = bySlug.get(config.slug);
    if (!book) return null;

    const blankAdj = Math.max((book.pages_count as number) - ((book.pages_blank as number) || 0), 1);
    const pct = book.pages_count > 0 ? Math.round((book.pages_translated as number) / blankAdj * 100) : 0;
    const bookStats: BookStats = {
      pages_count: book.pages_count as number,
      pages_translated: book.pages_translated as number,
      pages_blank: (book.pages_blank as number) || 0,
      language: book.language as string | undefined,
    };
    const f2Stats: BookStats | null = fludd2 ? {
      pages_count: fludd2.pages_count as number,
      pages_translated: fludd2.pages_translated as number,
      pages_blank: (fludd2.pages_blank as number) || 0,
    } : null;

    return {
      title: config.wikiTitle.replace(/\s*\(\d{4}.*?\)\s*$/, ''),
      author: (book.author as string) || 'Unknown',
      talkPageUrl: config.talkPageUrl,
      bookUrl: `https://sourcelibrary.org/book/${config.slug}`,
      year: (book.published as string) || '',
      pages: book.pages_count as number,
      pct,
      tier: config.tier,
      wikiText: buildWikiText(config, bookStats, config.slug === 'history-of-both-worlds-macrocosm-fludd' ? f2Stats : null),
    };
  }).filter(Boolean) as TalkPagePost[];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Wikipedia Contributions"
          subtitle="Help readers discover thousands of translated historical texts"
        />
      }
      bg="bg-cream"
    >
      <WikipediaPlaybook posts={posts} />
    </ContentPageLayout>
  );
}
