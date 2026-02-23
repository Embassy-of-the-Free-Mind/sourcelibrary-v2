import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Metadata } from 'next';
import { BookOpen, Images, ArrowLeft } from 'lucide-react';
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

/** Auto-link book titles found in description text to their book pages */
function linkBookTitles(text: string, allBooks: BookItem[]): React.ReactNode {
  const titleMap: { title: string; id: string }[] = [];
  for (const book of allBooks) {
    const id = book.id;
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None') titleMap.push({ title: dt, id });
    if (t && t !== dt) titleMap.push({ title: t, id });
  }
  titleMap.sort((a, b) => b.title.length - a.title.length);

  const candidates = titleMap.filter(t => t.title.length >= 8);
  if (candidates.length === 0) return text;

  const matches: { start: number; end: number; title: string; id: string }[] = [];
  const usedRanges: [number, number][] = [];

  for (const { title, id } of candidates) {
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

  const [books, total, highlights, galleryImages] = await Promise.all([
    db.collection('books')
      .find(filter, { projection })
      .sort(sortObj)
      .skip(offset)
      .limit(PER_PAGE)
      .toArray(),
    db.collection('books').countDocuments(filter),
    db.collection('books')
      .find(
        { collections: id, status: { $ne: 'deleted' }, pages_translated: { $gt: 0 } },
        { projection: highlightProjection },
      )
      .sort({ quality_score: -1, read_count: -1, pages_translated: -1 })
      .limit(5)
      .toArray(),
    db.collection('gallery_images')
      .find({ collection: id, gallery_quality: { $gte: 0.6 } })
      .sort({ gallery_quality: -1 })
      .limit(12)
      .toArray()
      .catch(() => []),
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
  };
}

// ---------- Page ----------

export default async function CollectionDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const sort = (typeof sp.sort === 'string' ? sp.sort : '') || 'popular';
  const language = typeof sp.language === 'string' ? sp.language : '';
  const offset = parseInt(typeof sp.offset === 'string' ? sp.offset : '0') || 0;

  const data = await fetchCollectionData(id, sort, language, offset);
  if (!data) notFound();

  const { collection, books, highlights, galleryImages, total } = data;
  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const languages = (collection.languages || []).filter((l: { count: number }) => l.count > 2);
  const heroImages = galleryImages.slice(0, 6);
  const allBooksForLinking = [...highlights, ...books];

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
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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

      {/* Gallery Strip */}
      {galleryImages.length > 0 && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-6xl mx-auto px-6 py-5">
            <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
              {galleryImages.map((img: { pageId?: string; page_id?: string; detectionIndex?: number; detection_index?: number; thumbnailUrl?: string; thumbnail_url?: string; extractedUrl?: string; extracted_url?: string; imageUrl?: string; image_url?: string; museumDescription?: string; museum_description?: string; description?: string; bookTitle?: string; book_title?: string; type?: string }) => {
                const thumb = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                return (
                  <Link
                    key={galleryId}
                    href={`/gallery/image/${galleryId}`}
                    className="flex-shrink-0 group relative w-32 h-32 rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="128px"
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
                className="flex-shrink-0 w-32 h-32 rounded-lg border border-border-light bg-cream hover:bg-white hover:border-accent-rust/30 transition-all flex flex-col items-center justify-center gap-2 text-muted hover:text-accent-rust"
              >
                <Images className="w-6 h-6" />
                <span className="text-xs font-medium">View all</span>
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
              <p key={i} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>
                {linkBookTitles(para, allBooksForLinking)}
              </p>
            ))}
          </div>
        )}

        {/* Highlights */}
        {highlights.length > 0 && (
          <div className="mb-12">
            <h2
              className="text-2xl sm:text-3xl text-primary mb-6"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
                        className="font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug mb-1"
                        style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
              className="text-2xl sm:text-3xl text-primary"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              All Books
            </h2>
            <p className="text-sm text-muted mt-1">
              {total.toLocaleString()} books in this collection
            </p>
          </div>

          <CollectionFilters collectionId={id} languages={languages} />
        </div>

        {/* Books Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book, i) => (
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
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10 text-sm">
            {offset > 0 ? (
              <Link
                href={`/collections/${id}?sort=${sort}${language ? `&language=${language}` : ''}&offset=${Math.max(0, offset - PER_PAGE)}`}
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
                href={`/collections/${id}?sort=${sort}${language ? `&language=${language}` : ''}&offset=${offset + PER_PAGE}`}
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
      </div>
    </div>
  );
}
