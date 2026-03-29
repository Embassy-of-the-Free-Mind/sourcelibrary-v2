import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowRight, Sparkles, Library } from 'lucide-react';
import { bookUrl } from '@/lib/slugify';
import FeaturedCollectionCarousel from '@/components/prototype/FeaturedCollectionHero';
import LayoutFeaturedCollections from '@/components/layout/FeaturedCollections';
import CollectionsShowcase, { type CollectionSummary } from '@/components/home/CollectionsShowcase';
import FeaturedCollectionNoon from './FeaturedCollectionNoon';
import FeaturedCollection4pm from './FeaturedCollection4pm';

export const revalidate = 600;
export const maxDuration = 60;

// ---------- Data fetching (reuse home page pattern) ----------

interface FeaturedBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  thumbnail?: string;
  thumbnail_blob?: string;
}

interface CollectionData {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
  hero_image: string | null;
}

interface GalleryImage {
  id: string;
  image_url: string;
  type: string;
  museum_description: string;
  book_title: string;
  book_id: string;
  book_slug?: string;
}

interface FeaturedCollectionItem {
  collection: CollectionData;
  books: FeaturedBook[];
  galleryImages?: GalleryImage[];
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return dt && dt !== 'None' ? dt : book.title;
}

async function getFeaturedCollection(): Promise<FeaturedCollectionItem | null> {
  const db = await getDb();

  // Get a well-populated collection
  const collections = await db
    .collection('collections')
    .aggregate([
      {
        $match: {
          book_count: { $gte: 10 },
          parent: { $exists: false },
          type: { $ne: 'curated' },
          hidden: { $ne: true },
        },
      },
      { $sample: { size: 1 } },
    ])
    .toArray();

  if (collections.length === 0) return null;
  const col = collections[0];

  const bookProjection = {
    _id: 0,
    id: { $ifNull: ['$id', { $toString: '$_id' }] },
    slug: 1,
    title: 1,
    display_title: 1,
    author: 1,
    thumbnail: 1,
    thumbnail_blob: 1,
  };

  // Get highlighted books first
  const highlightedIds = (col.highlighted_books || [])
    .filter((b: { tier?: number }) => !b.tier || b.tier <= 2)
    .slice(0, 12)
    .map((b: { book_id: string }) => b.book_id);

  let books: FeaturedBook[] = [];
  if (highlightedIds.length > 0) {
    books = (await db
      .collection('books')
      .aggregate(
        [
          {
            $match: {
              $or: [
                { id: { $in: highlightedIds } },
                { _id: { $in: highlightedIds } },
              ],
              hidden: { $ne: true },
              pages_count: { $gt: 0 },
              pages_translated: { $gt: 0 },
            },
          },
          { $project: bookProjection },
        ],
        { maxTimeMS: 8000 }
      )
      .toArray()) as FeaturedBook[];
  }

  // Backfill if needed
  if (books.length < 12) {
    const existingIds = new Set(books.map((b) => b.id));
    const backfill = (await db
      .collection('books')
      .aggregate(
        [
          {
            $match: {
              collections: col.slug,
              hidden: { $ne: true },
              pages_count: { $gt: 0 },
              pages_translated: { $gt: 0 },
              thumbnail_blob: { $exists: true, $ne: null },
            },
          },
          { $sort: { read_count: -1 } },
          { $limit: 20 },
          { $project: bookProjection },
        ],
        { maxTimeMS: 8000 }
      )
      .toArray()) as FeaturedBook[];

    for (const b of backfill) {
      if (!existingIds.has(b.id) && books.length < 12) {
        books.push(b);
        existingIds.add(b.id);
      }
    }
  }

  const images = col.featured_images || [];
  const hero = images.find(
    (img: unknown) =>
      typeof img === 'string' ||
      (img &&
        typeof img === 'object' &&
        ((img as Record<string, unknown>).extracted_url ||
          (img as Record<string, unknown>).image_url))
  );
  const heroUrl =
    typeof hero === 'string'
      ? hero
      : (((hero as Record<string, unknown>)?.extracted_url ||
          (hero as Record<string, unknown>)?.image_url ||
          null) as string | null);

  return {
    collection: {
      slug: col.slug as string,
      name: col.name as string,
      subtitle: (col.subtitle || '') as string,
      description: (col.description || '') as string,
      book_count: (col.book_count || 0) as number,
      hero_image: heroUrl,
    },
    books: JSON.parse(JSON.stringify(books)),
  };
}

