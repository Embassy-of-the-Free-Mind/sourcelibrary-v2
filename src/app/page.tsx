import { getDb } from '@/lib/mongodb';
import { Book } from '@/lib/types';
import { type CollectionForGrid } from '@/components/book/BookLibrary';
import HeroSection from '@/components/layout/HeroSection';
import HomePageSchema from '@/components/seo/HomePageSchema';
import FeaturedCollectionCarousel from '@/components/prototype/FeaturedCollectionHero';
import FromTheCollection from '@/components/prototype/FromTheCollection';
import BookCard from '@/components/book/BookCard';
import SocietyGate from '@/components/layout/SocietyGate';
import Image from 'next/image';
import Link from 'next/link';

// Rebuild every 30 seconds — fresh enough for variety, fast for repeat visits
export const revalidate = 30;
export const maxDuration = 30;

// ---------- Collection ordering (user-specified) ----------

const COLLECTION_ORDER = [
  'Natural Philosophy',
  'Theology',
  'Classical Philosophy',
  'Alchemy',
  'Indic',
  'Chinese',
  'Magic',
  'Medicine',
  'Art',
  'Secret Societies',
  'Leonardo',
];

function collectionSortIndex(name: string): number {
  const idx = COLLECTION_ORDER.findIndex(prefix => name.includes(prefix));
  return idx === -1 ? COLLECTION_ORDER.length : idx;
}

// ---------- Book projection shared across queries ----------

const BOOK_PROJECTION = {
  _id: 0,
  id: { $ifNull: ['$id', { $toString: '$_id' }] },
  slug: 1,
  title: 1,
  display_title: 1,
  author: 1,
  thumbnail: 1,
  thumbnail_blob: 1,
  language: 1,
  published: 1,
  is_first_translation: 1,
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
};

// ---------- Data fetching ----------

async function getFeaturedCollections() {
  const db = await getDb();

  // Pick 5 random collections that have enough books
  const collections = await db.collection('collections').aggregate([
    { $match: { book_count: { $gte: 5 } } },
    { $sample: { size: 5 } },
  ]).toArray();

  if (collections.length === 0) return [];

  // Fetch top 10 translated books for each collection in parallel
  const results = await Promise.all(collections.map(async (collection) => {
    const images = collection.featured_images || [];
    const hero = images.find(
      (img: Record<string, unknown>) => img.extracted_url || img.image_url || img.thumbnail_url
    );
    const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url || null;

    const books = await db.collection('books').aggregate([
      {
        $match: {
          collections: collection.slug,
          hidden: { $ne: true },
          pages_count: { $gt: 0 },
          pages_translated: { $gt: 0 },
        },
      },
      { $sort: { read_count: -1 } },
      { $limit: 10 },
      { $project: { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1 } },
    ]).toArray();

    return {
      collection: {
        slug: collection.slug as string,
        name: collection.name as string,
        subtitle: (collection.subtitle || '') as string,
        description: (collection.description || '') as string,
        book_count: (collection.book_count || 0) as number,
        hero_image: heroUrl as string | null,
      },
      books: JSON.parse(JSON.stringify(books)),
    };
  }));

  // Only return collections that have translated books to show
  return results.filter(r => r.books.length > 0);
}

async function getRemainingCollections(): Promise<CollectionForGrid[]> {
  const db = await getDb();
  const docs = await db.collection('collections').find({}).toArray();

  const result = docs.map(({ _id, ...rest }) => {
    const images = rest.featured_images || [];
    const hero = images.find(
      (img: Record<string, unknown>) => img.extracted_url || img.image_url || img.thumbnail_url
    );
    const heroUrl = hero?.extracted_url || hero?.image_url || hero?.thumbnail_url || null;
    const languageValues = Array.isArray(rest.languages)
      ? rest.languages
      : [];
    const languages = languageValues
      .map((language: unknown) => {
        if (typeof language === 'string') return language;
        if (language && typeof language === 'object' && typeof (language as { lang?: unknown }).lang === 'string') {
          return (language as { lang: string }).lang;
        }
        return null;
      })
      .filter((language: unknown): language is string => Boolean(language))
      .slice(0, 3);
    return {
      slug: rest.slug,
      name: rest.name,
      subtitle: rest.subtitle || '',
      description: rest.description || '',
      book_count: rest.book_count || 0,
      hero_image: heroUrl as string | null,
      languages,
    };
  }) as CollectionForGrid[];

  // Fill in missing hero images from book thumbnails
  const missingHero = result.filter(c => !c.hero_image);
  if (missingHero.length > 0) {
    for (const col of missingHero) {
      try {
        const book = await db.collection('books').findOne(
          {
            collections: col.slug,
            hidden: { $ne: true },
            $or: [
              { thumbnail_blob: { $exists: true, $nin: [null, ''] } },
              { thumbnail: { $exists: true, $nin: [null, ''] } },
            ],
          },
          { projection: { thumbnail_blob: 1, thumbnail: 1 } },
        );
        if (book) {
          col.hero_image = (book.thumbnail_blob || book.thumbnail) as string;
        }
      } catch {
        // Skip — gradient fallback will show
      }
    }
  }

  // Sort by user-specified order
  result.sort((a, b) => collectionSortIndex(a.name) - collectionSortIndex(b.name));

  return result;
}

