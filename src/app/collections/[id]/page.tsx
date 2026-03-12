import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, Images, ArrowLeft } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import CollectionSchema from '@/components/seo/CollectionSchema';
import CollectionAllBooks from '@/components/collections/CollectionAllBooks';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { bookUrl } from '@/lib/slugify';

// ISR: rebuild at most every 10 minutes
export const revalidate = 600;
export const dynamicParams = true;
export const maxDuration = 60;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface Props {
  params: Promise<{ id: string }>;
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    const db = await Promise.race([
      getDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 5000)),
    ]);
    const collection = await db.collection('collections').findOne({ slug: id });

    if (!collection) {
      return { title: 'Collection Not Found - Source Library' };
    }

    const description = collection.description
      ? String(collection.description).slice(0, 200)
      : `Browse the ${collection.name} collection on Source Library.`;

    return {
      title: `${collection.name} - Source Library`,
      description,
      alternates: { canonical: `/collections/${id}` },
      openGraph: {
        title: `${collection.name} - Source Library`,
        description,
        type: 'website',
      },
    };
  } catch {
    return { title: 'Collection - Source Library' };
  }
}

// ---------- Helpers ----------

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  categories?: string[];
  published?: string;
  read_count?: number;
}

/** Auto-link book titles found in description text to their book pages.
 *  Explicit mentions (from collection.mentioned_books) take priority over auto-detection. */
function linkBookTitles(
  text: string,
  allBooks: BookItem[],
  explicitMentions?: { text: string; book_id: string }[],
): React.ReactNode {
  const matches: { start: number; end: number; title: string; id: string }[] = [];
  const usedRanges: [number, number][] = [];

  // 1. Explicit mentions first (highest priority — exact text from description)
  if (explicitMentions?.length) {
    // Sort longest first to avoid partial matches
    const sorted = [...explicitMentions].sort((a, b) => b.text.length - a.text.length);
    for (const { text: mentionText, book_id } of sorted) {
      const escaped = mentionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        const regex = new RegExp(escaped, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
          const start = match.index;
          const end = start + match[0].length;
          if (!usedRanges.some(([s, e]) => start < e && end > s)) {
            matches.push({ start, end, title: match[0], id: book_id });
            usedRanges.push([start, end]);
          }
        }
      } catch { /* skip bad regex */ }
    }
  }

  // 2. Auto-detect from book titles (fills gaps not covered by explicit mentions)
  const titleMap: { title: string; id: string }[] = [];
  for (const book of allBooks) {
    const id = book.id;
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None') titleMap.push({ title: dt, id });
    if (t && t !== dt) titleMap.push({ title: t, id });
  }
  titleMap.sort((a, b) => b.title.length - a.title.length);

  for (const { title, id } of titleMap.filter(t => t.title.length >= 8)) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id });
        usedRanges.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;
  matches.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) parts.push(text.slice(lastIdx, m.start));
    parts.push(
      <Link key={m.id + '-' + m.start} href={`/book/${m.id}`} className="text-accent-rust hover:underline italic">
        {m.title}
      </Link>
    );
    lastIdx = m.end;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts}</>;
}

// ---------- Data fetching ----------

const COMPACT_LIMIT = 14;

/** Sanitize thumbnail URLs: unwrap /api/image?url= wrappers, reject non-http URLs.
 *  The /api/image wrapper crashes Next.js Image during SSR. */