async function getMultipleFeaturedCollections(): Promise<FeaturedCollectionItem[]> {
  const db = await getDb();

  const collections = await db
    .collection('collections')
    .aggregate([
      {
        $match: {
          book_count: { $gte: 10 },
          parent: { $exists: false },
          type: { $ne: 'curated' },
          hidden: { $ne: true },
        },
      },
      { $sample: { size: 5 } },
    ])
    .toArray();

  if (collections.length === 0) return [];

  const bookProjection = {
    _id: 0,
    id: { $ifNull: ['$id', { $toString: '$_id' }] },
    slug: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1,
  };

  const results: FeaturedCollectionItem[] = [];
  for (const col of collections) {
    // Get books for this collection
    const colBooks = (await db.collection('books').aggregate([
      { $match: { collections: col.slug, hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, thumbnail_blob: { $exists: true, $ne: null } } },
      { $sort: { read_count: -1 } },
      { $limit: 10 },
      { $project: bookProjection },
    ], { maxTimeMS: 8000 }).toArray()) as FeaturedBook[];

    if (colBooks.length === 0) continue;

    const images = col.featured_images || [];
    const hero = images.find(
      (img: unknown) => typeof img === 'string' || (img && typeof img === 'object' && ((img as Record<string, unknown>).extracted_url || (img as Record<string, unknown>).image_url))
    );
    const heroUrl = typeof hero === 'string' ? hero : (((hero as Record<string, unknown>)?.extracted_url || (hero as Record<string, unknown>)?.image_url || null) as string | null);

    results.push({
      collection: {
        slug: col.slug as string,
        name: col.name as string,
        subtitle: (col.subtitle || '') as string,
        description: (col.description || '') as string,
        book_count: (col.book_count || 0) as number,
        hero_image: heroUrl,
      },
      books: JSON.parse(JSON.stringify(colBooks)),
      galleryImages: JSON.parse(JSON.stringify(col.curated_gallery || [])),
    });
  }
  return results;
}

async function getCollectionSummaries(): Promise<CollectionSummary[]> {
  const db = await getDb();
  const docs = await db.collection('collections').find(
    { parent: { $exists: false }, type: { $ne: 'curated' }, hidden: { $ne: true }, book_count: { $gte: 5 } },
    { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, book_count: 1, featured_images: 1, languages: 1 } }
  ).limit(8).toArray();

  return docs.map(doc => ({
    slug: doc.slug,
    name: doc.name,
    subtitle: doc.subtitle || '',
    book_count: doc.book_count || 0,
    featured_images: doc.featured_images,
    languages: doc.languages,
  })) as CollectionSummary[];
}

// ---------- Page ----------

