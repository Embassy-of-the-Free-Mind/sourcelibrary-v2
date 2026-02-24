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

const INITIAL_SERVER_LIMIT = 100;

async function getBooks(): Promise<{ books: Book[]; totalBooks: number; translatedCount: number }> {
  try {
    const db = await getDb();

    // Single aggregation with $facet: gets books + counts in one collection scan
    const [result] = await db.collection('books').aggregate([
      { $match: { hidden: { $ne: true } } },
      {
        $facet: {
          books: [
            {
              $addFields: {
                id: { $ifNull: ['$id', { $toString: '$_id' }] },
                pages_count: { $ifNull: ['$pages_count', 0] },
                pages_translated: { $ifNull: ['$pages_translated', 0] },
                pages_ocr: { $ifNull: ['$pages_ocr', 0] },
                last_processed: { $ifNull: ['$updated_at', '$created_at'] },
                translation_percent: {
                  $cond: {
                    if: { $gt: [{ $ifNull: ['$pages_count', 0] }, 0] },
                    then: { $round: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_count', 0] }] }, 100] }] },
                    else: 0,
                  },
                },
                is_efm_translated: {
                  $cond: {
                    if: {
                      $and: [
                        { $eq: ['$image_source.provider', 'efm'] },
                        { $gt: [{ $ifNull: ['$pages_count', 0] }, 0] },
                        { $gte: [{ $multiply: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, { $ifNull: ['$pages_count', 1] }] }, 100] }, 90] },
                      ],
                    },
                    then: 1,
                    else: 0,
                  },
                },
                quality_score: { $ifNull: ['$quality_score', 0] },
              },
            },
            { $sort: { is_efm_translated: -1, quality_score: -1, last_translation_at: -1, last_processed: -1, title: 1 } },
            { $limit: INITIAL_SERVER_LIMIT },
            {
              $project: {
                _id: 0, id: 1, title: 1, display_title: 1, author: 1,
                thumbnail: 1, thumbnail_blob: 1, language: 1, published: 1,
                categories: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
                translation_percent: 1, last_processed: 1, last_translation_at: 1, featured: 1,
              },
            },
          ],
          counts: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                translated: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$pages_translated', 0] }, 0] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]).toArray();

    const books = result?.books || [];
    const counts = result?.counts?.[0] || { total: 0, translated: 0 };

    return {
      books: JSON.parse(JSON.stringify(books)) as Book[],
      totalBooks: counts.total,
      translatedCount: counts.translated,
    };
  } catch (error) {
    console.error('Error fetching books:', error);
    return { books: [], totalBooks: 0, translatedCount: 0 };
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
  const [{ books, totalBooks, translatedCount }, collections, recentlyTranslated] = await Promise.all([
    getBooks(),
    getCollections(),
    getRecentlyTranslated(),
  ]);

  const languages = [...new Set(books.map(b => b.language))].filter(Boolean) as string[];

  return (
    <>
      <HomePageSchema books={books} bookCount={totalBooks} translatedCount={translatedCount} />
      <BookLibrary
        initialBooks={books}
        totalBooks={totalBooks}
        languages={languages}
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
            Source Library continues the Ficino Society&apos;s mission to transform 2500+ years of wisdom texts into a living archive.
          </h2>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed mb-8">
            Based at the Embassy of the Free Mind in Amsterdam, home to the Bibliotheca Philosophica Hermetica—recognized by UNESCO&apos;s Memory of the World Register—this collection contains rare works on Hermetic philosophy, alchemy, Neoplatonist mystical literature, Rosicrucianism, Freemasonry, and the Kabbalah.
          </p>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            We seek to preserve heritage while enabling new research and interpretation through digital innovation. By digitizing, connecting, and reanimating these works through technology, we aim to spark a new renaissance in the study of philosophy, mysticism, and free thought.
          </p>
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
          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-16">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              loading="lazy"
              decoding="async"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              loading="lazy"
              decoding="async"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>

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
                <p className="text-stone-600 text-sm leading-relaxed">
                  In 1460, when a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, Cosimo ordered its translation before even Plato—sensing that Hermes Trismegistus held the key to ancient wisdom. He founded the Platonic Academy in his villa at Careggi, creating the first institution dedicated to freely sharing philosophical knowledge since antiquity.
                </p>
              </div>
              <div className="flex-1">
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                  Marsilio Ficino
                </h3>
                <p className="text-stone-500 text-sm mb-3">
                  1433–1499 · Philosopher & Translator
                </p>
                <p className="text-stone-600 text-sm leading-relaxed">
                  Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin—making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all seekers of truth.
                </p>
              </div>
            </div>
            <div className="mt-8 bg-accent-gold/5 rounded-lg p-5 border border-accent-gold/15">
              <p className="text-stone-700 text-sm leading-relaxed">
                <strong>Source Library continues their work.</strong> Just as Cosimo funded translations to make ancient wisdom freely available, and Ficino labored to render Greek and Latin texts accessible to readers across Europe, we use modern tools to digitize, translate, and openly share these same traditions with the world. The mission remains unchanged: <em>wisdom belongs to everyone</em>.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Links */}
        <div className="px-6 md:px-12 mt-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center pt-8 border-t border-stone-300 max-w-5xl mx-auto">
            <div className="mb-4 md:mb-0 text-gray-600">
              &copy; {new Date().getFullYear()} Source Library — An initiative of the Embassy of the Free Mind
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 text-gray-600">
              <a
                href="#about"
                className="hover:text-gray-900 transition-colors"
              >
                About
              </a>
              <span className="hidden md:inline">•</span>
              <a
                href="/press"
                className="text-accent-rust hover:text-accent-gold-dark transition-colors"
              >
                Press
              </a>
              <span className="hidden md:inline">•</span>
              <a
                href="mailto:derek@ancientwisdomtrust.org"
                className="text-accent-rust hover:text-accent-gold-dark transition-colors"
              >
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
