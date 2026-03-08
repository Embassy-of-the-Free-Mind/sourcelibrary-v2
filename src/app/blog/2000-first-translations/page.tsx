import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';
import ConceptGraph from './ConceptGraph';

export const metadata: Metadata = {
  title: '2,000 Books Never Read in English — Source Library',
  description:
    'Data analysis of 2,000+ historical texts receiving their first English translation through AI — from 15th-century alchemical manuscripts to 19th-century Sanskrit treatises.',
  openGraph: {
    title: '2,000 Books Never Read in English',
    description:
      'Data analysis of 2,000+ historical texts receiving their first English translation through AI.',
    images: [
      {
        url: 'https://sourcelibrary.org/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
  },
};

// --- Static data from MongoDB aggregation (March 2026) ---

const DECADES = [
  { d: '1400s', n: 3 }, { d: '1410s', n: 1 }, { d: '1420s', n: 2 },
  { d: '1430s', n: 3 }, { d: '1440s', n: 3 }, { d: '1450s', n: 6 },
  { d: '1460s', n: 4 }, { d: '1470s', n: 9 }, { d: '1480s', n: 11 },
  { d: '1490s', n: 13 }, { d: '1500s', n: 37 }, { d: '1510s', n: 25 },
  { d: '1520s', n: 19 }, { d: '1530s', n: 23 }, { d: '1540s', n: 28 },
  { d: '1550s', n: 68 }, { d: '1560s', n: 42 }, { d: '1570s', n: 37 },
  { d: '1580s', n: 49 }, { d: '1590s', n: 40 }, { d: '1600s', n: 167 },
  { d: '1610s', n: 89 }, { d: '1620s', n: 89 }, { d: '1630s', n: 54 },
  { d: '1640s', n: 42 }, { d: '1650s', n: 62 }, { d: '1660s', n: 49 },
  { d: '1670s', n: 46 }, { d: '1680s', n: 32 }, { d: '1690s', n: 59 },
  { d: '1700s', n: 54 }, { d: '1710s', n: 38 }, { d: '1720s', n: 23 },
  { d: '1730s', n: 29 }, { d: '1740s', n: 28 }, { d: '1750s', n: 43 },
  { d: '1760s', n: 40 }, { d: '1770s', n: 59 }, { d: '1780s', n: 91 },
  { d: '1790s', n: 41 }, { d: '1800s', n: 73 }, { d: '1810s', n: 43 },
  { d: '1820s', n: 53 }, { d: '1830s', n: 39 }, { d: '1840s', n: 26 },
  { d: '1850s', n: 53 }, { d: '1860s', n: 32 }, { d: '1870s', n: 26 },
  { d: '1880s', n: 32 }, { d: '1890s', n: 35 }, { d: '1900s', n: 68 },
  { d: '1910s', n: 22 }, { d: '1920s', n: 7 },
];

const PEAK = 167;

const LANGUAGES = [
  { lang: 'Latin', n: 673, color: '#9e4a3a' },
  { lang: 'German', n: 430, color: '#7c5db5' },
  { lang: 'Chinese', n: 198, color: '#c9a86c' },
  { lang: 'French', n: 183, color: '#8b9a7d' },
  { lang: 'Greek', n: 144, color: '#9e4a3a' },
  { lang: 'Sanskrit', n: 135, color: '#7c5db5' },
  { lang: 'Dutch', n: 75, color: '#c9a86c' },
  { lang: 'Italian', n: 59, color: '#8b9a7d' },
  { lang: 'Syriac', n: 58, color: '#9e4a3a' },
];
const MAX_LANG = 673;

const CATEGORIES = [
  { cat: 'Theology', n: 626 },
  { cat: 'Hermeticism', n: 533 },
  { cat: 'Philosophy', n: 460 },
  { cat: 'History', n: 451 },
  { cat: 'Natural Philosophy', n: 413 },
  { cat: 'Alchemy', n: 298 },
  { cat: 'Mysticism', n: 258 },
  { cat: 'Medicine', n: 210 },
  { cat: 'Astrology', n: 201 },
  { cat: 'Literature', n: 153 },
];
const MAX_CAT = 626;

const CENTURIES = [
  { c: '15th', n: 98 },
  { c: '16th', n: 338 },
  { c: '17th', n: 667 },
  { c: '18th', n: 446 },
  { c: '19th', n: 263 },
  { c: '20th', n: 131 },
];

const GALLERY_IMAGES = [
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d08677f38f6761bc5477/695906c895a91542b28bf73f-0.jpg',
    title: 'Amphitheatre of Eternal Wisdom',
    author: 'Heinrich Khunrath',
    year: 1609,
    slug: 'amphitheatre-of-eternal-wisdom-1609-khunrath',
    desc: 'Alchemical laboratory and oratory',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69593413b282844d7b277aaf/69593413b282844d7b277acb-0.jpg?v=1771877347670',
    title: 'Utriusque Cosmi Historia',
    author: 'Robert Fludd',
    year: 1617,
    slug: 'utriusque-cosmi-historia-tomus-primus-de-macrocosmi-fludd',
    desc: 'The Great Void — Et sic in infinitum',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952dac677f38f6761bc683a/6952dac677f38f6761bc6847-0.jpg?v=1771876133767',
    title: 'History of Both Worlds',
    author: 'Robert Fludd',
    year: 1617,
    slug: 'history-of-both-worlds-macrocosm-fludd',
    desc: 'Integra Naturae Speculum — Mirror of all Nature',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc6751-0.jpg',
    title: 'On the Symmetry of Human Bodies',
    author: 'Albrecht Dürer',
    year: 1532,
    slug: 'on-the-symmetry-of-human-bodies-durer',
    desc: 'Geometric construction of human proportion',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69906f694b3bd4d1fffd0b26/69906f6a4b3bd4d1fffd0b61-3.jpg',
    title: 'Bodleian Library MS. Bodl. 614',
    author: 'Anonymous',
    year: 1150,
    slug: 'bodleian-library-ms-bodl-614-anonymous',
    desc: 'Blemmyes — headless people of classical geography',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952e47c77f38f6761bc7ca8/6952e47c77f38f6761bc7cab-0.jpg',
    title: 'Alchymia',
    author: 'Andreas Libavius',
    year: 1597,
    slug: 'alchymia-comprehensive-treatise-on-alchemy-libavius',
    desc: 'Emblematic frontispiece of alchemical art',
  },
];

const FEATURED_BOOKS = [
  {
    title: 'Two Treatises on the Nature of the Elements',
    author: 'Cornelius Drebbel',
    year: 1628,
    lang: 'Latin',
    pages: 69,
    slug: 'two-treatises-on-the-nature-of-elements-on-the-fifth-essence-drebbel',
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/page-0-nQy7d5HUu3LGHA1xQY1RTMBYq0HGDH-2.jpg',
    summary:
      'Cornelius Drebbel presents a mesmerizing synthesis of natural philosophy and spiritual alchemy, arguing that all matter is animated by a single vital force — the "fifth essence" of perpetual motion.',
  },
  {
    title: 'Key to the Secrets of Nature',
    author: 'Karl von Eckartshausen',
    year: 1804,
    lang: 'Russian',
    pages: 401,
    slug: 'key-to-the-secrets-of-nature-eckartshausen',
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/page-0-2DDGT0exDzEMzXPUVPrQTxM2o5b7J8.jpg',
    summary:
      'Karl von Eckartshausen challenges the "proud scholar" to step beyond the library and encounter nature directly through inner illumination and spiritual experiment.',
  },
  {
    title: 'On the Mysteries',
    author: 'Marsilio Ficino',
    year: 1497,
    lang: 'Latin',
    pages: 40,
    slug: 'on-the-mysteries-ficino',
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/page-1-FDGVpTjSH5HFnHw0ONHK2WyMRNvuwL-2.jpg',
    summary:
      'In this profound exploration, Marsilio Ficino navigates the tension between earthly desire and divine contemplation — a philosophical meditation on beauty, love, and the soul\'s ascent.',
  },
  {
    title: 'History of Both Worlds: Macrocosm',
    author: 'Robert Fludd',
    year: 1617,
    lang: 'Latin',
    pages: 1036,
    slug: 'history-of-both-worlds-macrocosm-fludd',
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/page-0-IbplQCRs2ZghXqZCxqSaotSvnvLZK0-2.jpg',
    summary:
      'The pinnacle of Paracelsian cosmology — Fludd\'s encyclopedic vision of the universe as a living organism, illustrated with 60+ engravings mapping the correspondences between macrocosm and microcosm.',
  },
];

function centuryColor(decade: string): string {
  const year = parseInt(decade);
  if (year < 1500) return '#8b9a7d';
  if (year < 1600) return '#7c5db5';
  if (year < 1700) return '#9e4a3a';
  if (year < 1800) return '#c9a86c';
  if (year < 1900) return '#6b6560';
  return '#444';
}

export default function TwoThousandFirstTranslations() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader title="2,000 Books Never Read in English" subtitle="Source Library">
          <p className="text-stone-400 text-sm mt-4">
            March 2026 &middot; 8 min read
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="max-w-3xl mx-auto px-4 pb-16">
        {/* Intro */}
        <div className="prose prose-stone max-w-none text-base leading-relaxed">
          <p className="text-lg leading-relaxed">
            Source Library has now produced the first English translations of over 2,000
            historical texts — works that have waited centuries for an audience beyond
            the small circle of scholars who could read them in their original languages.
            Latin alchemical treatises, German Rosicrucian manifestos, Chinese medical
            classics, Sanskrit philosophical works, Hebrew Kabbalistic commentaries,
            Syriac theological disputations. Most were printed once, in small runs,
            for audiences that no longer exist.
          </p>
          <p>
            This post is a data portrait of those 2,000+ books: when they were written,
            in what languages, about what subjects, and how their ideas connect to each
            other across centuries and traditions.
          </p>
        </div>

        {/* Stat grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-10">
          {[
            { label: 'First Translations', value: '2,229' },
            { label: 'Fully Translated', value: '457' },
            { label: 'Total Pages', value: '889K' },
            { label: 'Languages', value: '30+' },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white border border-[#e8e4dc] rounded-lg p-4 text-center"
            >
              <div className="text-2xl font-serif font-semibold text-[#1a1612]">
                {s.value}
              </div>
              <div className="text-xs text-stone-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Concept graph */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-12 mb-2">
          The Shape of Hidden Knowledge
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-4">
          <p>
            What do 2,000 untranslated books talk about? We indexed every concept
            mentioned across 1,509 of these works and mapped how often they appear
            together. The result is a network of ideas — a map of intellectual
            territory that has been largely invisible to English-speaking scholarship.
          </p>
          <p>
            The dense cluster at center is the alchemical operations:{' '}
            <em>calcination</em>, <em>sublimation</em>, <em>putrefaction</em>,{' '}
            <em>tincture</em> — the procedural vocabulary of transformation that
            connected hundreds of authors across three centuries. Orbiting this core
            are the Hermetic concepts that gave alchemy its philosophical framework:{' '}
            the <em>Philosopher&apos;s Stone</em>, the <em>Microcosm</em>,{' '}
            <em>Kabbalah</em>. Further out, a distinct theological cluster emerges —{' '}
            <em>Providence</em>, <em>Idolatry</em>, <em>Martyrdom</em> — reminding
            us that many of these "occult" texts were written by deeply religious
            authors wrestling with orthodoxy.
          </p>
        </div>

        <ConceptGraph />

        {/* Decade histogram */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          When Were They Written?
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            The spike at 1600 is unmistakable. The turn of the 17th century was the
            golden age of esoteric publishing — Paracelsian medicine, Rosicrucian
            manifestos, Hermetic philosophy, alchemical compendia all surged
            simultaneously. The secondary peak in the 1780s reflects Enlightenment-era
            natural philosophy and the revival of interest in ancient texts. What
            survived in library vaults but never crossed the language barrier is
            overwhelmingly concentrated in these two periods.
          </p>
        </div>

        <div className="bg-white border border-[#e8e4dc] rounded-lg p-4 sm:p-6 overflow-x-auto">
          <div className="flex items-end gap-[2px] min-w-[600px]" style={{ height: 200 }}>
            {DECADES.map((d) => {
              const h = (d.n / PEAK) * 180;
              return (
                <div
                  key={d.d}
                  className="flex-1 relative group"
                  style={{ height: 180 }}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-opacity"
                    style={{
                      height: h,
                      backgroundColor: centuryColor(d.d),
                      opacity: 0.85,
                    }}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1a1612] text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                    {d.d}: {d.n}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between min-w-[600px] mt-2 text-xs text-stone-400">
            <span>1400</span>
            <span>1500</span>
            <span>1600</span>
            <span>1700</span>
            <span>1800</span>
            <span>1900</span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 justify-center text-xs">
            {[
              { label: '15th c.', color: '#8b9a7d' },
              { label: '16th c.', color: '#7c5db5' },
              { label: '17th c.', color: '#9e4a3a' },
              { label: '18th c.', color: '#c9a86c' },
              { label: '19th c.', color: '#6b6560' },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-stone-500">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Century breakdown */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-6">
          {CENTURIES.map((c) => (
            <div key={c.c} className="text-center">
              <div className="text-lg font-semibold text-[#1a1612]">{c.n}</div>
              <div className="text-xs text-stone-500">{c.c} century</div>
            </div>
          ))}
        </div>

        {/* Languages */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          What Languages?
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            Latin dominates — the lingua franca of European scholarship until the
            18th century. But the collection reaches far beyond Europe: 198 Chinese
            texts (medicine, divination, natural philosophy), 135 Sanskrit works
            (Vedic commentary, Ayurvedic medicine, astronomical treatises), 58 Syriac
            theological texts. These represent intellectual traditions that developed
            in parallel, occasionally intersecting through translation and trade.
          </p>
        </div>

        <div className="space-y-2">
          {LANGUAGES.map((l) => (
            <div key={l.lang} className="flex items-center gap-3">
              <div className="w-20 text-sm text-stone-600 text-right shrink-0">
                {l.lang}
              </div>
              <div className="flex-1 h-7 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${(l.n / MAX_LANG) * 100}%`,
                    backgroundColor: l.color,
                    opacity: 0.8,
                  }}
                />
              </div>
              <div className="w-10 text-sm text-stone-500 tabular-nums">{l.n}</div>
            </div>
          ))}
        </div>

        {/* Categories */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          What Subjects?
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            Categories overlap — a single book can be theology, alchemy, and
            natural philosophy simultaneously. That&apos;s the point. The modern
            separation of these fields hadn&apos;t happened yet. Paracelsus wrote
            about medicine and mysticism in the same paragraph. Kircher mapped
            Egyptian hieroglyphics, Chinese characters, and magnetic forces as
            aspects of one universal system. These books resist neat classification
            because their authors saw the world as fundamentally interconnected.
          </p>
        </div>

        <div className="space-y-2">
          {CATEGORIES.map((c) => (
            <div key={c.cat} className="flex items-center gap-3">
              <div className="w-32 text-sm text-stone-600 text-right shrink-0">
                {c.cat}
              </div>
              <div className="flex-1 h-6 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(c.n / MAX_CAT) * 100}%`,
                    backgroundColor: '#9e4a3a',
                    opacity: 0.7,
                  }}
                />
              </div>
              <div className="w-10 text-sm text-stone-500 tabular-nums">{c.n}</div>
            </div>
          ))}
        </div>

        {/* Gallery */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          What Do They Look Like?
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            These books are visual objects — hand-engraved illustrations, emblematic
            frontispieces, cosmological diagrams, alchemical symbols. Our AI image
            extraction has catalogued over 73,000 illustrations across the collection.
            Here are some of the finest from the first-translation corpus.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {GALLERY_IMAGES.map((img) => (
            <Link
              key={img.slug}
              href={`https://sourcelibrary.org/book/${img.slug}`}
              className="group block"
            >
              <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-[#f5f0e8] border border-[#e8e4dc]">
                <Image
                  src={img.url}
                  alt={`${img.title} by ${img.author} (${img.year})`}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 640px) 50vw, 33vw"
                />
              </div>
              <div className="mt-2">
                <div className="text-sm font-medium text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors leading-tight">
                  {img.title}
                </div>
                <div className="text-xs text-stone-500">
                  {img.author}, {img.year}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Featured books */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          Start Reading
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            These are fully translated and ready to read — first English translations
            of works that have shaped intellectual history but remained inaccessible
            to most readers.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURED_BOOKS.map((book) => (
            <Link
              key={book.slug}
              href={`https://sourcelibrary.org/book/${book.slug}`}
              className="group flex gap-3 bg-white border border-[#e8e4dc] rounded-lg p-3 hover:border-[#9e4a3a]/30 transition-colors"
            >
              <div className="w-16 h-20 relative rounded overflow-hidden shrink-0 bg-[#f5f0e8]">
                <Image
                  src={book.thumb}
                  alt={book.title}
                  fill
                  className="object-cover"
                  sizes="64px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors leading-tight">
                  {book.title}
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {book.author}, {book.year} &middot; {book.lang} &middot;{' '}
                  {book.pages} pages
                </div>
                <p className="text-xs text-stone-600 mt-1.5 line-clamp-3 leading-relaxed">
                  {book.summary}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* Page size distribution */}
        <h2 className="text-2xl font-serif font-semibold text-[#1a1612] mt-14 mb-2">
          How Long Are They?
        </h2>
        <div className="prose prose-stone max-w-none text-base leading-relaxed mb-6">
          <p>
            These aren&apos;t pamphlets. The median book is 220 pages, and 113 books
            exceed 1,000 pages — massive compendia like Fludd&apos;s 1,036-page
            cosmology or multi-volume theological disputations. Translating a
            1,000-page 17th-century Latin text would take a human scholar years of
            work. The AI pipeline processes them in hours.
          </p>
        </div>

        <div className="bg-white border border-[#e8e4dc] rounded-lg p-4">
          <div className="flex items-end gap-2 justify-center" style={{ height: 140 }}>
            {[
              { label: '<50', n: 137 },
              { label: '50-100', n: 259 },
              { label: '100-200', n: 376 },
              { label: '200-300', n: 263 },
              { label: '300-400', n: 264 },
              { label: '400-500', n: 214 },
              { label: '500-750', n: 374 },
              { label: '750-1K', n: 193 },
              { label: '1K+', n: 119 },
            ].map((b) => {
              const h = (b.n / 376) * 120;
              return (
                <div key={b.label} className="flex flex-col items-center flex-1">
                  <div className="text-xs text-stone-400 mb-1">{b.n}</div>
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: h,
                      backgroundColor: '#9e4a3a',
                      opacity: 0.7,
                    }}
                  />
                  <div className="text-[10px] text-stone-500 mt-1 whitespace-nowrap">
                    {b.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-center text-xs text-stone-400 mt-2">Pages per book</div>
        </div>

        {/* Methodology link */}
        <div className="mt-14 bg-[#f5f0e8] border border-[#e8e4dc] rounded-lg p-6">
          <h3 className="text-lg font-serif font-semibold text-[#1a1612] mb-2">
            How do we know these are first translations?
          </h3>
          <p className="text-sm text-stone-600 leading-relaxed mb-3">
            Each book goes through a multi-stage AI verification pipeline: OCR-based
            language classification, LLM deep knowledge checks against known
            translation catalogs, and manual review for edge cases. The system
            identifies six confidence levels from &quot;confirmed first&quot; to
            &quot;has existing translation.&quot;
          </p>
          <Link
            href="https://sourcelibrary.org/blog/first-translation-methodology"
            className="text-sm font-medium text-[#9e4a3a] hover:underline"
          >
            Read the full methodology
          </Link>
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link
            href="https://sourcelibrary.org/blog/first-translations"
            className="inline-block bg-[#9e4a3a] text-white font-medium text-sm px-6 py-2.5 rounded-lg hover:bg-[#8a3f31] transition-colors"
          >
            Browse all first translations
          </Link>
          <p className="text-xs text-stone-400 mt-3">
            All translations are{' '}
            <Link
              href="https://sourcelibrary.org/data"
              className="underline hover:text-stone-600"
            >
              freely available as open data
            </Link>
            .
          </p>
        </div>

        {/* Comments */}
        <div className="mt-16">
          <BlogComments slug="2000-first-translations" />
        </div>
      </div>
    </ContentPageLayout>
  );
}