export default async function DesignOptionsPage() {
  const session = await auth();
  if ((session?.user as any)?.role !== 'admin') redirect('/');

  const [data, carouselItems, showcaseCollections] = await Promise.all([
    getFeaturedCollection(),
    getMultipleFeaturedCollections(),
    getCollectionSummaries(),
  ]);

  if (!data) {
    return (
      <div className="min-h-screen bg-bg-cream flex items-center justify-center">
        <p className="text-muted">No collection data available. Refresh to try again.</p>
      </div>
    );
  }

  const { collection, books } = data;

  return (
    <div className="min-h-screen bg-bg-cream">
      {/* Page header */}
      <div className="bg-white border-b border-border-light">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
          <Link href="/" className="text-sm text-muted hover:text-accent-rust transition-colors">
            &larr; Back to home
          </Link>
          <h1 className="text-3xl md:text-4xl font-display text-primary mt-4">
            Featured Collection — Design Options
          </h1>
          <p className="text-muted mt-2 max-w-2xl">
            Three layout options for the featured collection section on the home page.
            All using the same real data from <strong>{collection.name}</strong> ({collection.book_count} books).
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          EXISTING VERSIONS
      ═══════════════════════════════════════════════════════════════ */}

      <div className="max-w-7xl mx-auto px-6 md:px-12 mt-12 mb-6">
        <div className="border-b-2 border-accent-rust/20 pb-2 mb-2">
          <h2 className="text-xl font-display text-accent-rust uppercase tracking-wider">Existing Versions</h2>
        </div>
        <p className="text-sm text-muted">Currently built components, shown with real data.</p>
      </div>

      {/* Existing 1: FeaturedCollectionCarousel (current home page) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-10 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-muted font-medium">Existing 1</span>
          <h2 className="text-2xl font-display text-primary mt-1">Dark Carousel (current home page)</h2>
          <p className="text-sm text-muted mt-1">
            The current implementation. Dark background, text left + book thumbnail grid right,
            carousel dots and arrows to flip between collections.
          </p>
        </div>
      </div>
      {carouselItems.length > 0 && <FeaturedCollectionCarousel items={carouselItems} />}

      {/* Existing 2: Layout FeaturedCollections (file-based card grid) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-16 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-muted font-medium">Existing 2</span>
          <h2 className="text-2xl font-display text-primary mt-1">Category Card Grid</h2>
          <p className="text-sm text-muted mt-1">
            6 collections in a 3-col grid with category color-coding, theme pills, and date ranges.
            No images — text-only cards. Rotates daily via seeded shuffle.
          </p>
        </div>
      </div>
      <LayoutFeaturedCollections />

      {/* Existing 3: CollectionsShowcase (image-heavy two-tier) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-16 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-muted font-medium">Existing 3</span>
          <h2 className="text-2xl font-display text-primary mt-1">Image Showcase (two-tier)</h2>
          <p className="text-sm text-muted mt-1">
            Photo-heavy cards with gradient overlays. Top 6 large (2-col), rest smaller (3-col).
            Used on the search/library page. Shows book count, languages, subtitle.
          </p>
        </div>
        <div className="mb-16">
          <CollectionsShowcase collections={showcaseCollections} />
        </div>
      </div>

      {/* Existing 4: Noon version (gallery hero + 2 side squares) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-16 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-muted font-medium">Existing 4 &mdash; Yesterday ~12:00</span>
          <h2 className="text-2xl font-display text-primary mt-1">Gallery Hero + Side Squares</h2>
          <p className="text-sm text-muted mt-1">
            Gallery illustration as the main hero image (3fr) with two square gallery images stacked beside it (2fr).
            Falls back to book thumbnail grid when no gallery images are available.
            Fade transition between collections.
          </p>
        </div>
      </div>
      <FeaturedCollectionNoon items={carouselItems} />

      {/* Existing 5: 4pm version (text | tall hero | book list) */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-16 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-muted font-medium">Existing 5 &mdash; Yesterday ~16:00</span>
          <h2 className="text-2xl font-display text-primary mt-1">Three-Column: Text | Hero Illustration | Book List</h2>
          <p className="text-sm text-muted mt-1">
            Three-column layout: text description left, tall gallery illustration center (280x420, object-contain),
            book title list with tiny thumbnails right. Keyboard arrow support. Most editorial of the existing versions.
          </p>
        </div>
      </div>
      <FeaturedCollection4pm items={carouselItems} />

      {/* ═══════════════════════════════════════════════════════════════
          NEW OPTIONS
      ═══════════════════════════════════════════════════════════════ */}

      <div className="max-w-7xl mx-auto px-6 md:px-12 mt-8 mb-6">
        <div className="border-b-2 border-accent-rust/20 pb-2 mb-2">
          <h2 className="text-xl font-display text-accent-rust uppercase tracking-wider">New Options</h2>
        </div>
        <p className="text-sm text-muted">
          Three new approaches, all showing <strong>{collection.name}</strong>.
        </p>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-12">

        {/* ═══════════════════════════════════════════════════════════════
            OPTION A — "Editorial Spread"
            Full-width dark section with large hero image + overlaid text + book strip
        ═══════════════════════════════════════════════════════════════ */}
        <div className="mt-16 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-accent-rust font-medium">Option A</span>
          <h2 className="text-2xl font-display text-primary mt-1">Editorial Spread</h2>
          <p className="text-sm text-muted mt-1">
            Magazine-style hero with a large background image, overlaid text, and a horizontal book strip below.
            Dramatic, visual-first — draws the eye like a museum exhibition entrance.
          </p>
        </div>
      </div>

      <section className="relative overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0">
          {collection.hero_image ? (
            <Image
              src={collection.hero_image}
              alt=""
              fill
              className="object-cover"
              sizes="100vw"
              quality={85}
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#2a2018] to-[#1a1612]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 md:px-12 py-16 md:py-24">
          <div className="max-w-xl">
            <span className="text-xs uppercase tracking-[0.2em] text-accent-gold/80 mb-4 block">
              Featured Collection
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-display text-white leading-[1.1] mb-4">
              {collection.name}
            </h2>
            {collection.subtitle && (
              <p className="text-xl text-white/70 leading-relaxed mb-4 font-body">
                {collection.subtitle}
              </p>
            )}
            {collection.description && (
              <p className="text-base text-white/50 leading-relaxed mb-8 line-clamp-3 font-body">
                {collection.description}
              </p>
            )}
            <Link
              href={`/collections/${collection.slug}`}
              className="inline-flex items-center gap-2 bg-accent-gold/90 hover:bg-accent-gold text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              Explore {collection.book_count} books
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Book strip at the bottom */}
        <div className="relative border-t border-white/10 bg-black/60 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 md:px-12 py-6">
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
              {books.slice(0, 8).map((book) => {
                const thumb = book.thumbnail_blob || book.thumbnail;
                return (
                  <Link key={book.id} href={bookUrl(book)} className="group flex-shrink-0">
                    <div className="w-[100px] md:w-[120px] aspect-[3/4] relative rounded-lg overflow-hidden bg-white/5 border border-white/10 group-hover:border-accent-gold/50 transition-all">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(book)}
                          fill
                          quality={80}
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="120px"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-6 h-6 text-white/20" />
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-white/40 mt-1.5 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight w-[100px] md:w-[120px]">
                      {bookTitle(book)}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          OPTION B — "Gallery Wall"
          Clean, light background with staggered book grid and text beside it.
          Museum-like, calm, lets the books speak for themselves.
      ═══════════════════════════════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-20 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-accent-rust font-medium">Option B</span>
          <h2 className="text-2xl font-display text-primary mt-1">Gallery Wall</h2>
          <p className="text-sm text-muted mt-1">
            Light, airy layout with a masonry-style book grid. Museum gallery feel —
            the books are the art, displayed like objects on a white wall.
          </p>
        </div>
      </div>

      <section className="bg-white border-y border-border-light">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-14 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
            {/* Left: text */}
            <div className="lg:col-span-4 flex flex-col justify-center">
              <div className="flex items-center gap-2 mb-4">
                <Library className="w-4 h-4 text-accent-rust" />
                <span className="text-xs uppercase tracking-[0.15em] text-accent-rust font-medium">
                  Featured Collection
                </span>
              </div>
              <h2 className="text-3xl md:text-4xl font-display text-primary leading-tight mb-3">
                {collection.name}
              </h2>
              {collection.subtitle && (
                <p className="text-lg text-secondary leading-relaxed mb-3 font-body">
                  {collection.subtitle}
                </p>
              )}
              {collection.description && (
                <p className="text-base text-muted leading-relaxed mb-6 line-clamp-4 font-body">
                  {collection.description}
                </p>
              )}
              <Link
                href={`/collections/${collection.slug}`}
                className="group inline-flex items-center gap-2 text-sm text-accent-rust hover:text-accent-rust/80 transition-colors font-medium"
              >
                Explore {collection.book_count} books
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            {/* Right: staggered book grid */}
            <div className="lg:col-span-8">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-5 gap-y-6">
                {books.slice(0, 10).map((book, i) => {
                  const thumb = book.thumbnail_blob || book.thumbnail;
                  // Stagger: odd items get a slight top offset
                  const offset = i % 2 === 1 ? 'mt-6' : '';
                  return (
                    <Link key={book.id} href={bookUrl(book)} className={`group ${offset}`}>
                      <div className="aspect-[3/4] relative rounded-xl overflow-hidden bg-bg-warm shadow-sm group-hover:shadow-md transition-all group-hover:-translate-y-1">
                        {thumb ? (
                          <Image
                            src={thumb}
                            alt={bookTitle(book)}
                            fill
                            quality={85}
                            className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
                            sizes="(max-width: 640px) 30vw, (max-width: 1024px) 20vw, 15vw"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-bg-warm">
                            <BookOpen className="w-8 h-8 text-muted/30" />
                          </div>
                        )}
                      </div>
                      <div className="mt-2">
                        <p className="text-xs text-primary/80 font-medium line-clamp-2 leading-tight group-hover:text-accent-rust transition-colors">
                          {bookTitle(book)}
                        </p>
                        <p className="text-[11px] text-muted line-clamp-1 mt-0.5">
                          {book.author}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          OPTION C — "Cabinet of Curiosities"
          Dark, intimate layout with a featured "hero book" and supporting cast.
          Evokes the feeling of opening a scholar's private collection.
      ═══════════════════════════════════════════════════════════════ */}
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="mt-20 mb-6">
          <span className="text-xs uppercase tracking-[0.2em] text-accent-rust font-medium">Option C</span>
          <h2 className="text-2xl font-display text-primary mt-1">Cabinet of Curiosities</h2>
          <p className="text-sm text-muted mt-1">
            Intimate, scholar&apos;s-study feel. One hero book large, with supporting texts arranged around it.
            Warm and dark, like peering into a private collection by candlelight.
          </p>
        </div>
      </div>

      <section className="bg-[#1c1917]">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-14 md:py-20">
          {/* Header */}
          <div className="flex items-center justify-between mb-10">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-accent-gold" />
                <span className="text-xs uppercase tracking-[0.2em] text-accent-gold/70">
                  Featured Collection
                </span>
              </div>
              <h2 className="text-3xl md:text-4xl font-display text-white leading-tight">
                {collection.name}
              </h2>
            </div>
            <Link
              href={`/collections/${collection.slug}`}
              className="hidden sm:inline-flex items-center gap-2 text-sm text-accent-gold hover:text-accent-gold/80 transition-colors"
            >
              View all {collection.book_count}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {collection.subtitle && (
            <p className="text-lg text-white/60 leading-relaxed mb-10 max-w-2xl font-body">
              {collection.subtitle}
            </p>
          )}

          {/* Hero book + supporting grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Hero book — large */}
            {books[0] && (
              <Link
                href={bookUrl(books[0])}
                className="lg:col-span-5 group"
              >
                <div className="aspect-[3/4] relative rounded-2xl overflow-hidden bg-white/5 border border-white/10 group-hover:border-accent-gold/30 transition-all">
                  {(books[0].thumbnail_blob || books[0].thumbnail) ? (
                    <Image
                      src={(books[0].thumbnail_blob || books[0].thumbnail)!}
                      alt={bookTitle(books[0])}
                      fill
                      quality={90}
                      className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
                      sizes="(max-width: 1024px) 100vw, 40vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <BookOpen className="w-16 h-16 text-white/10" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
                    <p className="text-sm text-white/50 mb-1">{books[0].author}</p>
                    <h3 className="text-xl md:text-2xl font-display text-white group-hover:text-accent-gold transition-colors leading-tight">
                      {bookTitle(books[0])}
                    </h3>
                  </div>
                </div>
              </Link>
            )}

            {/* Supporting books — 2x3 grid */}
            <div className="lg:col-span-7 grid grid-cols-3 gap-4 md:gap-5">
              {books.slice(1, 7).map((book) => {
                const thumb = book.thumbnail_blob || book.thumbnail;
                return (
                  <Link key={book.id} href={bookUrl(book)} className="group">
                    <div className="aspect-[3/4] relative rounded-xl overflow-hidden bg-white/5 border border-white/[0.06] group-hover:border-white/20 transition-all">
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={bookTitle(book)}
                          fill
                          quality={80}
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 30vw, 18vw"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <BookOpen className="w-6 h-6 text-white/10" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/40 mt-2 line-clamp-2 group-hover:text-white/70 transition-colors leading-tight">
                      {bookTitle(book)}
                    </p>
                    <p className="text-[10px] text-white/25 mt-0.5 line-clamp-1">
                      {book.author}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Mobile link */}
          <div className="sm:hidden mt-8 text-center">
            <Link
              href={`/collections/${collection.slug}`}
              className="inline-flex items-center gap-2 text-sm text-accent-gold hover:text-accent-gold/80 transition-colors"
            >
              View all {collection.book_count} books
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer spacer */}
      <div className="h-20" />
    </div>
  );
}
