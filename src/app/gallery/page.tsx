'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Image as ImageIcon, BookOpen, ExternalLink, Filter, ChevronLeft, ChevronRight } from 'lucide-react';

interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  descriptions: Array<{ description: string; type?: string }>;
  hasVisionExtraction: boolean;
}

interface GalleryResponse {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
  books: Array<{ id: string; title: string }>;
  imageTypes: string[];
}

export default function GalleryPage() {
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<string>('');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 24;

  useEffect(() => {
    fetchGallery();
  }, [selectedBook, page]);

  const fetchGallery = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: (page * limit).toString()
      });
      if (selectedBook) params.set('bookId', selectedBook);

      const res = await fetch(`/api/gallery?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gallery');
    } finally {
      setLoading(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <header className="bg-stone-900 text-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ImageIcon className="w-8 h-8 text-amber-500" />
              <div>
                <h1 className="text-2xl font-serif">Image Gallery</h1>
                <p className="text-stone-400 text-sm">
                  Illustrations from historical texts
                </p>
              </div>
            </div>
            <Link
              href="/"
              className="text-stone-400 hover:text-white transition-colors flex items-center gap-2"
            >
              <BookOpen className="w-4 h-4" />
              Back to Library
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Filters */}
        <div className="mb-6">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filter by book
          </button>

          {showFilters && data?.books && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => { setSelectedBook(''); setPage(0); }}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  !selectedBook
                    ? 'bg-amber-600 text-white'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                All books
              </button>
              {data.books.map(book => (
                <button
                  key={book.id}
                  onClick={() => { setSelectedBook(book.id); setPage(0); }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    selectedBook === book.id
                      ? 'bg-amber-600 text-white'
                      : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                  }`}
                >
                  {book.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        {data && (
          <p className="text-stone-500 text-sm mb-4">
            Showing {data.offset + 1}–{Math.min(data.offset + data.items.length, data.total)} of {data.total} pages with illustrations
          </p>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-20 text-red-600">
            {error}
          </div>
        )}

        {/* Gallery Grid */}
        {!loading && data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.items.map(item => (
              <GalleryCard key={`${item.bookId}-${item.pageNumber}`} item={item} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && data?.items.length === 0 && (
          <div className="text-center py-20 text-stone-500">
            No illustrations found
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="text-stone-600">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryCard({ item }: { item: GalleryItem }) {
  const [imageError, setImageError] = useState(false);

  // Get first description
  const firstDesc = item.descriptions[0];
  const description = firstDesc?.description || 'Illustration';
  const imageType = firstDesc?.type;

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
      {/* Image */}
      <Link href={`/book/${item.bookId}/read?page=${item.pageNumber}`}>
        <div className="relative aspect-[3/4] bg-stone-200">
          {!imageError ? (
            <Image
              src={item.imageUrl}
              alt={description}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400">
              <ImageIcon className="w-12 h-12" />
            </div>
          )}

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <ExternalLink className="w-8 h-8 text-white drop-shadow-lg" />
          </div>

          {/* Type badge */}
          {imageType && (
            <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs bg-black/60 text-white capitalize">
              {imageType}
            </span>
          )}
        </div>
      </Link>

      {/* Metadata */}
      <div className="p-3">
        <p className="text-sm text-stone-800 line-clamp-2 mb-2" title={description}>
          {description}
        </p>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/book/${item.bookId}`}
              className="text-xs text-amber-700 hover:text-amber-800 font-medium line-clamp-1"
              title={item.bookTitle}
            >
              {item.bookTitle}
            </Link>
            {item.author && (
              <p className="text-xs text-stone-500 line-clamp-1">
                {item.author}
                {item.year && ` (${item.year})`}
              </p>
            )}
          </div>
          <Link
            href={`/book/${item.bookId}/read?page=${item.pageNumber}`}
            className="shrink-0 text-xs text-stone-500 hover:text-amber-700"
          >
            p. {item.pageNumber}
          </Link>
        </div>

        {/* Multiple descriptions indicator */}
        {item.descriptions.length > 1 && (
          <p className="text-xs text-stone-400 mt-1">
            +{item.descriptions.length - 1} more illustration{item.descriptions.length > 2 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
