import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { sanitizeThumbnail } from '@/lib/collections-utils';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Contemplative Traditions - Source Library',
  description:
    'Primary sources from five contemplative traditions (Taoism, Sufism, Zen Buddhism, Advaita Vedanta, and depth psychology) in their original languages alongside English translations.',
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

/* ── Color mappings for tradition styling ── */

const TRADITION_STYLES: Record<string, {
  borderColor: string;
  bgColor: string;
  accentColor: string;
  hoverBg: string;
}> = {
  emerald: {
    borderColor: 'border-emerald-300',
    bgColor: 'bg-emerald-50',
    accentColor: 'text-emerald-700',
    hoverBg: 'hover:bg-emerald-50',
  },
  cyan: {
    borderColor: 'border-cyan-300',
    bgColor: 'bg-cyan-50',
    accentColor: 'text-cyan-700',
    hoverBg: 'hover:bg-cyan-50',
  },
  amber: {
    borderColor: 'border-accent-gold/20',
    bgColor: 'bg-accent-gold/8',
    accentColor: 'text-accent-rust',
    hoverBg: 'hover:bg-accent-gold/8',
  },
  orange: {
    borderColor: 'border-orange-300',
    bgColor: 'bg-orange-50',
    accentColor: 'text-orange-700',
    hoverBg: 'hover:bg-orange-50',
  },
  violet: {
    borderColor: 'border-violet-300',
    bgColor: 'bg-violet-50',
    accentColor: 'text-violet-700',
    hoverBg: 'hover:bg-violet-50',
  },
};

const DEFAULT_STYLE = {
  borderColor: 'border-stone-300',
  bgColor: 'bg-stone-50',
  accentColor: 'text-stone-700',
  hoverBg: 'hover:bg-stone-50',
};

/* ── Types ── */

interface TraditionCollection {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
  order: number;
  color?: string;
  languages: { lang: string; count: number }[];
  sample_books: {
    id: string;
    title: string;
    author: string;
    year: number | null;
    thumbnail: string | null;
  }[];
}

/* ── Data fetching ── */

async function getTraditions(): Promise<{ traditions: TraditionCollection[]; totalBooks: number }> {
  try {
    const db = await Promise.race([
      getDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 10000)),
    ]);

    const traditions = await db
      .collection('collections')
      .find({ parent: 'contemplative-traditions' })
      .sort({ order: 1 })
      .toArray();

    const parent = await db.collection('collections').findOne({ slug: 'contemplative-traditions' });
    const totalBooks = parent?.book_count || traditions.reduce((sum, t) => sum + (t.book_count || 0), 0);

    return {
      traditions: traditions.map(t => ({
        slug: t.slug,
        name: t.name,
        subtitle: t.subtitle || '',
        description: t.description || '',
        book_count: t.book_count || 0,
        order: t.order || 99,
        color: t.color,
        languages: t.languages || [],
        sample_books: t.sample_books || [],
      })) as TraditionCollection[],
      totalBooks,
    };
  } catch (e) {
    console.warn('[Contemplative Traditions portal] Failed to load:', (e as Error).message);
    return { traditions: [], totalBooks: 0 };
  }
}

/* ── Components ── */

