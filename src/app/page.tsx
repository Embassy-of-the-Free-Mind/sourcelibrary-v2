import { getDb } from '@/lib/mongodb';
import HeroSection from '@/components/HeroSection';
import BookLibrary from '@/components/BookLibrary';
import { Book } from '@/lib/types';

// Force dynamic rendering (no static generation)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getBooks(): Promise<Book[]> {
  try {
    const db = await getDb();

    // Use pre-computed counts from book documents (no expensive $lookup)
    const books = await db.collection('books').aggregate([
      {
        // Ensure id field exists (use _id as fallback for older imports)
        $addFields: {
          id: { $ifNull: ['$id', { $toString: '$_id' }] },
          // Use pre-computed counts, default to 0 if not set
          pages_count: { $ifNull: ['$pages_count', 0] },
          pages_translated: { $ifNull: ['$pages_translated', 0] },
          pages_ocr: { $ifNull: ['$pages_ocr', 0] },
          // Track last activity timestamps
          last_processed: { $ifNull: ['$updated_at', '$created_at'] },
          last_translation_at: { $ifNull: ['$last_translation_at', null] }
        }
      },
      {
        $addFields: {
          translation_percent: {
            $cond: {
              if: { $gt: ['$pages_count', 0] },
              then: { $round: [{ $multiply: [{ $divide: ['$pages_translated', '$pages_count'] }, 100] }] },
              else: 0
            }
          }
        }
      },
      {
        // Add sort key: books with translations first (1), others last (0)
        $addFields: {
          has_translations: { $cond: { if: { $gt: ['$last_translation_at', null] }, then: 1, else: 0 } }
        }
      },
      {
        // Sort: books with translations first, then by most recent, then by last updated
        $sort: { has_translations: -1, last_translation_at: -1, last_processed: -1, title: 1 }
      }
    ]).toArray();

    // Serialize to plain objects (remove MongoDB ObjectId etc)
    return JSON.parse(JSON.stringify(books)) as Book[];
  } catch (error) {
    console.error('Error fetching books:', error);
    return [];
  }
}

export default async function HomePage() {
  const books = await getBooks();

  // Get unique languages for filter
  const languages = [...new Set(books.map(b => b.language))].filter(Boolean) as string[];

  return (
    <div className="min-h-screen">
      {/* Hero Section with Video Background */}
      <HeroSection />

      {/* Library Section */}
      <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          {/* Section Header */}
          <div className="mb-8">
            <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 italic" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
              Freshly Digitised & Translated Texts
            </h2>
          </div>

          {/* Search, Filter & Book Grid */}
          <BookLibrary books={books} languages={languages} />
        </div>
      </section>

      {/* About Section */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Source Library continues the Ficino Society's mission to transform 2500+ years of wisdom texts into a living archive.
          </h2>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed mb-8">
            Based at the Embassy of the Free Mind in Amsterdam, home to the Bibliotheca Philosophica Hermetica—recognized by UNESCO's Memory of the World Register—this collection contains rare works on Hermetic philosophy, alchemy, Neoplatonist mystical literature, Rosicrucianism, Freemasonry, and the Kabbalah.
          </p>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            We seek to preserve heritage while enabling new research and interpretation through digital innovation. By digitizing, connecting, and reanimating these works through technology, we aim to spark a new renaissance in the study of philosophy, mysticism, and free thought.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="min-h-[60vh] flex flex-col justify-between bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl">
          <h2 className="text-4xl md:text-5xl lg:text-6xl text-gray-900 mb-8 leading-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Initiation is to be open for information.
          </h2>
          <p className="text-lg md:text-xl text-gray-700 leading-relaxed max-w-3xl mb-12">
            The Renaissance was born because patrons stepped forward to preserve and share hidden wisdom. Source Library continues the tradition—illuminating thousands of texts on hermeticism, alchemy, and esotericism to the world.
          </p>

          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-12">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
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
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
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
                <h3 className="text-xl md:text-2xl text-stone-800 mb-1" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
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
            <div className="mt-8 bg-amber-50/50 rounded-lg p-5 border border-amber-100">
              <p className="text-stone-700 text-sm leading-relaxed">
                <strong>Source Library continues their work.</strong> Just as Cosimo funded translations to make ancient wisdom freely available, and Ficino labored to render Greek and Latin texts accessible to readers across Europe, we use modern tools to digitize, translate, and openly share these same traditions with the world. The mission remains unchanged: <em>wisdom belongs to everyone</em>.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Links */}
        <div className="px-6 md:px-12 mt-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center pt-8 border-t border-gray-400 max-w-7xl mx-auto">
            <div className="mb-4 md:mb-0 text-gray-600">
              &copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 text-gray-600">
              <span>CC0 Public Domain</span>
              <span className="hidden md:inline">•</span>
              <a
                href="mailto:derek@ancientwisdomtrust.org"
                className="text-amber-700 hover:text-amber-800 transition-colors"
              >
                derek@ancientwisdomtrust.org
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
