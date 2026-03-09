import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';
import InputWidget from '@/components/InputWidget';

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
  { d: '1580s', n: 49 }, { d: '1590s', n: 40 }, { d: '1600s', n: 74 },
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

const PEAK = 91;

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
  { c: '17th', n: 574 },
  { c: '18th', n: 446 },
  { c: '19th', n: 263 },
  { c: '20th', n: 131 },
];

const GALLERY_IMAGES = [
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d08677f38f6761bc5477/695906c895a91542b28bf73e-0.jpg',
    title: 'Amphitheatre of Eternal Wisdom',
    author: 'Heinrich Khunrath',
    year: 1609,
    slug: 'amphitheatre-of-eternal-wisdom-1609-khunrath',
    desc: 'Porta Amphitheatri — Gate of the Amphitheatre of Wisdom',
  },
  {
    url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69593413b282844d7b277aaf/69593413b282844d7b277ab0-0.jpg?v=1771877346999',
    title: 'Utriusque Cosmi Historia',
    author: 'Robert Fludd',
    year: 1617,
    slug: 'utriusque-cosmi-historia-tomus-primus-de-macrocosmi-fludd',
    desc: 'Cosmological frontispiece — macrocosm and microcosm',
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

// Source work dates — ideas that waited millennia for English translation
const TIME_TRAVELERS = [
  { title: "Plato's Timaeus (Ficino)", composition: -360, printed: 1484, gap: 1844, author: 'Plato / Ficino', lang: 'Latin', slug: 'complete-works-of-plato-plato' },
  { title: "Euclid's Elements", composition: -300, printed: 1482, gap: 1782, author: 'Euclid', lang: 'Latin', slug: 'elements-of-geometry-euclid' },
  { title: 'Demotic Magical Papyrus', composition: -200, printed: 1629, gap: 1829, author: 'Anonymous', lang: 'Greek', slug: 'demotic-magical-papyrus-anonymous' },
  { title: 'Corpus Hermeticum', composition: 200, printed: 1471, gap: 1271, author: 'Hermes Trismegistus', lang: 'Latin', slug: 'pimander-hermes-trismegistus' },
  { title: 'Plotinus Enneads', composition: 270, printed: 1492, gap: 1222, author: 'Plotinus / Ficino', lang: 'Latin', slug: 'complete-works-of-plotinus-plotinus' },
  { title: 'Sepher Yetzirah', composition: 300, printed: 1552, gap: 1252, author: 'Anonymous', lang: 'Hebrew', slug: 'book-of-creation-anonymous' },
  { title: 'Book of the Dead (Egyptian)', composition: -1500, printed: 1842, gap: 3342, author: 'Anonymous', lang: 'Egyptian', slug: '' },
];

const GAP_DISTRIBUTION = [
  { label: 'Same era (<100 years)', count: 1207, color: '#8b9a7d' },
  { label: '100–500 years', count: 169, color: '#c9a86c' },
  { label: '500–1,000 years', count: 50, color: '#7c5db5' },
  { label: '1,000–2,000 years', count: 155, color: '#9e4a3a' },
  { label: '2,000+ years', count: 24, color: '#1a1612' },
];

// Top authors by book count (excluding Chinese compilations and anonymous)
const TOP_AUTHORS = [
  { name: 'Athanasius Kircher', n: 23, desc: 'Jesuit polymath — Egypt, music, magnetism, geology', color: '#9e4a3a' },
  { name: 'Christiaan Huygens', n: 23, desc: 'Optics, astronomy, mechanics, probability', color: '#8b9a7d' },
  { name: 'Roger Bacon', n: 17, desc: 'Franciscan friar — optics, alchemy, natural philosophy', color: '#7c5db5' },
  { name: 'Karl von Eckartshausen', n: 17, desc: 'Bavarian mystic — magic, theosophy, inner light', color: '#c9a86c' },
  { name: 'Pierre Gassendi', n: 14, desc: 'Epicurean revival — astronomy, atomism', color: '#8b9a7d' },
  { name: 'Robert Fludd', n: 13, desc: 'Hermetic cosmology — macrocosm, microcosm, music', color: '#7c5db5' },
  { name: 'Gustav Fechner', n: 12, desc: 'Psychophysics — consciousness, panpsychism', color: '#c9a86c' },
  { name: 'Leonardo da Vinci', n: 9, desc: 'Notebooks — anatomy, mechanics, observation', color: '#9e4a3a' },
];
const MAX_AUTHOR = 23;

// Category co-occurrence — subjects that appear together
const COOCCURRENCES = [
  { a: 'Alchemy', b: 'Hermeticism', n: 211 },
  { a: 'Philosophy', b: 'Theology', n: 165 },
  { a: 'Mysticism', b: 'Theology', n: 164 },
  { a: 'Hermeticism', b: 'Natural Philosophy', n: 162 },
  { a: 'Alchemy', b: 'Natural Philosophy', n: 152 },
  { a: 'Hermeticism', b: 'Philosophy', n: 139 },
  { a: 'Alchemy', b: 'Philosophy', n: 134 },
  { a: 'Hermeticism', b: 'Theology', n: 130 },
  { a: 'Alchemy', b: 'Medicine', n: 128 },
  { a: 'Hermeticism', b: 'Mysticism', n: 117 },
];
const MAX_COOC = 211;

// Most read first translations
const MOST_READ = [
  { title: 'Introduction to Primitive Cabalistic Science', reads: 47, author: 'M.C. de Grinaud', year: 1868, slug: 'introduction-to-primitive-cabalistic-science-grinaud' },
  { title: 'Two Treatises on the Nature of the Elements', reads: 46, author: 'Cornelius Drebbel', year: 1628, slug: 'two-treatises-on-the-nature-of-elements-on-the-fifth-essence-drebbel' },
  { title: 'Key to the Secrets of Nature', reads: 43, author: 'Karl von Eckartshausen', year: 1804, slug: 'key-to-the-secrets-of-nature-eckartshausen' },
  { title: 'Great Art of Light and Shadow', reads: 32, author: 'Athanasius Kircher', year: 1646, slug: 'great-art-of-light-and-shadow-kircher' },
  { title: 'Lives of the Eminent Philosophers', reads: 27, author: 'Diogenes Laertius', year: 1692, slug: 'lives-of-eminent-philosophers-diogenes-laertius' },
  { title: 'Universal Music-Making', reads: 25, author: 'Athanasius Kircher', year: 1650, slug: 'universal-music-making-kircher' },
  { title: 'On the Mysteries', reads: 24, author: 'Marsilio Ficino', year: 1497, slug: 'on-the-mysteries-ficino' },
  { title: 'Pimander (Corpus Hermeticum)', reads: 23, author: 'Hermes Trismegistus', year: 1471, slug: 'pimander-hermes-trismegistus' },
];
const MAX_READS = 47;

// Source providers
const PROVIDERS = [
  { name: 'Internet Archive', n: 1252, color: '#9e4a3a' },
  { name: 'Embassy of the Free Mind', n: 788, color: '#7c5db5' },
  { name: 'Bibliothèque nationale de France', n: 91, color: '#c9a86c' },
  { name: 'Bavarian State Library', n: 58, color: '#8b9a7d' },
  { name: 'Vatican Library', n: 42, color: '#9e4a3a' },
  { name: 'Cambridge University Library', n: 36, color: '#7c5db5' },
  { name: 'Google Books', n: 29, color: '#c9a86c' },
  { name: 'Bodleian Library (Oxford)', n: 18, color: '#8b9a7d' },
  { name: 'Library of Congress', n: 13, color: '#9e4a3a' },
  { name: 'Swiss e-rara', n: 9, color: '#7c5db5' },
];
const MAX_PROVIDER = 1252;

const FEATURED_BOOKS = [
  {
    title: 'Two Treatises on the Nature of the Elements',
    author: 'Cornelius Drebbel',
    year: 1628,
    lang: 'Latin',
    pages: 69,
    slug: 'two-treatises-on-the-nature-of-elements-on-the-fifth-essence-drebbel',
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/thumbnails/6836f8ee811c8ab472a49e36/1.jpg',
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
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/cropped/69099634cf28baa1b4cae779/69099653cf28baa1b4cae787.jpg',
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
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/912cf0da-035c-425b-8975-e5a195a47767/6959afa11dfc1806c080bc8c-0.jpg',
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
    thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69593413b282844d7b277aaf/1.jpg',
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
            March 2026 &middot; 12 min read
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="max-w-5xl mx-auto px-4 pb-16">
        {/* Intro */}
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed">
          <p className="text-xl leading-relaxed">
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
            { label: 'First Translations', value: '2,446' },
            { label: 'Fully Translated', value: '457' },
            { label: 'Total Pages', value: '889K' },
            { label: 'Languages', value: '30+' },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white border border-[#e8e4dc] rounded-lg p-5 text-center"
            >
              <div className="text-4xl font-serif font-semibold text-[#1a1612]">
                {s.value}
              </div>
              <div className="text-base text-stone-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Decade histogram */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          When Were They Written?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            The 17th century dominates. The decades from 1600 to 1630 mark the
            golden age of esoteric publishing — Paracelsian medicine, Rosicrucian
            manifestos, Hermetic philosophy, alchemical compendia all surged
            simultaneously. A second peak in the 1780s reflects Enlightenment-era
            natural philosophy and the revival of interest in ancient texts. What
            survived in library vaults but never crossed the language barrier is
            overwhelmingly concentrated in these two periods.
          </p>
        </div>

        <div className="bg-white border border-[#e8e4dc] rounded-lg p-5 sm:p-8 overflow-x-auto">
          <div className="flex items-end gap-[2px] min-w-[600px]" style={{ height: 320 }}>
            {DECADES.map((d) => {
              const h = (d.n / PEAK) * 280;
              return (
                <div
                  key={d.d}
                  className="flex-1 relative group"
                  style={{ height: 280 }}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-opacity"
                    style={{
                      height: h,
                      backgroundColor: centuryColor(d.d),
                      opacity: 0.85,
                    }}
                  />
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block bg-[#1a1612] text-white text-sm rounded px-2 py-1 whitespace-nowrap z-10">
                    {d.d}: {d.n}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between min-w-[600px] mt-3 text-sm text-stone-500">
            <span>1400</span>
            <span>1500</span>
            <span>1600</span>
            <span>1700</span>
            <span>1800</span>
            <span>1900</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 mt-4 justify-center text-sm">
            {[
              { label: '15th c.', color: '#8b9a7d' },
              { label: '16th c.', color: '#7c5db5' },
              { label: '17th c.', color: '#9e4a3a' },
              { label: '18th c.', color: '#c9a86c' },
              { label: '19th c.', color: '#6b6560' },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-stone-600">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Century breakdown */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mt-8">
          {CENTURIES.map((c) => (
            <div key={c.c} className="text-center">
              <div className="text-2xl font-semibold text-[#1a1612]">{c.n}</div>
              <div className="text-sm text-stone-500">{c.c} century</div>
            </div>
          ))}
        </div>

        {/* Time Travelers — the WOW section */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          Ideas That Waited Millennia
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p className="text-xl leading-relaxed">
            Some of these books carry ideas far older than the books themselves.
            Plato&apos;s <em>Timaeus</em>, written in 360 BCE, didn&apos;t reach print
            until Ficino&apos;s Latin translation in 1484 — a gap of over 1,800 years.
            The <em>Demotic Magical Papyrus</em>, composed around 200 BCE, waited until
            1629 to appear in a printed edition. These are not just old books — they are
            vessels for ideas that have traveled across millennia, and are now being read
            in English for the first time.
          </p>
        </div>

        {/* Timeline visualization */}
        <div className="bg-white border border-[#e8e4dc] rounded-lg p-6 sm:p-8 overflow-x-auto">
          <div className="min-w-[700px]">
            {/* Header row */}
            <div className="flex items-center gap-2 mb-6 text-base text-stone-500">
              <span className="w-[200px] shrink-0 text-right">Composed</span>
              <div className="flex-1 text-center font-medium text-stone-400">Gap (years)</div>
              <span className="w-[100px] shrink-0">Printed</span>
            </div>
            {TIME_TRAVELERS.filter(t => t.slug).map((t) => {
              const maxGap = 3342;
              const barWidth = (t.gap / maxGap) * 100;
              return (
                <div key={t.title} className="flex items-center gap-2 mb-3 group">
                  <div className="w-[200px] shrink-0 text-right">
                    <div className="text-base font-medium text-[#1a1612] leading-tight">{t.title}</div>
                    <div className="text-sm text-stone-400">{t.composition < 0 ? `${Math.abs(t.composition)} BCE` : `${t.composition} CE`}</div>
                  </div>
                  <div className="flex-1 h-8 bg-[#f5f0e8] rounded relative">
                    <div
                      className="h-full rounded flex items-center justify-end pr-3"
                      style={{
                        width: `${barWidth}%`,
                        background: t.gap > 2000
                          ? 'linear-gradient(90deg, #9e4a3a 0%, #7c5db5 100%)'
                          : t.gap > 1000
                          ? 'linear-gradient(90deg, #c9a86c 0%, #9e4a3a 100%)'
                          : '#8b9a7d',
                        opacity: 0.85,
                      }}
                    >
                      <span className="text-white text-sm font-semibold drop-shadow-sm whitespace-nowrap">
                        {t.gap.toLocaleString()} years
                      </span>
                    </div>
                  </div>
                  <div className="w-[100px] shrink-0 text-base text-stone-500 tabular-nums">{t.printed}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gap distribution */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {GAP_DISTRIBUTION.map((g) => (
            <div key={g.label} className="bg-white border border-[#e8e4dc] rounded-lg p-4 text-center">
              <div className="text-2xl font-semibold" style={{ color: g.color }}>{g.count}</div>
              <div className="text-sm text-stone-500 mt-1 leading-tight">{g.label}</div>
            </div>
          ))}
        </div>
        <p className="text-base text-stone-500 text-center mt-3">
          Of 1,605 books with compositional dating, nearly 400 contain ideas composed
          more than a century before they were printed.
        </p>

        {/* Top Authors */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          Who Wrote Them?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            The most-represented authors are polymaths who resisted disciplinary
            boundaries. Athanasius Kircher alone published on Egypt, music, geology,
            magnetism, optics, and China — all in Latin, all untranslated until now.
            Huygens and Gassendi represent the mathematical-experimental tradition.
            Roger Bacon bridges medieval alchemy and proto-science. Together they form
            a portrait of curiosity unbounded by specialization.
          </p>
        </div>

        <div className="space-y-3">
          {TOP_AUTHORS.map((a) => (
            <div key={a.name} className="flex items-center gap-3">
              <div className="w-48 text-right shrink-0">
                <div className="text-base font-medium text-[#1a1612]">{a.name}</div>
                <div className="text-sm text-stone-400 leading-tight">{a.desc}</div>
              </div>
              <div className="flex-1 h-9 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded flex items-center pl-3"
                  style={{
                    width: `${(a.n / MAX_AUTHOR) * 100}%`,
                    backgroundColor: a.color,
                    opacity: 0.8,
                  }}
                >
                  <span className="text-white text-sm font-semibold drop-shadow-sm">{a.n} books</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Languages */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          What Languages?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            Latin dominates — the lingua franca of European scholarship until the
            18th century. But the collection reaches far beyond Europe: 198 Chinese
            texts (medicine, divination, natural philosophy), 135 Sanskrit works
            (Vedic commentary, Ayurvedic medicine, astronomical treatises), 58 Syriac
            theological texts. These represent intellectual traditions that developed
            in parallel, occasionally intersecting through translation and trade.
          </p>
        </div>

        <div className="space-y-3">
          {LANGUAGES.map((l) => (
            <div key={l.lang} className="flex items-center gap-3">
              <div className="w-24 text-base text-stone-600 text-right shrink-0">
                {l.lang}
              </div>
              <div className="flex-1 h-9 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{
                    width: `${(l.n / MAX_LANG) * 100}%`,
                    backgroundColor: l.color,
                    opacity: 0.8,
                  }}
                />
              </div>
              <div className="w-12 text-base text-stone-500 tabular-nums">{l.n}</div>
            </div>
          ))}
        </div>

        {/* Categories */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          What Subjects?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            Categories overlap — a single book can be theology, alchemy, and
            natural philosophy simultaneously. That&apos;s the point. The modern
            separation of these fields hadn&apos;t happened yet. Paracelsus wrote
            about medicine and mysticism in the same paragraph. Kircher mapped
            Egyptian hieroglyphics, Chinese characters, and magnetic forces as
            aspects of one universal system. These books resist neat classification
            because their authors saw the world as fundamentally interconnected.
          </p>
          <p>
            A note on &quot;Theology&quot;: this category is inflated. Our AI classifier
            tends to label anything that mentions God, providence, or the soul as
            theology — even when the book is primarily about alchemy, natural
            philosophy, or medicine. A more accurate reading would redistribute
            many of these 626 books into other categories. We&apos;re working on
            improving the classification.
          </p>
        </div>

        <div className="space-y-3">
          {CATEGORIES.map((c) => (
            <div key={c.cat} className="flex items-center gap-3">
              <div className="w-36 text-base text-stone-600 text-right shrink-0">
                {c.cat}
              </div>
              <div className="flex-1 h-9 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(c.n / MAX_CAT) * 100}%`,
                    backgroundColor: '#9e4a3a',
                    opacity: 0.7,
                  }}
                />
              </div>
              <div className="w-12 text-base text-stone-500 tabular-nums">{c.n}</div>
            </div>
          ))}
        </div>

        {/* Cross-tradition connections */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          Where Traditions Collide
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            The most striking pattern in the data is how often these supposedly
            separate disciplines appear in the same book. Alchemy and Hermeticism
            co-occur in 211 books — nearly half the alchemical corpus. Philosophy
            and Theology appear together in 165 works. These aren&apos;t genre
            labels — they&apos;re a map of how pre-modern thinkers actually organized
            knowledge. The borders we draw between science, religion, and magic
            simply didn&apos;t exist.
          </p>
        </div>

        <div className="space-y-3">
          {COOCCURRENCES.map((c) => {
            const barWidth = (c.n / MAX_COOC) * 100;
            return (
              <div key={`${c.a}-${c.b}`} className="flex items-center gap-3">
                <div className="w-60 text-right shrink-0">
                  <span className="text-base text-[#1a1612]">{c.a}</span>
                  <span className="text-stone-400 mx-1.5">&amp;</span>
                  <span className="text-base text-[#1a1612]">{c.b}</span>
                </div>
                <div className="flex-1 h-8 bg-[#f5f0e8] rounded overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${barWidth}%`,
                      background: 'linear-gradient(90deg, #9e4a3a, #7c5db5)',
                      opacity: 0.75,
                    }}
                  />
                </div>
                <div className="w-12 text-base text-stone-500 tabular-nums">{c.n}</div>
              </div>
            );
          })}
        </div>
        <p className="text-base text-stone-500 text-center mt-3">
          Number of books sharing both subject tags
        </p>

        {/* Most Read */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          What Are People Reading?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            Not academic citations — actual readers who found these books
            and stayed. The Cabalistic Science introduction leads with 47 readers,
            followed by Drebbel&apos;s treatise on alchemy and Eckartshausen&apos;s
            mystical manual. The Corpus Hermeticum and Ficino&apos;s <em>On the
            Mysteries</em> show that foundational Hermetic texts still command
            attention after two millennia.
          </p>
        </div>

        <div className="space-y-2">
          {MOST_READ.map((book, i) => (
            <Link
              key={book.slug}
              href={`https://sourcelibrary.org/book/${book.slug}`}
              className="flex items-center gap-3 group hover:bg-[#f5f0e8] rounded-lg px-3 py-2 -mx-3 transition-colors"
            >
              <div className="w-8 text-2xl font-serif font-semibold text-stone-300 text-right shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-medium text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors truncate">
                  {book.title}
                </div>
                <div className="text-sm text-stone-500">
                  {book.author}, {book.year}
                </div>
              </div>
              <div className="w-32 shrink-0">
                <div className="h-6 bg-[#f5f0e8] rounded overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${(book.reads / MAX_READS) * 100}%`,
                      backgroundColor: '#9e4a3a',
                      opacity: 0.7,
                    }}
                  />
                </div>
              </div>
              <div className="w-10 text-base text-stone-500 tabular-nums text-right shrink-0">
                {book.reads}
              </div>
            </Link>
          ))}
        </div>

        {/* Source Providers */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          Where Do They Come From?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            Every book traces back to a physical object in a real institution.
            The Internet Archive&apos;s open access scanning project provides the
            largest share, but the{' '}
            <Link href="https://embassyofthefreemind.com" className="text-[#9e4a3a] hover:underline">
              Embassy of the Free Mind
            </Link>{' '}
            in Amsterdam — a museum and library dedicated to the Western esoteric
            tradition — is the single most important specialized source, contributing
            788 books from their Bibliotheca Philosophica Hermetica. The Bibliothèque
            nationale de France, Bavarian State Library, and Vatican Library round out
            a truly global network of preservation.
          </p>
        </div>

        <div className="space-y-3">
          {PROVIDERS.map((p) => (
            <div key={p.name} className="flex items-center gap-3">
              <div className="w-56 text-base text-stone-600 text-right shrink-0 leading-tight">
                {p.name}
              </div>
              <div className="flex-1 h-9 bg-[#f5f0e8] rounded overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(p.n / MAX_PROVIDER) * 100}%`,
                    backgroundColor: p.color,
                    opacity: 0.8,
                  }}
                />
              </div>
              <div className="w-14 text-base text-stone-500 tabular-nums">{p.n}</div>
            </div>
          ))}
        </div>

        {/* Gallery */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          What Do They Look Like?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            These books are visual objects — hand-engraved illustrations, emblematic
            frontispieces, cosmological diagrams, alchemical symbols. Our AI image
            extraction has catalogued over 73,000 illustrations across the collection.
            Here are some of the finest from the first-translation corpus.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
              <div className="mt-2.5">
                <div className="text-base font-medium text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors leading-tight">
                  {img.title}
                </div>
                <div className="text-sm text-stone-500 mt-0.5">
                  {img.author}, {img.year}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Featured books */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          Start Reading
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            These are fully translated and ready to read — first English translations
            of works that have shaped intellectual history but remained inaccessible
            to most readers.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FEATURED_BOOKS.map((book) => (
            <Link
              key={book.slug}
              href={`https://sourcelibrary.org/book/${book.slug}`}
              className="group flex gap-4 bg-white border border-[#e8e4dc] rounded-lg p-4 hover:border-[#9e4a3a]/30 transition-colors"
            >
              <div className="w-24 h-32 relative rounded overflow-hidden shrink-0 bg-[#f5f0e8]">
                <Image
                  src={book.thumb}
                  alt={book.title}
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-[#1a1612] group-hover:text-[#9e4a3a] transition-colors leading-tight">
                  {book.title}
                </div>
                <div className="text-sm text-stone-500 mt-1">
                  {book.author}, {book.year} &middot; {book.lang} &middot;{' '}
                  {book.pages} pages
                </div>
                <p className="text-sm text-stone-600 mt-2 line-clamp-3 leading-relaxed">
                  {book.summary}
                </p>
              </div>
            </Link>
          ))}
        </div>

        {/* Page size distribution */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          How Long Are They?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            These aren&apos;t pamphlets. The median book is 220 pages, and 113 books
            exceed 1,000 pages — massive compendia like Fludd&apos;s 1,036-page
            cosmology or multi-volume theological disputations. Translating a
            1,000-page 17th-century Latin text would take a human scholar years of
            work. The AI pipeline processes them in hours.
          </p>
        </div>

        <div className="bg-white border border-[#e8e4dc] rounded-lg p-5 sm:p-8">
          <div className="flex items-end gap-2 sm:gap-3 justify-center" style={{ height: 240 }}>
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
              const h = (b.n / 376) * 200;
              return (
                <div key={b.label} className="flex flex-col items-center flex-1">
                  <div className="text-sm text-stone-500 mb-1">{b.n}</div>
                  <div
                    className="w-full rounded-t-sm"
                    style={{
                      height: h,
                      backgroundColor: '#9e4a3a',
                      opacity: 0.7,
                    }}
                  />
                  <div className="text-xs sm:text-sm text-stone-500 mt-1.5 whitespace-nowrap">
                    {b.label}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-center text-sm text-stone-500 mt-3">Pages per book</div>
        </div>

        {/* Methodology */}
        <h2 className="text-3xl font-serif font-semibold text-[#1a1612] mt-16 mb-3">
          How Do We Know These Are First Translations?
        </h2>
        <div className="prose prose-stone prose-lg max-w-none leading-relaxed mb-6">
          <p>
            Claiming &quot;first English translation&quot; is a serious scholarly assertion.
            We use a two-stage AI verification pipeline that progressively increases
            confidence, and we categorize results into five dispositions rather than
            a simple yes/no.
          </p>
        </div>

        <div className="bg-[#f5f0e8] border border-[#e8e4dc] rounded-lg p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-lg font-serif font-semibold text-[#1a1612] mb-2">
              Stage 1: OCR-Based Classification
            </h3>
            <p className="text-base text-stone-600 leading-relaxed">
              During metadata enrichment, our AI reads the first 25 pages of OCR text
              from each book and classifies whether the work has ever been translated
              into English. This lightweight check uses the book&apos;s own content —
              title page, preface, colophon — alongside its metadata (author, language,
              year, subject) to make an initial assessment. Cost: ~$0.002 per book.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-serif font-semibold text-[#1a1612] mb-2">
              Stage 2: Tool-Calling Verification
            </h3>
            <p className="text-base text-stone-600 leading-relaxed">
              Books flagged as potential first translations go through a deeper
              verification using Gemini with function-calling. The model is given
              five real tools — <code className="bg-white/60 px-1.5 py-0.5 rounded text-sm">search_local_catalogs</code> (our
              own 1,200+ book database), <code className="bg-white/60 px-1.5 py-0.5 rounded text-sm">search_open_library</code>,{' '}
              <code className="bg-white/60 px-1.5 py-0.5 rounded text-sm">search_google_books</code>,{' '}
              <code className="bg-white/60 px-1.5 py-0.5 rounded text-sm">search_ustc</code> (the Universal Short Title
              Catalogue), and <code className="bg-white/60 px-1.5 py-0.5 rounded text-sm">make_determination</code> — and
              autonomously searches for existing English translations. It checks
              academic publishers, specialist presses, PhD dissertations, journal
              translations, and anthologies.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-serif font-semibold text-[#1a1612] mb-2">
              Five Dispositions
            </h3>
            <p className="text-base text-stone-600 leading-relaxed mb-3">
              Rather than a binary yes/no, each book receives one of five dispositions:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Confirmed First', desc: 'No English translation found — high confidence', n: '1,727' },
                { label: 'First Complete Translation', desc: 'Partial excerpts exist, but no full translation', n: '609' },
                { label: 'First Modern Translation', desc: 'Only outdated or archaic translations exist', n: '119' },
                { label: 'Translation Found', desc: 'Verified English translation exists', n: '1,527' },
                { label: 'Needs Review', desc: 'Insufficient evidence — flagged for manual check', n: '106' },
              ].map((d) => (
                <div key={d.label} className="bg-white rounded-lg p-3 border border-[#e8e4dc]">
                  <div className="flex justify-between items-baseline">
                    <span className="text-base font-medium text-[#1a1612]">{d.label}</span>
                    <span className="text-base font-semibold text-stone-500 tabular-nums">{d.n}</span>
                  </div>
                  <div className="text-sm text-stone-500 mt-0.5">{d.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-serif font-semibold text-[#1a1612] mb-2">
              Limitations
            </h3>
            <p className="text-base text-stone-600 leading-relaxed">
              Stage 2 can verify that a translation <em>exists</em> (by citing a specific
              translator, publisher, and year) but cannot prove one <em>doesn&apos;t</em> exist.
              Absence of evidence in catalogs or LLM knowledge is not evidence of absence.
              Some translations may exist in unpublished dissertations, obscure anthologies,
              or private collections that no catalog indexes. The &quot;confirmed first&quot;
              disposition is our best assessment, not an absolute claim.
            </p>
          </div>

          <Link
            href="https://sourcelibrary.org/blog/first-translation-methodology"
            className="inline-block text-base font-medium text-[#9e4a3a] hover:underline"
          >
            Read the full methodology documentation
          </Link>
        </div>

        {/* CTA */}
        <div className="mt-10 text-center">
          <Link
            href="https://sourcelibrary.org/blog/first-translations"
            className="inline-block bg-[#9e4a3a] text-white font-medium text-base px-8 py-3 rounded-lg hover:bg-[#8a3f31] transition-colors"
          >
            Browse all first translations
          </Link>
          <p className="text-sm text-stone-400 mt-4">
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
      <InputWidget allowedHosts={["localhost", "vercel.app"]} />
    </ContentPageLayout>
  );
}
