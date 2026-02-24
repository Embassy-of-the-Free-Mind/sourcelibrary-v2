import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, Images, ArrowLeft, ArrowRight } from 'lucide-react';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';

const PER_PAGE = 60;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------- Metadata ----------

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const db = await getDb();
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
}

// ---------- Helpers ----------

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

interface BookItem {
  id: string;
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

async function fetchCollectionData(id: string, sort: string, language: string, offset: number) {
  const db = await getDb();

  const collection = await db.collection('collections').findOne({ slug: id });
  if (!collection) return null;

  const filter: Record<string, unknown> = {
    collections: id,
    status: { $ne: 'deleted' },
    hidden: { $ne: true },
    pages_count: { $gt: 0 },
  };
  if (language) filter.language = language;

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    year_asc: { year: 1, title: 1 },
    year_desc: { year: -1, title: 1 },
    title: { title: 1 },
    recent: { created_at: -1 },
    popular: { read_count: -1, title: 1 },
  };
  const sortObj = sortMap[sort] || sortMap.popular;

  const projection = {
    _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1,
    language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
  };

  const highlightProjection = {
    ...projection,
    reading_summary: 1,
    quality_score: 1,
  };

  // First get book IDs for gallery image lookup
  const collectionBookIds = await db.collection('books')
    .find({ collections: id, status: { $ne: 'deleted' }, hidden: { $ne: true } }, { projection: { id: 1 } })
    .toArray()
    .then(docs => docs.map(d => d.id));

  // Fetch mentioned book IDs for explicit linking in descriptions
  const mentionedBookIds = (collection.mentioned_books || [])
    .map((m: { book_id: string }) => m.book_id)
    .filter(Boolean);

  const [books, total, highlights, galleryImages, mentionedBooks] = await Promise.all([
    db.collection('books')
      .find(filter, { projection })
      .sort(sortObj)
      .skip(offset)
      .limit(PER_PAGE)
      .toArray(),
    db.collection('books').countDocuments(filter),
    db.collection('books')
      .find(
        { collections: id, status: { $ne: 'deleted' }, hidden: { $ne: true }, pages_translated: { $gt: 0 } },
        { projection: highlightProjection },
      )
      .sort({ quality_score: -1, read_count: -1, pages_translated: -1 })
      .limit(5)
      .toArray(),
    collectionBookIds.length > 0
      ? db.collection('gallery_images')
          .find({
            book_id: { $in: collectionBookIds },
            gallery_quality: { $gte: 0.7 },
            type: { $nin: ['decorative', 'symbol', 'musical_score'] },
          })
          .sort({ gallery_quality: -1 })
          .limit(60)
          .toArray()
          .catch(() => [])
      : Promise.resolve([]),
    mentionedBookIds.length > 0
      ? db.collection('books')
          .find({ id: { $in: mentionedBookIds } }, { projection })
          .toArray()
      : Promise.resolve([]),
  ]);

  const { _id, ...collectionClean } = collection;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collection: collectionClean as any,
    books: books as unknown as BookItem[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    highlights: highlights as any[],
    total,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    galleryImages: galleryImages as any[],
    mentionedBooks: mentionedBooks as unknown as BookItem[],
  };
}

// ---------- Page ----------

