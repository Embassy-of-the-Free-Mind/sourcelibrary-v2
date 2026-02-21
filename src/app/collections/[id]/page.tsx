'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Images, ArrowLeft } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';
import CollectionBookCard from '@/components/CollectionBookCard';

interface CollectionMeta {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  expanded_description?: string;
  color: string;
  book_count: number;
  languages: { lang: string; count: number }[];
}

interface GalleryImage {
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  thumbnailUrl?: string;
  extractedUrl?: string;
  imageUrl?: string;
  description?: string;
  museumDescription?: string;
  bookTitle?: string;
  type?: string;
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
}

interface HighlightBook extends BookItem {
  reading_summary?: { overview?: string };
  read_count?: number;
  quality_score?: number;
}

function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

/** Auto-link italic book titles found in description text to their book pages */
function linkBookTitles(text: string, allBooks: BookItem[]): React.ReactNode {
  // Build a map of title variants → book id, longest first to avoid partial matches
  const titleMap: { title: string; id: string }[] = [];
  for (const book of allBooks) {
    const id = book.id;
    const dt = book.display_title;
    const t = book.title;
    if (dt && dt !== 'None') titleMap.push({ title: dt, id });
    if (t && t !== dt) titleMap.push({ title: t, id });
  }
  // Sort longest first so we match "Musurgia Universalis" before "Musurgia"
  titleMap.sort((a, b) => b.title.length - a.title.length);

  // Only match titles that are 8+ chars to avoid false positives on very short words
  const candidates = titleMap.filter(t => t.title.length >= 8);
  if (candidates.length === 0) return text;

  // Find all matches in the text
  const matches: { start: number; end: number; title: string; id: string }[] = [];
  const usedRanges: [number, number][] = [];

  for (const { title, id } of candidates) {
    // Escape regex special chars
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // Check no overlap with existing matches
      if (!usedRanges.some(([s, e]) => start < e && end > s)) {
        matches.push({ start, end, title: match[0], id });
        usedRanges.push([start, end]);
      }
    }
  }

  if (matches.length === 0) return text;

  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  // Build React nodes
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

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most popular' },
  { value: 'year_asc', label: 'Oldest first' },
  { value: 'year_desc', label: 'Newest first' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'recent', label: 'Recently added' },
];

