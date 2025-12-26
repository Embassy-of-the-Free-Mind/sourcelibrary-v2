import { getDb } from '@/lib/mongodb';
import HeroSection from '@/components/HeroSection';
import BookLibrary from '@/components/BookLibrary';
import { Book } from '@/lib/types';

// Force dynamic rendering (no static generation)
export const dynamic = 'force-dynamic';

async function getBooks(): Promise<Book[]> {
  try {
    const db = await getDb();

    const books = await db.collection('books').aggregate([
      {
        // Ensure id field exists (use _id as fallback for older imports)
        $addFields: {
          id: { $ifNull: ['$id', { $toString: '$_id' }] }
        }
      },
      {
        $lookup: {
          from: 'pages',
          localField: 'id',
          foreignField: 'book_id',
          as: 'pages_array'
        }
      },
      {
        $addFields: {
          pages_count: { $size: '$pages_array' },
          pages_translated: {
            $size: {
              $filter: {
                input: '$pages_array',
                as: 'page',
                cond: {
                  $and: [
                    { $ne: ['$$page.translation', null] },
                    { $ne: ['$$page.translation.data', null] },
                    { $gt: [{ $strLenCP: { $ifNull: ['$$page.translation.data', ''] } }, 50] }
                  ]
                }
              }
            }
          },
          pages_ocr: {
            $size: {
              $filter: {
                input: '$pages_array',
                as: 'page',
                cond: {
                  $and: [
                    { $ne: ['$$page.ocr', null] },
                    { $ne: ['$$page.ocr.data', null] }
                  ]
                }
              }
            }
          },
          // Get the most recent processing timestamp from any page
          last_processed: {
            $max: {
              $map: {
                input: '$pages_array',
                as: 'page',
                in: {
                  $max: [
                    { $ifNull: ['$$page.ocr.updated_at', null] },
                    { $ifNull: ['$$page.translation.updated_at', null] }
                  ]
                }
              }
            }
          }
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
        $project: {
          pages_array: 0
        }
      },
      {
        // Sort by most recently processed first, then by title for books with no processing
        $sort: { last_processed: -1, title: 1 }
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
