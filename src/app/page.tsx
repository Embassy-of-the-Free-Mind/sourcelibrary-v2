import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import HeroSection from '@/components/layout/HeroSection';
import BookLibrary, { type CollectionForGrid } from '@/components/book/BookLibrary';
import BookLibrarySkeleton from '@/components/book/BookLibrarySkeleton';
import HomePageSchema from '@/components/seo/HomePageSchema';
import SocietyLandingPage from '@/components/layout/SocietyLandingPage';
import { Book } from '@/lib/types';
import { getSiteMode } from '@/lib/site-mode.server';

// ISR: rebuild at most every 2 minutes
export const revalidate = 120;

async function getBookCounts(): Promise<{ totalBooks: number; translatedCount: number }> {
  try {
    const db = await getDb();
    const [result] = await db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          translated: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$pages_translated', 0] }, 0] }, 1, 0] } },
        },
      },
    ]).toArray();
    return {
      totalBooks: result?.total || 0,
      translatedCount: result?.translated || 0,
    };
  } catch (error) {
    console.error('Error fetching book counts:', error);
    return { totalBooks: 0, translatedCount: 0 };
  }
}

async function getCollections(): Promise<CollectionForGrid[]> {
  try {
    const db = await getDb();
    const docs = await db.collection('collections').find({}).sort({ order: 1 }).toArray();
    return JSON.parse(JSON.stringify(docs.map(({ _id, ...rest }) => ({
      slug: rest.slug,
      name: rest.name,
      subtitle: rest.subtitle || '',
      description: rest.description || '',
      book_count: rest.book_count || 0,
      featured_images: rest.featured_images || [],
      languages: rest.languages || [],
    })))) as CollectionForGrid[];
  } catch (error) {
    console.error('Error fetching collections:', error);
    return [];
  }
}

async function getRecentlyTranslated(): Promise<Book[]> {
  try {
    const db = await getDb();
    const books = await db.collection('books').find({
      hidden: { $ne: true },
      pages_translated: { $gt: 0 },
      last_translation_at: { $exists: true },
    }).sort({ last_translation_at: -1 }).limit(10).project({
      _id: 0,
      id: { $ifNull: ['$id', { $toString: '$_id' }] },
      title: 1,
      display_title: 1,
      author: 1,
      thumbnail: 1,
      thumbnail_blob: 1,
      language: 1,
      published: 1,
      pages_count: { $ifNull: ['$pages_count', 0] },
      pages_translated: { $ifNull: ['$pages_translated', 0] },
      pages_ocr: { $ifNull: ['$pages_ocr', 0] },
      translation_percent: {
        $cond: {
          if: { $gt: [{ $ifNull: ['$pages_count', 0] }, 0] },
          then: { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_count', 0] }] }, 100] }] },
          else: 0,
        },
      },
    }).toArray();
    return JSON.parse(JSON.stringify(books)) as Book[];
  } catch (error) {
    console.error('Error fetching recently translated:', error);
    return [];
  }
}

async function LibrarySection() {
  const [{ totalBooks, translatedCount }, collections, recentlyTranslated] = await Promise.all([
    getBookCounts(),
    getCollections(),
    getRecentlyTranslated(),
  ]);

  return (
    <>
      <HomePageSchema books={recentlyTranslated} bookCount={totalBooks} translatedCount={translatedCount} />
      <BookLibrary
        initialBooks={[]}
        totalBooks={totalBooks}
        languages={[]}
        collections={collections}
        recentlyTranslated={recentlyTranslated}
      />
    </>
  );
}

export default async function HomePage() {
  const siteMode = await getSiteMode();

  if (siteMode.isSociety) {
    return <SocietyLandingPage />;
  }

  return (
    <div className="min-h-screen">
      {/* Hero Section with Video Background */}
      <HeroSection />

      {/* Library Section */}
      <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <Suspense fallback={<BookLibrarySkeleton />}>
            <LibrarySection />
          </Suspense>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display">
            The first Renaissance began when Cosimo de&apos; Medici asked a scholar to translate a single manuscript. We&apos;re translating all of them.
          </h2>
          <div className="space-y-6 text-lg md:text-xl text-gray-600 leading-relaxed">
            <p>
              Five centuries of humanity&apos;s deepest thinking about consciousness, nature, and the divine
              sit locked in Latin, Arabic, Hebrew, and early vernacular languages&mdash;unread, untranslated,
              inaccessible. These aren&apos;t obscure footnotes. They are the roots of modern science,
              psychology, philosophy of mind, and the perennial questions about what it means to be human.
            </p>
            <p>
              Source Library is recovering this knowledge. Using AI to translate at a scale no human team
              could match, we are building the world&apos;s largest open-access collection of translated
              primary sources&mdash;so that scholars, seekers, and the AI systems shaping our future can
              draw on the full depth of the human intellectual tradition, not just the fraction that made
              it into English.
            </p>
            <p className="text-gray-500 text-base">
              A program of the{' '}
              <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a>{' '}
              in Amsterdam, home to the Bibliotheca Philosophica Hermetica&mdash;one of the world&apos;s most
              important collections of Hermetic, alchemical, and esoteric manuscripts.
            </p>
          </div>
        </div>
      </section>

      {/* Search Section */}
      <section className="bg-gradient-to-b from-white to-[#f6f3ee] py-16 md:py-20">
        <div className="px-6 md:px-12 max-w-2xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl text-gray-900 mb-3 font-display">
            Search the collection
          </h2>
          <p className="text-stone-500 mb-6">
            Search across books, translations, and AI-generated indexes
          </p>
          <form action="/search" method="get" className="relative max-w-lg mx-auto">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              name="q"
              placeholder="Hermes, alchemy, Ficino..."
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-stone-200 rounded-full text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-accent-rust/20 focus:border-accent-rust shadow-sm"
            />
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          {/* Dedication */}
          <div className="max-w-4xl border-t border-stone-300 pt-10 mt-8">
            <p className="text-sm uppercase tracking-[0.2em] text-stone-500 mb-6">
              In the spirit of
            </p>
            <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-12">
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                  Cosimo de&apos; Medici
                </h3>
                <p className="text-stone-500 text-sm mb-3">
                  1389–1464 · Florence
                </p>
                <p className="text-stone-600 text-base leading-relaxed">
                  Around 1460, a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, brought from Macedonia by a monk named Leonardo of Pistoia. The aging Cosimo asked Ficino to translate it before even Plato&mdash;sensing that Hermes held the key to the most ancient wisdom. He funded Ficino&apos;s Greek studies and gave him a property at Careggi, where a circle of scholars gathered around these recovered texts.
                </p>
              </div>
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                  Marsilio Ficino
                </h3>
                <p className="text-stone-500 text-sm mb-3">
                  1433–1499 · Philosopher & Translator
                </p>
                <p className="text-stone-600 text-base leading-relaxed">
                  Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin—making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all seekers of truth.
                </p>
              </div>
            </div>
            <div className="mt-8 bg-accent-gold/5 rounded-lg p-5 border border-accent-gold/15">
              <p className="text-stone-700 text-base leading-relaxed">
                <strong>Source Library continues their work.</strong> Cosimo believed that recovering ancient wisdom and sharing it freely could transform civilization&mdash;and he was right. Ficino&apos;s translations ignited the Renaissance. Centuries later, thousands of these same texts remain untranslated and unread. We are recovering them&mdash;for scholars, for seekers, and for the AI systems that will shape how future generations think.
              </p>
            </div>
          </div>
        </div>

      </footer>
    </div>
  );
}