function sanitizeThumbnail(url: string | undefined): string | undefined {
  if (!url) return undefined;
  // Unwrap /api/image?url=ENCODED proxy wrapper
  if (url.startsWith('/api/image')) {
    const match = url.match(/[?&]url=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
    return undefined;
  }
  // Only allow absolute http(s) URLs for Next.js Image
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return undefined;
}

/** Race a promise against a timeout — returns fallback on timeout or error */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function fetchCollectionData(id: string) {
  // Wrap getDb() in a timeout — when MongoDB Atlas is overloaded, the connection
  // itself can hang for 60+ seconds. Better to fail fast and let ISR retry.
  const db = await withTimeout(getDb(), 10000, null as unknown as Awaited<ReturnType<typeof getDb>>);
  if (!db) return null;

  const collection = await withTimeout(
    db.collection('collections').findOne({ slug: id }),
    8000, null,
  );
  if (!collection) return null;

  const filter: Record<string, unknown> = {
    collections: id,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
  };

  const projection = {
    _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
  };

  const highlightProjection = {
    ...projection,
    reading_summary: 1,
    quality_score: 1,
  };

  const mentionedBookIds = (collection.mentioned_books || [])
    .map((m: { book_id: string }) => m.book_id)
    .filter(Boolean);

  // Use collection doc's book_count instead of expensive countDocuments.
  // The client component re-fetches the accurate filtered total when expanded.
  const total = collection.book_count || 0;

  // All queries run in parallel with timeouts. Cold MongoDB connections from
  // Mumbai→Virginia can take 15-20s, so even "critical" queries need protection.
  const [books, highlights, galleryImages, mentionedBooks] = await Promise.all([
    withTimeout(
      db.collection('books')
        .find(filter, { projection })
        .sort({ read_count: -1, title: 1 })
        .limit(COMPACT_LIMIT)
        .toArray(),
      15000, [],
    ),
    withTimeout(
      db.collection('books')
        .find(
          { collections: id, status: { $ne: 'deleted' }, hidden: { $ne: true }, pages_translated: { $gt: 0 } },
          { projection: highlightProjection },
        )
        .sort({ read_count: -1 })
        .limit(5)
        .toArray(),
      8000, [],
    ),
    // Gallery: use pre-curated images if available, otherwise fall back to dynamic query
    collection.curated_gallery_images?.length > 0
      ? Promise.resolve(collection.curated_gallery_images)
      : withTimeout(
          db.collection('books')
            .find({ collections: id, status: { $ne: 'deleted' }, hidden: { $ne: true } }, { projection: { id: 1 } })
            .toArray()
            .then(docs => docs.map(d => d.id))
            .then(bookIds => bookIds.length > 0
              ? db.collection('gallery_images')
                  .find({
                    book_id: { $in: bookIds },
                    gallery_quality: { $gte: 0.8 },
                    type: { $nin: ['decorative', 'symbol', 'musical_score', 'printer_device', 'printer_mark', 'ornament', 'border'] },
                  })
                  .sort({ gallery_quality: -1 })
                  .limit(60)
                  .toArray()
              : [],
            ),
          8000, [],
        ),
    mentionedBookIds.length > 0
      ? withTimeout(
          db.collection('books')
            .find({ id: { $in: mentionedBookIds } }, { projection })
            .toArray(),
          8000, [],
        )
      : Promise.resolve([]),
  ]);

  const { _id, ...collectionClean } = collection;

  // Sanitize thumbnails to prevent /api/image wrapper URLs from crashing Next.js Image
  const sanitizeBookThumbs = (items: Record<string, unknown>[]) =>
    items.map(b => ({ ...b, thumbnail: sanitizeThumbnail(b.thumbnail as string) }));

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collection: collectionClean as any,
    books: sanitizeBookThumbs(books) as unknown as BookItem[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    highlights: sanitizeBookThumbs(highlights) as any[],
    total,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
    mentionedBooks: sanitizeBookThumbs(mentionedBooks) as unknown as BookItem[],
  };
}

// ---------- Page ----------

export default async function CollectionDetailPage({ params }: Props) {
  const { id } = await params;

  let data;
  try {
    data = await fetchCollectionData(id);
  } catch (err) {
    console.error('[Collection page] fetchCollectionData failed:', err instanceof Error ? err.message : err);
    // Show a temporary error page instead of 500 — ISR won't cache this
    // because we return a response, not throw
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h1>
          <p className="text-secondary mb-6">This collection is taking longer than expected to load. Please try again in a moment.</p>
          <Link href="/" className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }
  if (!data) notFound();

  const { collection, books, highlights, galleryImages, total, mentionedBooks } = data;
  const languages = (collection.languages || []).filter((l: { count: number }) => l.count > 2);

  // Diversify gallery images: max 1 per book (no duplicates), skip images without thumbnails
  const diverseGalleryImages: typeof galleryImages = [];
  const seenBooks = new Set<string>();
  for (const img of galleryImages) {
    const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
    if (!thumb) continue;
    const bid = img.book_id || img.bookId;
    if (seenBooks.has(bid)) continue;
    seenBooks.add(bid);
    diverseGalleryImages.push(img);
    if (diverseGalleryImages.length >= 11) break;
  }

  const heroImages = diverseGalleryImages.slice(0, 6);
  const allBooksForLinking = [...highlights, ...books, ...mentionedBooks];
  const explicitMentions: { text: string; book_id: string }[] = collection.mentioned_books || [];

  return (
    <div className="min-h-screen bg-cream">
      <CollectionSchema
        slug={id}
        name={collection.name}
        description={collection.expanded_description || collection.description}
        bookCount={total}
        books={books.map(b => ({
          id: b.id,
          slug: b.slug,
          title: bookTitle(b),
          author: b.author,
          year: b.year,
        }))}
      />
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        {heroImages.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 opacity-30">
            {heroImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string }) => {
              const src = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
              const key = `${img.pageId || img.page_id}-${img.detectionIndex ?? img.detection_index}`;
              if (!src) return null;
              return (
                <div key={key} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                </div>
              );
            })}
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-b from-dark/60 via-dark/80 to-dark" />

        <div className="relative max-w-6xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href="/#library"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Library
          </Link>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {collection.name}
          </h1>

          {collection.subtitle && (
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-4">
              {collection.subtitle}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString('en-US')} books</span>
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.map((l: { lang: string }) => l.lang).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gallery Grid */}
      {diverseGalleryImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-6xl mx-auto px-6 py-6">
            <h2
              className="text-xl sm:text-2xl text-primary mb-4 font-display"
            >
              Illustrations
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {diverseGalleryImages.map((img: { pageId?: string; page_id?: string; bookId?: string; book_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
                const thumb = img.extracted_url || img.extractedUrl || img.thumbnail_url || img.thumbnailUrl || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const bookId = img.bookId || img.book_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                return (
                  <Link
                    key={galleryId}
                    href={`/book/${bookId}/page/${pageId}`}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 160px, (min-width: 640px) 140px, 120px"
                      />
                    ) : (
                      <div className="w-full h-full bg-cream flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    {img.type && (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
              <Link
                href={`/gallery?collection=${id}`}
                className="aspect-square rounded-lg border border-border-light bg-cream hover:bg-white hover:border-accent-rust/30 transition-all flex flex-col items-center justify-center gap-2 text-muted hover:text-accent-rust"
              >
                <Images className="w-7 h-7" />
                <span className="text-xs font-medium">Browse gallery</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Description */}
        {(collection.expanded_description || collection.description) && (
          <div className="mb-10 max-w-5xl">
            {(collection.expanded_description || collection.description)!.split('\n\n').map((para: string, i: number) => (
              <p key={i} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0 font-body">
                {linkBookTitles(para, allBooksForLinking, explicitMentions)}
              </p>
            ))}
          </div>
        )}

        {/* Highlights */}
        {highlights.length > 0 && (
          <div className="mb-12">
            <h2
              className="text-2xl sm:text-3xl text-primary mb-6 font-display"
            >
              Highlights
            </h2>
            <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.slice(0, 3).map((book: { id: string; slug?: string; display_title?: string; title: string; author?: string; year?: number; language?: string; pages_count?: number; thumbnail?: string; reading_summary?: { overview?: string } }) => {
                const summary = book.reading_summary?.overview;
                const snippet = summary
                  ? summary.length > 160 ? summary.slice(0, 160).replace(/\s+\S*$/, '') + '...' : summary
                  : null;

                return (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group flex gap-4 p-4 rounded-xl bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all"
                  >
                    <div className="w-20 sm:w-24 flex-shrink-0">
                      <div className="aspect-[3/4] relative rounded-lg overflow-hidden bg-warm">
                        {book.thumbnail ? (
                          <Image
                            src={book.thumbnail}
                            alt={bookTitle(book)}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-300"
                            sizes="96px"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <BookOpen className="w-8 h-8 text-muted" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 py-1">
                      <h3
                        className="font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-1 font-display"
                      >
                        {bookTitle(book)}
                      </h3>
                      {book.author && (
                        <p className="text-sm text-muted mb-2">{book.author}{book.year ? `, ${book.year}` : ''}</p>
                      )}
                      {snippet && (
                        <p className="text-xs text-secondary leading-relaxed line-clamp-3">
                          {snippet}
                        </p>
                      )}
                      {!snippet && book.language && (
                        <p className="text-xs text-muted">
                          {book.language}{book.pages_count ? ` · ${book.pages_count} pages` : ''}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
            {highlights.length > 3 && (
              <div className="mt-4 grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2">
                {highlights.slice(3).map((book: { id: string; slug?: string; display_title?: string; title: string; author?: string; year?: number; thumbnail?: string }) => (
                  <Link
                    key={book.id}
                    href={bookUrl(book)}
                    className="group flex items-center gap-3 p-3 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all"
                  >
                    <div className="w-12 flex-shrink-0">
                      <div className="aspect-[3/4] relative rounded overflow-hidden bg-warm">
                        {book.thumbnail ? (
                          <Image
                            src={book.thumbnail}
                            alt={bookTitle(book)}
                            fill
                            className="object-cover"
                            sizes="48px"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <BookOpen className="w-4 h-4 text-muted" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors truncate">
                        {bookTitle(book)}
                      </h4>
                      <p className="text-xs text-muted truncate">
                        {book.author}{book.year ? `, ${book.year}` : ''}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* All Books — client component handles compact → expanded transition */}
        <CollectionAllBooks
          collectionId={id}
          compactBooks={books}
          total={total}
          languages={languages}
        />
      </div>
      <SignUpCTA />
    </div>
  );
}
