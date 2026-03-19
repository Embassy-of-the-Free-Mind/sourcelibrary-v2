import { getDb } from '@/lib/mongodb';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ArrowRight } from 'lucide-react';
import { bookUrl } from '@/lib/slugify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface FeaturedBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  thumbnail?: string;
  thumbnail_blob?: string;
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return dt && dt !== 'None' ? dt : book.title;
}

interface CollectionWithBooks {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  book_count: number;
  hero_image: string | null;
  books: FeaturedBook[];
}

async function getAllCollectionsWithBooks(): Promise<CollectionWithBooks[]> {
  const db = await getDb();

  const collections = await db.collection('collections').find(
    { parent: { $exists: false }, type: { $ne: 'curated' }, hidden: { $ne: true }, book_count: { $gte: 5 } },
    { projection: { slug: 1, name: 1, subtitle: 1, description: 1, book_count: 1, featured_images: 1, curated_gallery: 1, highlighted_books: 1 } }
  ).sort({ book_count: -1 }).toArray();

  const bookProjection = {
    _id: 0,
    id: { $ifNull: ['$id', { $toString: '$_id' }] },
    slug: 1, title: 1, display_title: 1, author: 1, thumbnail: 1, thumbnail_blob: 1,
  };

  // Track used hero image URLs to avoid duplicates across collections
  const usedHeroUrls = new Set<string>();

  // Collect all highlighted book IDs to batch-fetch
  const allHighlightedIds: string[] = [];
  const highlightedIdsBySlug = new Map<string, string[]>();
  for (const col of collections) {
    const ids = (col.highlighted_books || [])
      .filter((b: { tier?: number }) => !b.tier || b.tier <= 2)
      .slice(0, 8)
      .map((b: { book_id: string }) => b.book_id);
    highlightedIdsBySlug.set(col.slug as string, ids);
    allHighlightedIds.push(...ids);
  }

  // Batch-fetch all highlighted books in one query
  const highlightedBooks = allHighlightedIds.length > 0
    ? await db.collection('books').aggregate([
        { $match: { $or: [{ id: { $in: allHighlightedIds } }, { _id: { $in: allHighlightedIds } }], hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } } },
        { $project: bookProjection },
      ], { maxTimeMS: 10000 }).toArray()
    : [];
  const highlightedById = new Map(highlightedBooks.map(b => [b.id, b]));

  const results: CollectionWithBooks[] = [];

  for (const col of collections) {
    // Pick a unique hero image — try each gallery image until we find one not yet used
    const gallery = col.curated_gallery || [];
    const fi = col.featured_images || [];
    let finalHero: string | null = null;

    // Try curated_gallery images first
    for (const img of gallery) {
      const url = img?.image_url as string;
      if (url && !usedHeroUrls.has(url)) {
        finalHero = url;
        usedHeroUrls.add(url);
        break;
      }
    }

    // Fallback to featured_images
    if (!finalHero) {
      for (const img of fi) {
        const url = typeof img === 'string' ? img : ((img as Record<string, unknown>)?.extracted_url || (img as Record<string, unknown>)?.image_url) as string;
        if (url && !usedHeroUrls.has(url)) {
          finalHero = url;
          usedHeroUrls.add(url);
          break;
        }
      }
    }

    // Get books: prefer highlighted (curated) books, backfill with popular
    const slug = col.slug as string;
    const hIds = highlightedIdsBySlug.get(slug) || [];
    const curatedBooks = hIds.map(id => highlightedById.get(id)).filter(Boolean) as FeaturedBook[];

    let books = curatedBooks;
    if (books.length < 8) {
      const existingIds = new Set(books.map(b => b.id));
      const backfill = (await db.collection('books').aggregate([
        { $match: { collections: slug, hidden: { $ne: true }, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 }, thumbnail_blob: { $exists: true, $ne: null } } },
        { $sort: { read_count: -1 } },
        { $limit: 16 },
        { $project: bookProjection },
      ], { maxTimeMS: 5000 }).toArray()) as FeaturedBook[];

      for (const b of backfill) {
        if (!existingIds.has(b.id) && books.length < 8) {
          books.push(b);
          existingIds.add(b.id);
        }
      }
    }

    results.push({
      slug,
      name: col.name as string,
      subtitle: (col.subtitle || '') as string,
      description: (col.description || '') as string,
      book_count: (col.book_count || 0) as number,
      hero_image: finalHero,
      books: JSON.parse(JSON.stringify(books)),
    });
  }

  return results;
}

export default async function AllEditorialPage() {
  const session = await auth();
  if ((session?.user as any)?.role !== 'admin') redirect('/');

  const collections = await getAllCollectionsWithBooks();

  return (
    <div className="min-h-screen bg-bg-cream">
      {/* Page header */}
      <div className="bg-white border-b border-border-light">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
          <Link href="/design-options" className="text-sm text-muted hover:text-accent-rust transition-colors">
            &larr; Back to design options
          </Link>
          <h1 className="text-3xl md:text-4xl font-display text-primary mt-4">
            Editorial Spread — All Collections
          </h1>
          <p className="text-muted mt-2 max-w-2xl">
            Every collection rendered in the Editorial Spread format. Check which hero images work at full-bleed
            and which fall flat. {collections.length} collections total.
          </p>
        </div>
      </div>

      {collections.map((col, idx) => (
        <div key={col.slug}>
          {/* Collection label */}
          <div className="max-w-7xl mx-auto px-6 md:px-12 pt-12 pb-4">
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-[0.2em] text-accent-rust font-medium">
                {idx + 1} / {collections.length}
              </span>
              <span className="text-xs text-muted">
                {col.book_count} books &middot; {col.books.length} with thumbnails
                {!col.hero_image && ' · NO HERO IMAGE'}
              </span>
            </div>
          </div>

          {/* Editorial Spread */}
          <section className="relative overflow-hidden">
            {/* Background image */}
            <div className="absolute inset-0">
              {col.hero_image ? (
                <Image
                  src={col.hero_image}
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
                  {col.name}
                </h2>
                {col.subtitle && (
                  <p className="text-xl text-white/70 leading-relaxed mb-4 font-body">
                    {col.subtitle}
                  </p>
                )}
                {col.description && (
                  <p className="text-base text-white/50 leading-relaxed mb-8 line-clamp-3 font-body">
                    {col.description}
                  </p>
                )}
                <Link
                  href={`/collections/${col.slug}`}
                  className="inline-flex items-center gap-2 bg-accent-gold/90 hover:bg-accent-gold text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors"
                >
                  Explore {col.book_count} books
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Book strip at the bottom */}
            {col.books.length > 0 && (
              <div className="relative border-t border-white/10 bg-black/60 backdrop-blur-sm">
                <div className="max-w-7xl mx-auto px-6 md:px-12 py-6">
                  <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
                    {col.books.map((book) => {
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
            )}
          </section>
        </div>
      ))}

      <div className="h-20" />
    </div>
  );
}
