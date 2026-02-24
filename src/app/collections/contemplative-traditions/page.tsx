import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { BookOpen, ArrowLeft, Languages, ScrollText } from 'lucide-react';

export const metadata: Metadata = {
  title: 'The Contemplative Traditions - Source Library',
  description:
    'Primary sources from five contemplative traditions — Taoism, Sufism, Zen Buddhism, Advaita Vedanta, and depth psychology — in their original languages alongside English translations.',
  openGraph: {
    title: 'The Contemplative Traditions',
    description:
      'A 975 AD woodblock sutra. Rumi in the original Persian. A Ghazali manuscript from 1115 CE. 40 primary sources across five traditions, in their own languages.',
    type: 'website',
    url: 'https://sourcelibrary.org/collections/contemplative-traditions',
    images: [{ url: '/collections/contemplative-traditions/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Contemplative Traditions',
    description:
      'A 975 AD woodblock sutra. Rumi in the original Persian. A Ghazali manuscript from 1115 CE. 40 primary sources across five traditions.',
  },
  alternates: {
    canonical: '/collections/contemplative-traditions',
  },
};

export const dynamic = 'force-dynamic';

/* ── Tradition definitions with book IDs ── */

interface Tradition {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  color: string;           // tailwind color prefix
  borderColor: string;
  bgColor: string;
  accentColor: string;
  originals: string[];     // MongoDB ObjectId strings
  translations: string[];
}

const TRADITIONS: Tradition[] = [
  {
    id: 'taoism',
    name: 'Taoism',
    subtitle: 'The Way and Its Power',
    description:
      'Chinese woodblock prints from the Ming and Qing dynasties alongside the Victorian translations that introduced the Tao Te Ching and Chuang Tzu to the West. The LOC rare books include a 1595 compilation of four Daoist classics and a 1740 annotated Daodejing.',
    color: 'emerald',
    borderColor: 'border-emerald-300',
    bgColor: 'bg-emerald-50',
    accentColor: 'text-emerald-700',
    originals: [
      '69935b6f2c63944063134103', // Four Daoist Classics 1595
      '6993575f8ed86e583b7b8703', // San zi yin yi ~1600
      '69935b6c2c6394406313403a', // Zhuangzi 1635
      '69935b692c63944063133f67', // Dao de jing 1740
    ],
    translations: [
      '6993569a83378b7aed7ce5b7', // Giles Chuang Tzu 1889
      '6993569383378b7aed7ce400', // Legge SBE Vol. 39 1891
      '69592bc6b89ab99ff513c08b', // Balfour Taoist Texts 1884
    ],
  },
  {
    id: 'sufism',
    name: 'Sufism',
    subtitle: 'The Path of the Heart',
    description:
      'Original Persian and Arabic texts paired with their English translations. Includes Nicholson\'s critical edition of Rumi\'s Mathnawi in Persian, Zhukovsky\'s scholarly edition of Hujwiri, and a Ghazali manuscript copied just four years after the philosopher\'s death in 1111 CE.',
    color: 'cyan',
    borderColor: 'border-cyan-300',
    bgColor: 'bg-cyan-50',
    accentColor: 'text-cyan-700',
    originals: [
      '69935b348e28d8f4c5d3cb86', // Ghazali Three Treatises 1115 CE
      '69935b318e28d8f4c5d3c9da', // Ghazali Ihya Arabic 1888
      '69935b2b8e28d8f4c5d3c6f6', // Ghazali Kimiya Persian
      '69935b198e28d8f4c5d3c249', // Rumi Mathnawi Persian
      '69935b208e28d8f4c5d3c445', // Hujwiri Kashf al-Mahjub Persian
    ],
    translations: [
      '699356ad83378b7aed7ce878', // Al-Ghazali Alchemy of Happiness
      '699356a38e28d8f4c5d3b69f', // Hujwiri Kashf al-Mahjub (Nicholson)
      '699356a983378b7aed7ce7b9', // Shabistari Gulshan-i Raz
      '6993575c8e28d8f4c5d3bdd3', // Rumi Mathnawi (Nicholson English)
      '699357738e28d8f4c5d3c1a2', // Jami Lawa'ih
    ],
  },
  {
    id: 'buddhism',
    name: 'Buddhism & Zen',
    subtitle: 'Seeing Into One\'s Nature',
    description:
      'Song dynasty woodblock sutras from the Library of Congress — including a 975 AD Dharani Sutra, one of the earliest surviving printed Buddhist texts — alongside English translations of key Mahayana works and the first Zen teachings published in English.',
    color: 'amber',
    borderColor: 'border-accent-gold/20',
    bgColor: 'bg-accent-gold/8',
    accentColor: 'text-accent-rust',
    originals: [
      '699356c28ed86e583b7b8320', // Dharani Sutra 975 AD
      '699356c58ed86e583b7b8334', // Lotus Sutra Song dynasty
      '699356cb8ed86e583b7b86cc', // Wu deng hui yuan
    ],
    translations: [
      '699258c38812793469fdd7e0', // Ashvaghosha Awakening of Faith
      '699356bc8e28d8f4c5d3b879', // SBE Vol. 49 Mahayana
      '6993576f8e28d8f4c5d3c0a0', // Soyen Shaku Sermons
    ],
  },
  {
    id: 'vedanta',
    name: 'Advaita Vedanta',
    subtitle: 'Non-Dual Reality',
    description:
      'Sanskrit originals in Devanagari script — the Bhagavad Gita with eight classical commentaries, fifteen principal Upanishads, Patanjali\'s Yoga Sutras with three commentaries, and Shankara\'s Vivekachudamani — alongside the landmark English translations that shaped Western understanding of Hindu philosophy.',
    color: 'orange',
    borderColor: 'border-orange-300',
    bgColor: 'bg-orange-50',
    accentColor: 'text-orange-700',
    originals: [
      '69935b458e28d8f4c5d3cbd3', // Bhagavad Gita Sanskrit
      '69935b4a8e28d8f4c5d3cf8c', // 15 Upanishads Sanskrit
      '69935b4d8e28d8f4c5d3cfaa', // Patanjali Yoga Sutras Sanskrit
      '69935b538e28d8f4c5d3d0cc', // Vivekachudamani Sanskrit
    ],
    translations: [
      '6993571783378b7aed7ce8f6', // Wilkins Bhagavad Gita 1785
      '699356d28e28d8f4c5d3ba61', // Duperron Oupnek'hat Latin
      '6993571d83378b7aed7ce92b', // Hume Upanishads
      '6993572283378b7aed7ceb65', // Vivekananda Raja Yoga
      '699357648e28d8f4c5d3bf8e', // Vivekachudamani English
    ],
  },
  {
    id: 'depth-psychology',
    name: 'Depth Psychology',
    subtitle: 'The Unconscious and the Sacred',
    description:
      'The bridge between contemplative traditions and modern psychology. Jung\'s foundational works in their original German alongside English translations, plus William James on religious experience, Silberer on mystical symbolism, and G.R.S. Mead\'s recovery of Gnostic texts.',
    color: 'violet',
    borderColor: 'border-violet-300',
    bgColor: 'bg-violet-50',
    accentColor: 'text-violet-700',
    originals: [
      '6990541238e1fdee57b36a6e', // Jung Wandlungen German
      '69935b5f2afc33235052333b', // Jung Psychologische Typen German
    ],
    translations: [
      '6955957b7bd6d2cd1d61f2c4', // William James Varieties
      '6993572983378b7aed7ced01', // Silberer Problems of Mysticism
      '6993573783378b7aed7ceee1', // Jung Psychology of the Unconscious
      '6993574783378b7aed7cf169', // Jung Psychological Types English
      '6993574e83378b7aed7cf419', // Mead Pistis Sophia
      '6993575683378b7aed7cf5b1', // Mead Fragments
    ],
  },
];

/* ── Data fetching ── */

interface BookDoc {
  _id: ObjectId;
  title: string;
  display_title?: string;
  author?: string;
  published?: string;
  year?: number;
  language?: string;
  original_language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
}

async function getBooks() {
  const allIds = TRADITIONS.flatMap(t => [...t.originals, ...t.translations]);
  const objectIds = allIds.map(id => new ObjectId(id));

  const db = await getDb();
  const docs = await db
    .collection('books')
    .find(
      { _id: { $in: objectIds } },
      {
        projection: {
          title: 1,
          display_title: 1,
          author: 1,
          published: 1,
          year: 1,
          language: 1,
          original_language: 1,
          pages_count: 1,
          pages_ocr: 1,
          pages_translated: 1,
          thumbnail: 1,
          thumbnail_blob: 1,
        },
      }
    )
    .toArray();

  const map = new Map<string, BookDoc>();
  for (const doc of docs) {
    map.set(doc._id.toString(), doc as unknown as BookDoc);
  }
  return map;
}

/* ── Components ── */

function BookCard({
  book,
  isOriginal,
}: {
  book: BookDoc;
  isOriginal: boolean;
}) {
  const id = book._id.toString();
  const thumb = book.thumbnail || book.thumbnail_blob;
  const rawLang = book.original_language || book.language || '';
  const lang = rawLang === 'Unknown' ? '' : rawLang;
  const parsedYear = book.published ? parseInt(book.published) : NaN;
  const year = book.year || (Number.isFinite(parsedYear) ? parsedYear : null);

  return (
    <Link href={`/book/${id}`} className="group block">
      <div className="h-full rounded-lg border border-stone-200 hover:border-accent-gold/30 hover:shadow-lg transition-all overflow-hidden bg-white">
        <div className="relative aspect-[3/4] bg-stone-100 overflow-hidden">
          {thumb ? (
            <Image
              src={thumb}
              alt={book.display_title || book.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 45vw, (max-width: 1024px) 22vw, 180px"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="w-10 h-10 text-stone-300" />
            </div>
          )}
          {isOriginal && (
            <div className="absolute top-2 left-2 z-10">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-stone-900/80 text-accent-gold text-[10px] font-semibold uppercase tracking-wider rounded">
                <ScrollText className="w-3 h-3" />
                Original
              </span>
            </div>
          )}
          {!isOriginal && (
            <div className="absolute top-2 left-2 z-10">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/90 text-stone-600 text-[10px] font-semibold uppercase tracking-wider rounded border border-stone-200">
                <Languages className="w-3 h-3" />
                Translation
              </span>
            </div>
          )}
        </div>
        <div className="p-3">
          <h3
            className="text-sm font-bold text-stone-900 group-hover:text-accent-rust transition-colors leading-tight line-clamp-2 mb-1 font-display"
          >
            {book.display_title || book.title}
          </h3>
          <p className="text-xs text-stone-500 line-clamp-1 mb-1">
            {book.author}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-stone-400">
            {year && <span>{year < 0 ? `${Math.abs(year)} BCE` : year}</span>}
            {lang && (
              <>
                <span>&middot;</span>
                <span>{lang}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function TraditionSection({
  tradition,
  bookMap,
}: {
  tradition: Tradition;
  bookMap: Map<string, BookDoc>;
}) {
  const originals = tradition.originals
    .map(id => bookMap.get(id))
    .filter((b): b is BookDoc => !!b);
  const translations = tradition.translations
    .map(id => bookMap.get(id))
    .filter((b): b is BookDoc => !!b);

  const total = originals.length + translations.length;
  const languages = [
    ...new Set(
      [...originals, ...translations]
        .map(b => b.original_language || b.language)
        .filter(l => l && l !== 'Unknown')
    ),
  ];

  return (
    <section id={tradition.id} className="scroll-mt-20">
      <div className={`rounded-2xl border-2 ${tradition.borderColor} overflow-hidden`}>
        {/* Section header */}
        <div className={`${tradition.bgColor} px-6 py-6 sm:px-8`}>
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-4">
            <h2
              className={`text-2xl sm:text-3xl font-bold ${tradition.accentColor} font-display`}
            >
              {tradition.name}
            </h2>
            <span className="text-sm text-stone-500 italic">
              {tradition.subtitle}
            </span>
          </div>
          <p className="text-stone-600 mt-2 max-w-3xl text-sm leading-relaxed">
            {tradition.description}
          </p>
          <div className="flex gap-4 mt-3 text-xs text-stone-500">
            <span>{total} texts</span>
            <span>&middot;</span>
            <span>{languages.join(', ')}</span>
          </div>
        </div>

        {/* Books */}
        <div className="bg-white px-6 py-6 sm:px-8 space-y-6">
          {originals.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
                Original Language
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {originals.map(book => (
                  <BookCard
                    key={book._id.toString()}
                    book={book}
                    isOriginal={true}
                  />
                ))}
              </div>
            </div>
          )}
          {translations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400 mb-3">
                English Translations
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {translations.map(book => (
                  <BookCard
                    key={book._id.toString()}
                    book={book}
                    isOriginal={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Page ── */

export default async function ContemplativeTraditionsPage() {
  const bookMap = await getBooks();
  const totalBooks = bookMap.size;

  const allLanguages = [
    ...new Set(
      Array.from(bookMap.values())
        .map(b => b.original_language || b.language)
        .filter(l => l && l !== 'Unknown')
    ),
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="bg-gradient-to-r from-stone-800 via-stone-900 to-stone-800 border-b border-accent-gold-dark/30">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link
            href="/collections"
            className="inline-flex items-center gap-2 text-accent-gold hover:text-accent-gold transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Collections
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="relative bg-gradient-to-br from-stone-800 via-stone-900 to-stone-800 text-white overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='40' cy='40' r='30' fill='none' stroke='white' stroke-width='0.5'/%3E%3Ccircle cx='40' cy='40' r='20' fill='none' stroke='white' stroke-width='0.5'/%3E%3Ccircle cx='40' cy='40' r='10' fill='none' stroke='white' stroke-width='0.5'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 py-16 sm:py-20">
          <p className="text-xs uppercase tracking-[0.3em] text-accent-gold font-semibold mb-4">
            Curated Collection
          </p>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-[1.1] max-w-4xl font-display"
          >
            The Contemplative<br />Traditions
          </h1>
          <p className="text-lg text-stone-300 max-w-2xl leading-relaxed mb-10">
            Primary sources from five wisdom traditions — in their original
            languages alongside English translations. From a 975&nbsp;AD Chinese
            woodblock sutra to Jung in the original German.
          </p>

          {/* Stats */}
          <div className="flex flex-wrap gap-6 sm:gap-10">
            <div>
              <div className="text-3xl font-bold text-accent-gold">{totalBooks}</div>
              <div className="text-xs text-stone-400 uppercase tracking-wider mt-1">Texts</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-accent-gold">{allLanguages.length}</div>
              <div className="text-xs text-stone-400 uppercase tracking-wider mt-1">Languages</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-accent-gold">3,000+</div>
              <div className="text-xs text-stone-400 uppercase tracking-wider mt-1">Years</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-accent-gold">5</div>
              <div className="text-xs text-stone-400 uppercase tracking-wider mt-1">Traditions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick nav */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-1 overflow-x-auto py-2 -mx-2 px-2 scrollbar-hide">
            {TRADITIONS.map(t => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium ${t.accentColor} hover:${t.bgColor} transition-colors`}
              >
                {t.name}
              </a>
            ))}
          </nav>
        </div>
      </div>

      {/* Standout callout */}
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-accent-gold/8 to-orange-50 rounded-xl p-5 border border-accent-gold/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-rust mb-1">
              975 AD
            </p>
            <p className="text-stone-800 font-medium text-sm leading-relaxed">
              A Song dynasty woodblock Dharani Sutra — one of the earliest
              surviving examples of printed Buddhist scripture in the world.
            </p>
          </div>
          <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-xl p-5 border border-cyan-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600 mb-1">
              1115 CE
            </p>
            <p className="text-stone-800 font-medium text-sm leading-relaxed">
              A manuscript of three Ghazali treatises copied just four years
              after the philosopher&apos;s death — among the closest witnesses to
              his original text.
            </p>
          </div>
        </div>
      </div>

      {/* Tradition sections */}
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {TRADITIONS.map(tradition => (
          <TraditionSection
            key={tradition.id}
            tradition={tradition}
            bookMap={bookMap}
          />
        ))}
      </main>

      {/* Footer CTA */}
      <div className="bg-stone-100 border-t border-stone-200 mt-8">
        <div className="max-w-6xl mx-auto px-6 py-12 text-center">
          <p className="text-stone-600 mb-4">
            These texts are part of a growing collection of 1,200+ digitized
            primary sources spanning alchemy, Hermetica, Kabbalah, natural
            philosophy, and now the contemplative traditions.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors font-medium"
          >
            Browse the Full Library
          </Link>
        </div>
      </div>
    </div>
  );
}