function TraditionCard({ tradition }: { tradition: TraditionCollection }) {
  const style = TRADITION_STYLES[tradition.color || ''] || DEFAULT_STYLE;
  const languages = tradition.languages.map(l => l.lang);

  // Pick a thumbnail from sample books
  const heroThumb = tradition.sample_books
    .map(b => sanitizeThumbnail(b.thumbnail))
    .find((t): t is string => !!t);

  return (
    <Link
      href={`/collections/${tradition.slug}`}
      className={`group block rounded-2xl border-2 ${style.borderColor} overflow-hidden hover:shadow-lg transition-all`}
    >
      <div className={`${style.bgColor} px-6 py-5`}>
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-4">
          <h2 className={`text-2xl sm:text-3xl font-bold ${style.accentColor} font-display group-hover:underline decoration-2 underline-offset-4`}>
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
          <span>{tradition.book_count} texts</span>
          {languages.length > 0 && (
            <>
              <span>&middot;</span>
              <span>{languages.join(', ')}</span>
            </>
          )}
        </div>
      </div>

      {/* Sample book thumbnails */}
      {tradition.sample_books.length > 0 && (
        <div className="bg-white px-6 py-4 border-t border-stone-100">
          <div className="flex gap-3 overflow-hidden">
            {tradition.sample_books.slice(0, 5).map(book => {
              const thumb = sanitizeThumbnail(book.thumbnail);
              return (
                <div key={book.id} className="w-16 flex-shrink-0">
                  <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-stone-100">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={book.title}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="64px"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-stone-300" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Link>
  );
}

/* ── Page ── */

export default async function ContemplativeTraditionsPage() {
  let data: { traditions: TraditionCollection[]; totalBooks: number };
  try {
    data = await getTraditions();
  } catch (err) {
    console.error('[Contemplative Traditions portal] Failed to load:', err instanceof Error ? err.message : err);
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-display text-stone-900 mb-3">Temporarily Unavailable</h1>
          <p className="text-stone-600 mb-6">Please try again in a moment.</p>
          <Link href="/" className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  const { traditions, totalBooks } = data;
  const traditionsWithBooks = traditions.filter(t => t.book_count > 0);

  const allLanguages = [
    ...new Set(traditions.flatMap(t => t.languages.map(l => l.lang))),
  ];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="bg-gradient-to-r from-stone-800 via-stone-900 to-stone-800 border-b border-accent-gold-dark/30">
        <div className="max-w-7xl mx-auto px-6 py-4">
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
        <div className="relative max-w-7xl mx-auto px-6 py-16 sm:py-20">
          <p className="text-xs uppercase tracking-[0.3em] text-accent-gold font-semibold mb-4">
            Curated Collection
          </p>
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-[1.1] max-w-4xl font-display"
          >
            The Contemplative<br />Traditions
          </h1>
          <p className="text-lg text-stone-300 max-w-2xl leading-relaxed mb-10">
            Primary sources from five wisdom traditions, in their original
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
              <div className="text-3xl font-bold text-accent-gold">{traditionsWithBooks.length}</div>
              <div className="text-xs text-stone-400 uppercase tracking-wider mt-1">Traditions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky tradition nav */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 overflow-x-auto py-2 -mx-2 px-2 scrollbar-hide">
            {traditionsWithBooks.map(t => {
              const style = TRADITION_STYLES[t.color || ''] || DEFAULT_STYLE;
              return (
                <a
                  key={t.slug}
                  href={`#${t.slug}`}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium ${style.accentColor} ${style.hoverBg} transition-colors`}
                >
                  {t.name}
                </a>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Standout callout cards */}
      <div className="max-w-7xl mx-auto px-6 pt-10 pb-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-accent-gold/8 to-orange-50 rounded-xl p-5 border border-accent-gold/20">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-rust mb-1">
              975 AD
            </p>
            <p className="text-stone-800 font-medium text-sm leading-relaxed">
              A Song dynasty woodblock Dharani Sutra, one of the earliest
              surviving examples of printed Buddhist scripture in the world.
            </p>
          </div>
          <div className="bg-gradient-to-br from-cyan-50 to-blue-50 rounded-xl p-5 border border-cyan-200">
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-600 mb-1">
              1115 CE
            </p>
            <p className="text-stone-800 font-medium text-sm leading-relaxed">
              A manuscript of three Ghazali treatises copied just four years
              after the philosopher&apos;s death, among the closest witnesses to
              his original text.
            </p>
          </div>
        </div>
      </div>

      {/* Tradition cards */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-10">
        {traditionsWithBooks.map(tradition => (
          <section key={tradition.slug} id={tradition.slug} className="scroll-mt-20">
            <TraditionCard tradition={tradition} />
          </section>
        ))}
      </main>

      {/* Footer CTA */}
      <div className="bg-stone-100 border-t border-stone-200 mt-8">
        <div className="max-w-7xl mx-auto px-6 py-12 text-center">
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
