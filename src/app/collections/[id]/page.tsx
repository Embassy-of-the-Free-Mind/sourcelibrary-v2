'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Images, Loader2 } from 'lucide-react';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import CollectionBookCard from '@/components/CollectionBookCard';

interface CollectionMeta {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
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
  categories?: string[];
  published?: string;
}

const SORT_OPTIONS = [
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);

  const sort = searchParams.get('sort') || 'year_asc';
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
      setTotal(data.total);
    } catch {
      setCollection(null);
    } finally {
      setLoading(false);
    }
  }, [id, sort, language, offset]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch gallery images for this collection (only once per collection id)
  useEffect(() => {
    let cancelled = false;
    async function fetchGallery() {
      setGalleryLoading(true);
      try {
        const res = await fetch(`/api/gallery?collection=${encodeURIComponent(id)}&limit=24&maxPerBook=2&minQuality=0.6`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setGalleryImages(data.items || []);
      } catch {
        // gallery is optional — silently ignore
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
      <ContentPageLayout>
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted" />
        </div>
      </ContentPageLayout>
    );
  }

  if (!collection) {
    return (
      <ContentPageLayout>
        <div className="text-center py-20">
          <BookOpen className="w-12 h-12 text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-primary">Collection not found</h2>
          <Link href="/collections" className="text-accent-rust hover:underline mt-2 inline-block">
            Browse all collections
          </Link>
        </div>
      </ContentPageLayout>
    );
  }

  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const languages = (collection.languages || []).filter(l => l.count > 2);

  return (
    <ContentPageLayout>
      <SubPageHeader title={collection.name} subtitle={collection.subtitle} backHref="/collections" backLabel="Collections" />

      <div className="mb-6">
        <p className="text-muted text-sm max-w-3xl leading-relaxed">
          {collection.description}
        </p>
        <p className="text-xs text-muted mt-2">
          {total.toLocaleString()} books
        </p>
      </div>

      {/* Gallery image strip */}
      {(galleryLoading || galleryImages.length > 0) && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-secondary">
              <Images className="w-4 h-4" />
              Illustrations
            </h2>
            {galleryImages.length > 0 && (
              <Link
                href={`/gallery?collection=${id}`}
                className="text-xs text-accent-rust hover:underline"
              >
                View all illustrations →
              </Link>
            )}
          </div>

          {galleryLoading ? (
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-28 h-28 rounded bg-warm animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {galleryImages.map((img) => {
                const thumb = img.thumbnailUrl || img.extractedUrl || img.imageUrl;
                const galleryId = `${img.pageId}-${img.detectionIndex}`;
                return (
                  <Link
                    key={galleryId}
                    href={`/gallery/image/${galleryId}`}
                    className="flex-shrink-0 group relative w-28 h-28 rounded overflow-hidden border border-border-light hover:border-accent-rust/40 transition-colors"
                    title={img.museumDescription || img.description || img.bookTitle}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="112px"
                      />
                    ) : (
                      <div className="w-full h-full bg-warm flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    {img.type && (
                      <span className="absolute bottom-1 left-1 text-[10px] bg-dark/70 text-white px-1 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
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

      {/* Books Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {books.map((book, i) => (
          <CollectionBookCard
            key={book.id}
            book={{
              bookId: book.id,
              id: book.id,
              title: book.display_title || book.title,
              author: book.author || '',
              year: book.year || 0,
              pages_count: book.pages_count,
              pages_ocr: book.pages_ocr,
              pages_translated: book.pages_translated,
              thumbnail: book.thumbnail || book.photo,
              language: book.language,
              published: book.published,
              translation_percent: book.pages_count && book.pages_translated
                ? Math.round((book.pages_translated / book.pages_count) * 100)
                : 0,
            }}
            index={offset + i}
            priority={i < 10}
          />
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted" />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-8 text-sm">
          <button
            onClick={() => updateParams({ offset: String(Math.max(0, offset - PER_PAGE)) })}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => updateParams({ offset: String(offset + PER_PAGE) })}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 rounded border border-border-light disabled:opacity-30 hover:bg-warm transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </ContentPageLayout>
  );
}