export default async function CollectionDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const sort = (typeof sp.sort === 'string' ? sp.sort : '') || 'popular';
  const language = typeof sp.language === 'string' ? sp.language : '';
  const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0') || 0;
  const showAll = sp.show_all === '1';

  const data = await fetchCollectionData(id, sort, language, offset);
  if (!data) notFound();

  const { collection, books, highlights, galleryImages, total, mentionedBooks } = data;
  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const languages = (collection.languages || []).filter((l: { count: number }) => l.count > 2);

  // Diversify gallery images: max 2 per book, skip images without thumbnails, take first 11
  const diverseGalleryImages: typeof galleryImages = [];
  const bookImageCounts: Record<string, number> = {};
  for (const img of galleryImages) {
    const thumb = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
    if (!thumb) continue;
    const bid = img.book_id || img.bookId;
    const count = bookImageCounts[bid] || 0;
    if (count >= 2) continue;
    bookImageCounts[bid] = count + 1;
    diverseGalleryImages.push(img);
    if (diverseGalleryImages.length >= 11) break;
  }

  const heroImages = diverseGalleryImages.slice(0, 6);
  const allBooksForLinking = [...highlights, ...books, ...mentionedBooks];
  const explicitMentions: { text: string; book_id: string }[] = collection.mentioned_books || [];

  // Compact view: 3 rows of books with last slot as "See all" card
  // Row counts: 5 cols (xl) = 15 slots, 4 cols (lg) = 12, 3 cols (sm) = 9, 2 cols (default) = 6
  // We cap at 14 books (15 slots - 1 for "See all" at 5-col) and CSS handles smaller breakpoints
  const COMPACT_LIMIT = 14;
  const compactBooks = books.slice(0, COMPACT_LIMIT);
  const displayBooks = showAll ? books : compactBooks;
  const showSeeAllCard = !showAll && total > COMPACT_LIMIT;

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        {heroImages.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 opacity-30">
            {heroImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string }) => {
              const src = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
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
            <span>{total.toLocaleString()} books</span>
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
                const thumb = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
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
              {highlights.slice(0, 3).map((book: { id: string; display_title?: string; title: string; author?: string; year?: number; language?: string; pages_count?: number; thumbnail?: string; reading_summary?: { overview?: string } }) => {
                const summary = book.reading_summary?.overview;
                const snippet = summary
                  ? summary.length > 160 ? summary.slice(0, 160).replace(/\s+\S*$/, '') + '...' : summary
                  : null;

                return (
                  <Link
                    key={book.id}
                    href={`/book/${book.id}`}
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
                {highlights.slice(3).map((book: { id: string; display_title?: string; title: string; author?: string; year?: number; thumbnail?: string }) => (
                  <Link
                    key={book.id}
                    href={`/book/${book.id}`}
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

        {/* All Books Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h2
              className="text-2xl sm:text-3xl text-primary font-display"
            >
              All Books
            </h2>
            <p className="text-sm text-muted mt-1">
              {total.toLocaleString()} books in this collection
            </p>
          </div>

          {showAll && <CollectionFilters collectionId={id} languages={languages} />}
        </div>

        {/* Books Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {displayBooks.map((book, i) => (
            <CollectionBookCard
              key={book.id}
              book={{
                bookId: book.id,
                id: book.id,
                title: bookTitle(book),
                author: book.author || '',
                year: book.year || 0,
                pages_count: book.pages_count,
                pages_ocr: book.pages_ocr,
                pages_translated: book.pages_translated,
                thumbnail: book.thumbnail || book.thumbnail_blob || book.photo,
                language: book.language,
                published: book.published,
                translation_percent: book.pages_count && book.pages_translated
                  ? Math.round((book.pages_translated / book.pages_count) * 100)
                  : 0,
              }}
              priority={i < 10}
            />
          ))}

          {/* "See all" card in compact view */}
          {showSeeAllCard && (
            <Link
              href={`/collections/${id}?show_all=1&sort=${sort}${language ? `&language=${language}` : ''}`}
              className="group flex flex-col items-center justify-center gap-3 rounded-xl border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all aspect-[3/4]"
            >
              <div className="w-12 h-12 rounded-full bg-accent-rust/8 flex items-center justify-center group-hover:bg-accent-rust/15 transition-colors">
                <ArrowRight className="w-5 h-5 text-accent-rust" />
              </div>
              <div className="text-center px-3">
                <span className="text-sm font-medium text-primary group-hover:text-accent-rust transition-colors block">
                  See all {total.toLocaleString()}
                </span>
                <span className="text-xs text-muted">books</span>
              </div>
            </Link>
          )}
        </div>

        {/* Pagination (only in full view) */}
        {showAll && totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10 text-sm">
            {offset > 0 ? (
              <Link
                href={`/collections/${id}?show_all=1&sort=${sort}${language ? `&language=${language}` : ''}&offset=${Math.max(0, offset - PER_PAGE)}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Previous
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                Previous
              </span>
            )}
            <span className="text-muted">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages ? (
              <Link
                href={`/collections/${id}?show_all=1&sort=${sort}${language ? `&language=${language}` : ''}&offset=${offset + PER_PAGE}`}
                className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
              >
                Next
              </Link>
            ) : (
              <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                Next
              </span>
            )}
          </div>
        )}

        {/* Show filters link in compact view */}
        {showAll && (
          <div className="mt-6 text-center">
            <Link
              href={`/collections/${id}?sort=${sort}${language ? `&language=${language}` : ''}`}
              className="text-sm text-muted hover:text-accent-rust transition-colors"
            >
              Show less
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