const PER_PAGE = 60;

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [collection, setCollection] = useState<CollectionMeta | null>(null);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [highlights, setHighlights] = useState<HighlightBook[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);

  const sort = searchParams.get('sort') || 'popular';
  const language = searchParams.get('language') || '';
  const offset = parseInt(searchParams.get('offset') || '0');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ sort, limit: String(PER_PAGE), offset: String(offset) });
      if (language) qs.set('language', language);

      const res = await fetch(`/api/collections/${id}?${qs}`);
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();
      setCollection(data.collection);
      setBooks(data.books);
      setHighlights(data.highlights || []);
      setTotal(data.total);
    } catch {
      setCollection(null);
    } finally {
      setLoading(false);
    }
  }, [id, sort, language, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch gallery images
  useEffect(() => {
    let cancelled = false;
    async function fetchGallery() {
      setGalleryLoading(true);
      try {
        const res = await fetch(`/api/gallery?collection=${encodeURIComponent(id)}&limit=12&maxPerBook=2&minQuality=0.6`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGalleryImages(data.items || []);
      } catch {
        // gallery is optional
      } finally {
        if (!cancelled) setGalleryLoading(false);
      }
    }
    fetchGallery();
    return () => { cancelled = true; };
  }, [id]);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    if (updates.sort || updates.language) params.delete('offset');
    router.push(`/collections/${id}?${params.toString()}`, { scroll: false });
  };

  if (loading && !collection) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <BookLoader />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="min-h-screen bg-cream">
        <div className="text-center py-20">
          <BookOpen className="w-12 h-12 text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-primary">Collection not found</h2>
          <Link href="/collections" className="text-accent-rust hover:underline mt-2 inline-block">
            Browse all collections
          </Link>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const languages = (collection.languages || []).filter(l => l.count > 2);

  // Pick hero images for the mosaic (up to 6)
  const heroImages = galleryImages.slice(0, 6);

  return (
    <div className="min-h-screen bg-cream">
      {/* ── Hero Section ── */}
      <div className="relative bg-dark overflow-hidden">
        {/* Gallery mosaic background */}
        {!galleryLoading && heroImages.length > 0 && (
          <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-6 opacity-30">
            {heroImages.map((img) => {
              const src = img.thumbnailUrl || img.extractedUrl || img.imageUrl;
              if (!src) return null;
              return (
                <div key={`${img.pageId}-${img.detectionIndex}`} className="relative overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-dark/60 via-dark/80 to-dark" />

        {/* Content */}
        <div className="relative max-w-6xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          {/* Back link */}
          <Link
            href="/#library"
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Library
          </Link>

          {/* Collection name */}
          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            {collection.name}
          </h1>

          {/* Subtitle */}
          {collection.subtitle && (
            <p className="text-lg sm:text-xl text-white/70 max-w-3xl leading-relaxed mb-4">
              {collection.subtitle}
            </p>
          )}

          {/* Stats row */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString()} books</span>
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.map(l => l.lang).join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Gallery Strip ── */}
      {(galleryLoading || galleryImages.length > 0) && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-6xl mx-auto px-6 py-5">
            {galleryLoading ? (
              <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-32 h-32 rounded-lg bg-cream animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin">
                {galleryImages.map((img) => {
                  const thumb = img.thumbnailUrl || img.extractedUrl || img.imageUrl;
                  const galleryId = `${img.pageId}-${img.detectionIndex}`;
                  return (
                    <Link
                      key={galleryId}
                      href={`/gallery/image/${galleryId}`}
                      className="flex-shrink-0 group relative w-32 h-32 rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                      title={img.museumDescription || img.description || img.bookTitle}
                    >
                      {thumb ? (
                        <Image
                          src={thumb}
                          alt={img.description || img.bookTitle || 'Illustration'}
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
                {/* "View all" card */}
                <Link
                  href={`/gallery?collection=${id}`}
                  className="flex-shrink-0 w-32 h-32 rounded-lg border border-border-light bg-cream hover:bg-white hover:border-accent-rust/30 transition-all flex flex-col items-center justify-center gap-2 text-muted hover:text-accent-rust"
                >
                  <Images className="w-6 h-6" />
                  <span className="text-xs font-medium">View all</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* ── Description ── */}
        {(collection.expanded_description || collection.description) && (
          <div className="mb-10 max-w-5xl">
            {(collection.expanded_description || collection.description)!.split('\n\n').map((para, i) => (
              <p key={i} className="text-secondary text-lg leading-relaxed mb-4 last:mb-0" style={{ fontFamily: 'Newsreader, Georgia, serif' }}>
                {linkBookTitles(para, [...highlights, ...books])}
              </p>
            ))}
          </div>
        )}

        {/* ── Highlights ── */}
        {highlights.length > 0 && (
          <div className="mb-12">
            <h2
              className="text-2xl sm:text-3xl text-primary mb-6"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Highlights
            </h2>
            <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.slice(0, 3).map((book) => {
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
                    {/* Thumbnail */}
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

                    {/* Info */}
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
                {highlights.slice(3).map((book) => (
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

        {/* ── All Books Header ── */}
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

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={sort}
              onChange={(e) => updateParams({ sort: e.target.value })}
              className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>

            {languages.length > 1 && (
              <select
                value={language}
                onChange={(e) => updateParams({ language: e.target.value })}
                className="text-sm border border-border-light rounded-md px-3 py-1.5 bg-white text-primary"
              >
                <option value="">All languages</option>
                {languages.map(l => (
                  <option key={l.lang} value={l.lang}>{l.lang} ({l.count})</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Books Grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="space-y-3 animate-pulse">
                <div className="aspect-[3/4] bg-white rounded-lg" />
                <div className="space-y-2">
                  <div className="h-4 bg-white rounded w-4/5" />
                  <div className="h-3 bg-white rounded w-3/5" />
                </div>
              </div>
            ))}
          </div>
        ) : (
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
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10 text-sm">
            <button
              onClick={() => updateParams({ offset: String(Math.max(0, offset - PER_PAGE)) })}
              disabled={offset === 0}
              className="px-4 py-2 rounded-lg border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
            >
              Previous
            </button>
            <span className="text-muted">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => updateParams({ offset: String(offset + PER_PAGE) })}
              disabled={currentPage >= totalPages}
              className="px-4 py-2 rounded-lg border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