async function getDiscoverBooks(): Promise<Book[]> {
  const db = await getDb();

  // Top books by read_count with a random offset for variety.
  // Much faster than $rand sort (~600ms vs 4s) because it uses the index.
  const randomSkip = Math.floor(Math.random() * 50);
  const books = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true }, pages_translated: { $gte: 10 } } },
    { $sort: { read_count: -1 } },
    { $skip: randomSkip },
    { $limit: 10 },
    { $project: BOOK_PROJECTION },
  ]).toArray();

  return JSON.parse(JSON.stringify(books)) as Book[];
}

async function getCollectionShowcase() {
  const db = await getDb();

  // Sample high-quality gallery images with museum descriptions
  const rawImages = await db.collection('gallery_images').aggregate([
    {
      $match: {
        gallery_quality: { $gte: 0.85 },
        museum_description: { $exists: true, $ne: '' },
        extracted_url: { $regex: /^https?:\/\// },
        book_hidden: { $ne: true },
      },
    },
    { $sample: { size: 40 } },
  ]).toArray();

  // Diversify: max 1 per book, take 8
  const seen = new Set<string>();
  const selected = [];
  for (const img of rawImages) {
    if (seen.has(img.book_id)) continue;
    seen.add(img.book_id);
    selected.push(img);
    if (selected.length >= 8) break;
  }

  // For each selected image, try to find a quote from the book
  const items = await Promise.all(
    selected.map(async (img) => {
      let quote: { text: string; page: number } | undefined;
      try {
        const book = await db.collection('books').findOne(
          { id: img.book_id },
          { projection: { 'reading_summary.quotes': 1, slug: 1 } },
        );
        const quotes = book?.reading_summary?.quotes;
        if (quotes && quotes.length > 0) {
          quote = quotes[Math.floor(Math.random() * quotes.length)];
        }
        return {
          page_id: img.page_id,
          book_id: img.book_id,
          page_number: img.page_number || 0,
          detection_index: img.detection_index || 0,
          thumbnail_url: img.thumbnail_url || img.extracted_url,
          type: img.type || '',
          museum_description: img.museum_description,
          book_title: img.book_title || '',
          book_author: img.book_author || '',
          book_year: img.book_year || 0,
          book_slug: book?.slug,
          quote,
        };
      } catch {
        return {
          page_id: img.page_id,
          book_id: img.book_id,
          page_number: img.page_number || 0,
          detection_index: img.detection_index || 0,
          thumbnail_url: img.thumbnail_url || img.extracted_url,
          type: img.type || '',
          museum_description: img.museum_description,
          book_title: img.book_title || '',
          book_author: img.book_author || '',
          book_year: img.book_year || 0,
          quote,
        };
      }
    })
  );

  return JSON.parse(JSON.stringify(items));
}

async function getBookCounts(): Promise<{ totalBooks: number; translatedCount: number }> {
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
}

// ---------- Blog posts (curated subset for homepage) ----------

const BLOG_POSTS = [
  {
    slug: 'hidden-engineers',
    title: 'The Hidden Engineers: Steam Engines in Spell Books, Automata in Alchemy',
    subtitle: 'Before engineering was a discipline, its knowledge lived inside alchemy, natural magic, and mystical philosophy.',
    date: '27 February 2026',
    readTime: '22 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/695230c6ab34727b1f044784/93.jpg',
  },
  {
    slug: 'philosophers-stone',
    title: "What Is the Philosopher's Stone? Eight Answers from the Primary Sources",
    subtitle: 'An allegorical emblem sequence, a universal salt, a red powder found in a bishop\'s tomb — eight primary sources, eight different answers.',
    date: '27 February 2026',
    readTime: '20 min read',
    tag: 'Deep dive',
    tagColor: 'bg-accent-rust/10 text-accent-rust',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/uploads/69804b952c52aad359879321/69804ceaefc8a337f6e2717b.jpg',
  },
  {
    slug: 'rithmomachia',
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    subtitle: 'Five treatises in five languages document a mathematical board game played across Europe for six centuries.',
    date: '2 March 2026',
    readTime: '18 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
  },
  {
    slug: 'first-translations',
    title: 'Over 500 First English Translations',
    subtitle: 'Alchemical lab manuals, radical theology, women alchemists, Sanskrit astrology manuscripts — all previously inaccessible in English.',
    date: '20 February 2026',
    readTime: '14 min read',
    tag: 'Collection',
    tagColor: 'bg-accent-violet/10 text-accent-violet',
    image: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/4d4089b9-9227-4cc5-b0a2-9b06ee731061/2.jpg',
  },
];

// ---------- Page ----------

export default async function HomePage() {
  const [featuredItems, discoverBooks, showcase, counts, collections] = await Promise.all([
    getFeaturedCollections(),
    getDiscoverBooks(),
    getCollectionShowcase(),
    getBookCounts(),
    getRemainingCollections(),
  ]);

  return (
    <SocietyGate>
      <div className="min-h-screen">
        <HomePageSchema books={discoverBooks} bookCount={counts.totalBooks} translatedCount={counts.translatedCount} />

        {/* Video Hero — same as current homepage */}
        <HeroSection />

        {/* Collections Grid */}
        <section id="library" className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <div className="flex items-baseline justify-between mb-8">
              <div>
                <h2 className="text-3xl md:text-4xl text-primary font-display">
                  Collections
                </h2>
                <p className="text-muted mt-2">
                  {counts.totalBooks.toLocaleString()} books &middot; {counts.translatedCount.toLocaleString()} with translations
                </p>
              </div>
              <Link
                href="/search"
                className="text-sm text-accent-rust hover:underline hidden md:block"
              >
                Browse all books
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {collections.map((col, i) => (
                <Link
                  key={col.slug}
                  href={`/collections/${col.slug}`}
                  className="group relative bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg hover:border-accent-rust/20 transition-all"
                >
                  {/* Hero image */}
                  <div className="aspect-[16/9] relative bg-warm overflow-hidden">
                    {col.hero_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={col.hero_image}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading={i < 8 ? 'eager' : 'lazy'}
                        // eslint-disable-next-line react/no-unknown-property
                        fetchPriority={i < 4 ? 'high' : 'auto'}
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-accent-rust/10 to-accent-gold/10" />
                    )}
                  </div>

                  {/* Text */}
                  <div className="p-4">
                    <h3 className="font-display text-lg text-primary group-hover:text-accent-rust transition-colors line-clamp-1">
                      {col.name}
                    </h3>
                    {col.subtitle && (
                      <p className="text-sm text-muted mt-1 line-clamp-2">{col.subtitle}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2 text-xs text-faint">
                      <span>{col.book_count} books</span>
                      {col.languages && col.languages.length > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>{col.languages.join(', ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Featured Collection Carousel — flip through collections */}
        {featuredItems.length > 0 && (
          <FeaturedCollectionCarousel items={featuredItems} />
        )}

        {/* From the Collection — image-heavy gallery showcase */}
        <FromTheCollection items={showcase} />

        {/* Discover Section */}
        <section className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <h2 className="text-3xl md:text-4xl text-primary mb-3 font-display">
              Discover
            </h2>
            <p className="text-muted mb-10 max-w-2xl">
              Translated primary sources from the collection.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
              {discoverBooks.map((book, i) => (
                <BookCard key={book.id} book={book} priority={i < 2} />
              ))}
            </div>
          </div>
        </section>

        {/* Blog Section */}
        <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-7xl mx-auto">
            <div className="flex items-baseline justify-between mb-10">
              <div>
                <h2 className="text-3xl md:text-4xl text-primary font-display">
                  From the Blog
                </h2>
                <p className="text-muted mt-2">
                  Essays on the history behind the collection
                </p>
              </div>
              <Link
                href="/blog"
                className="text-sm text-accent-rust hover:underline hidden md:block"
              >
                All posts
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {BLOG_POSTS.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="group bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg hover:border-accent-rust/20 transition-all"
                >
                  {post.image && (
                    <div className="aspect-[16/10] relative bg-warm overflow-hidden">
                      <Image
                        src={post.image}
                        alt=""
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    {post.tag && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${post.tagColor}`}>
                        {post.tag}
                      </span>
                    )}
                    <h3 className="font-display text-lg text-primary mt-2 group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                      {post.title}
                    </h3>
                    <p className="text-sm text-muted mt-1.5 line-clamp-2">
                      {post.subtitle}
                    </p>
                    <p className="text-xs text-faint mt-3">
                      {post.date} &middot; {post.readTime}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="bg-white py-16 md:py-24">
          <div className="px-6 md:px-12 max-w-5xl mx-auto">
            <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display">
              The rediscovery of ancient wisdom helped spark the Renaissance. It&apos;s time for another.
            </h2>
            <div className="space-y-6 text-lg md:text-xl text-gray-600 leading-relaxed">
              <p>
                Centuries of humanity&apos;s deepest thinking sit locked in Latin and other inaccessible
                languages. These aren&apos;t just inaccessible to humans; contemporary AI systems were trained
                on Reddit but not the Renaissance. Millions of books and manuscripts are unscanned and
                untranslated. These aren&apos;t obscure footnotes. They are the roots of modern science,
                psychology, philosophy of mind, and the perennial questions about what it means to be human.
              </p>
              <p>
                The Source Library uses scholarship and AI systems to recover this knowledge and make it
                accessible to all. We are building the world&apos;s largest open-access collection of translated
                primary sources&mdash;so that scholars, seekers, and AI systems can draw on the full depth of
                the human intellectual tradition.
              </p>
              <p className="text-gray-500 text-base">
                The Source Library is an initiative of the{' '}
                <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a>{' '}
                in Amsterdam, home to the Bibliotheca Philosophica Hermetica: one of the world&apos;s most
                important collections of Hermetic, alchemical, and esoteric books.
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
            <div className="max-w-4xl border-t border-stone-300 pt-10 mt-8">
              <p className="text-sm uppercase tracking-[0.2em] text-stone-500 mb-6">
                In the spirit of
              </p>
              <div className="flex flex-col md:flex-row md:items-start gap-8 md:gap-12">
                <div className="flex-1">
                  <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                    Marsilio Ficino
                  </h3>
                  <p className="text-stone-500 text-sm mb-3">
                    1433&ndash;1499 &middot; Philosopher &amp; Translator
                  </p>
                  <p className="text-stone-600 text-base leading-relaxed">
                    Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the
                    Hermetic writings into Latin&mdash;making them accessible to all of Europe for the first
                    time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and
                    the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all
                    seekers of truth.
                  </p>
                </div>
                <div className="flex-1">
                  <h3 className="text-xl md:text-2xl text-stone-800 mb-1 font-display">
                    Cosimo de&apos; Medici
                  </h3>
                  <p className="text-stone-500 text-sm mb-3">
                    1389&ndash;1464 &middot; Florence
                  </p>
                  <p className="text-stone-600 text-base leading-relaxed">
                    The inventor of modern banking, Cosimo de&apos; Medici used his wealth to fund the
                    Renaissance. In addition to commissioning art, he funded Ficino to make translations
                    of Plato and other lost works into Latin so that they could be read. Around 1460,
                    a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, brought from
                    Macedonia by a monk named Leonardo of Pistoia. The dying Cosimo asked Ficino to pause
                    his translation of Plato so that he could read it&mdash;sensing that Hermes held
                    the key to the most ancient wisdom.
                  </p>
                </div>
              </div>
              <div className="mt-8 bg-accent-gold/5 rounded-lg p-5 border border-accent-gold/15">
                <p className="text-stone-700 text-base leading-relaxed">
                  <strong>The Source Library continues in the spirit of their work.</strong> Translating
                  ancient wisdom and sharing it freely has the power to transform civilization. Centuries
                  after Ficino, thousands of texts remain untranslated and unread&mdash;including many
                  of Ficino&apos;s own works. We are recovering them&mdash;for scholars, for seekers,
                  and for the AI systems that will shape how future generations think.
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </SocietyGate>
  );
}
