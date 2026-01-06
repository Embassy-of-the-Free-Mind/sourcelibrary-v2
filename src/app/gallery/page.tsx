'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Image as ImageIcon, BookOpen, X, ChevronLeft, ChevronRight,
  SlidersHorizontal, Loader2, ImagePlus, AlertCircle
} from 'lucide-react';
import LikeButton from '@/components/LikeButton';

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageMetadata {
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  style?: string;
  technique?: string;
}

interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  description: string;
  type?: string;
  bbox?: BBox;
  galleryQuality?: number;
  museumDescription?: string;
  metadata?: ImageMetadata;
}

interface BookInfo {
  id: string;
  title: string;
  author?: string;
  year?: number;
  pagesCount?: number;
  hasOcr: boolean;
  ocrPageCount: number;
  hasImages: boolean;
  imagesPageCount: number;
}

interface GalleryFilters {
  types: string[];
  subjects: string[];
  figures: string[];
  symbols: string[];
  yearRange: { minYear: number | null; maxYear: number | null };
}

interface GalleryResponse {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
  bookInfo: BookInfo | null;
  filters: GalleryFilters;
}

interface BookSearchResult {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
}

function getCroppedImageUrl(imageUrl: string, bbox: BBox): string {
  const params = new URLSearchParams({
    url: imageUrl,
    x: bbox.x.toString(),
    y: bbox.y.toString(),
    w: bbox.width.toString(),
    h: bbox.height.toString()
  });
  return `/api/crop-image?${params}`;
}

export default function GalleryPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Search state
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchResult[]>([]);
  const [bookSearchLoading, setBookSearchLoading] = useState(false);
  const [showBookDropdown, setShowBookDropdown] = useState(false);
  const bookSearchRef = useRef<HTMLDivElement>(null);

  // Image search state
  const [imageSearchQuery, setImageSearchQuery] = useState(searchParams.get('q') || '');

  // Filter state from URL (support both 'bookId' and 'book' params)
  const bookId = searchParams.get('bookId') || searchParams.get('book') || '';
  const typeFilter = searchParams.get('type') || '';
  const subjectFilter = searchParams.get('subject') || '';
  const yearStart = searchParams.get('yearStart') || '';
  const yearEnd = searchParams.get('yearEnd') || '';

  const limit = 24;

  // Update URL params
  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Reset to first page when filters change
    params.delete('offset');
    router.push(`/gallery?${params.toString()}`);
  }, [searchParams, router]);

  // Fetch gallery data
  useEffect(() => {
    const fetchGallery = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: limit.toString(),
          offset: (page * limit).toString()
        });
        if (bookId) params.set('bookId', bookId);
        if (imageSearchQuery) params.set('q', imageSearchQuery);
        if (typeFilter) params.set('type', typeFilter);
        if (subjectFilter) params.set('subject', subjectFilter);
        if (yearStart) params.set('yearStart', yearStart);
        if (yearEnd) params.set('yearEnd', yearEnd);

        const res = await fetch(`/api/gallery?${params}`);
        if (!res.ok) throw new Error('Failed to fetch gallery');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    };

    fetchGallery();
  }, [bookId, imageSearchQuery, typeFilter, subjectFilter, yearStart, yearEnd, page]);

  // Book search with debounce
  useEffect(() => {
    if (!bookSearchQuery.trim()) {
      setBookSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setBookSearchLoading(true);
      try {
        const res = await fetch(`/api/books/search?q=${encodeURIComponent(bookSearchQuery)}&limit=10`);
        if (res.ok) {
          const json = await res.json();
          setBookSearchResults(json.results || []);
        }
      } catch {
        // Ignore search errors
      } finally {
        setBookSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [bookSearchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bookSearchRef.current && !bookSearchRef.current.contains(e.target as Node)) {
        setShowBookDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const handleBookSelect = (book: BookSearchResult) => {
    setBookSearchQuery('');
    setShowBookDropdown(false);
    updateParams({ bookId: book.id });
  };

  const clearBookFilter = () => {
    updateParams({ bookId: '' });
  };

  const handleImageSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ q: imageSearchQuery });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header */}
      <header className="bg-stone-900 text-white py-4 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            {/* Source Library Logo */}
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
                <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
                <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
              </svg>
              <span className="text-xl uppercase tracking-wider">
                <span className="font-semibold">Source</span>
                <span className="font-light">Library</span>
              </span>
            </Link>

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <h1 className="text-lg font-serif">Image Gallery</h1>
                <p className="text-stone-400 text-xs">
                  {data?.total || 0} illustrations
                </p>
              </div>
              <ImageIcon className="w-6 h-6 text-amber-500" />
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex gap-3">
            {/* Book Search */}
            <div className="relative flex-1 max-w-xs" ref={bookSearchRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={bookSearchQuery}
                onChange={(e) => {
                  setBookSearchQuery(e.target.value);
                  setShowBookDropdown(true);
                }}
                onFocus={() => setShowBookDropdown(true)}
                placeholder="Find a book..."
                className="w-full pl-9 pr-4 py-2 bg-stone-800 text-white placeholder-stone-500 rounded-lg border border-stone-700 focus:border-amber-500 focus:outline-none"
              />
              {bookSearchLoading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 animate-spin" />
              )}

              {/* Book Search Dropdown */}
              {showBookDropdown && bookSearchResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-lg shadow-lg border border-stone-200 max-h-64 overflow-y-auto z-30">
                  {bookSearchResults.map((book) => (
                    <button
                      key={book.id}
                      onClick={() => handleBookSelect(book)}
                      className="w-full px-4 py-2 text-left text-stone-800 hover:bg-amber-50 border-b border-stone-100 last:border-0"
                    >
                      <div className="font-medium text-sm line-clamp-1">
                        {book.display_title || book.title}
                      </div>
                      {book.author && (
                        <div className="text-xs text-stone-500">{book.author}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Image Content Search */}
            <form onSubmit={handleImageSearch} className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                value={imageSearchQuery}
                onChange={(e) => setImageSearchQuery(e.target.value)}
                placeholder="Search image content (serpent, Mercury, emblem...)"
                className="w-full pl-9 pr-4 py-2 bg-stone-800 text-white placeholder-stone-500 rounded-lg border border-stone-700 focus:border-amber-500 focus:outline-none"
              />
            </form>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                showFilters ? 'bg-amber-600 text-white' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Active Filters / Book Info */}
        {(data?.bookInfo || typeFilter || subjectFilter || imageSearchQuery) && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {data?.bookInfo && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-full">
                <BookOpen className="w-4 h-4" />
                <span className="text-sm font-medium">{data.bookInfo.title}</span>
                {data.bookInfo.year && <span className="text-xs">({data.bookInfo.year})</span>}
                <button onClick={clearBookFilter} className="ml-1 hover:text-amber-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {typeFilter && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-200 text-stone-700 rounded-full text-sm">
                Type: {typeFilter}
                <button onClick={() => updateParams({ type: '' })} className="hover:text-stone-900">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {subjectFilter && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-200 text-stone-700 rounded-full text-sm">
                Subject: {subjectFilter}
                <button onClick={() => updateParams({ subject: '' })} className="hover:text-stone-900">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {imageSearchQuery && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm">
                Search: &quot;{imageSearchQuery}&quot;
                <button onClick={() => { setImageSearchQuery(''); updateParams({ q: '' }); }} className="hover:text-blue-600">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filter Panel */}
        {showFilters && data?.filters && (
          <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-stone-200">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Image Type */}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-2">Image Type</label>
                <div className="flex flex-wrap gap-1">
                  {data.filters.types.map((type) => (
                    <button
                      key={type}
                      onClick={() => updateParams({ type: typeFilter === type ? '' : type })}
                      className={`px-2 py-1 text-xs rounded-full transition-colors ${
                        typeFilter === type
                          ? 'bg-amber-600 text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subjects */}
              {data.filters.subjects.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-2">Subjects</label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {data.filters.subjects.slice(0, 15).map((subject) => (
                      <button
                        key={subject}
                        onClick={() => updateParams({ subject: subjectFilter === subject ? '' : subject })}
                        className={`px-2 py-1 text-xs rounded-full transition-colors ${
                          subjectFilter === subject
                            ? 'bg-amber-600 text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        {subject}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Year Range */}
              {data.filters.yearRange.minYear && (
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-2">
                    Year Range ({data.filters.yearRange.minYear} - {data.filters.yearRange.maxYear})
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="From"
                      value={yearStart}
                      onChange={(e) => updateParams({ yearStart: e.target.value })}
                      className="w-20 px-2 py-1 text-sm border border-stone-300 rounded"
                    />
                    <span className="text-stone-400">-</span>
                    <input
                      type="number"
                      placeholder="To"
                      value={yearEnd}
                      onChange={(e) => updateParams({ yearEnd: e.target.value })}
                      className="w-20 px-2 py-1 text-sm border border-stone-300 rounded"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-20">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* Empty State for Book with No Images */}
        {!loading && data?.bookInfo && data.items.length === 0 && (
          <BookEmptyState bookInfo={data.bookInfo} />
        )}

        {/* Empty State for Search with No Results */}
        {!loading && !data?.bookInfo && data?.items.length === 0 && (
          <div className="text-center py-20">
            <ImageIcon className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500 mb-2">No images found</p>
            <p className="text-stone-400 text-sm">
              Try a different search or browse all images
            </p>
          </div>
        )}

        {/* Image Grid */}
        {!loading && data && data.items.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {data.items.map((item, idx) => (
                <GalleryCard key={`${item.pageId}-${item.detectionIndex}-${idx}`} item={item} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <span className="text-stone-600 text-sm">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GalleryCard({ item }: { item: GalleryItem }) {
  const [imageError, setImageError] = useState(false);

  const displayUrl = item.bbox
    ? getCroppedImageUrl(item.imageUrl, item.bbox)
    : item.imageUrl;

  const galleryImageId = `${item.pageId}:${item.detectionIndex}`;

  return (
    <div className="relative group bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5">
      <Link href={`/gallery/image/${galleryImageId}`}>
        <div className="relative aspect-square bg-stone-100">
          {!imageError ? (
            <Image
              src={displayUrl}
              alt={item.description}
              fill
              className="object-contain group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
              onError={() => setImageError(true)}
              unoptimized={!!item.bbox}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-stone-300">
              <ImageIcon className="w-8 h-8" />
            </div>
          )}

          {/* Type badge */}
          {item.type && (
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white capitalize">
              {item.type}
            </span>
          )}

          {/* Quality indicator */}
          {item.galleryQuality && item.galleryQuality >= 0.9 && (
            <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500 text-white">
              ★
            </span>
          )}
        </div>

        <div className="p-2">
          <p className="text-xs text-stone-700 line-clamp-2 mb-1" title={item.description}>
            {item.description}
          </p>
          <p className="text-[10px] text-stone-400 line-clamp-1">
            {item.bookTitle}
          </p>
        </div>
      </Link>

      {/* Like button overlay - always visible for discoverability */}
      <div className="absolute top-1.5 left-1.5 z-10">
        <div className="flex items-center bg-white/90 backdrop-blur-sm rounded-full shadow-sm hover:bg-white transition-colors px-1.5 py-0.5">
          <LikeButton
            targetType="image"
            targetId={galleryImageId}
            size="sm"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}

function BookEmptyState({ bookInfo }: { bookInfo: BookInfo }) {
  const [extracting, setExtracting] = useState(false);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      // Call the extraction API
      const res = await fetch('/api/extract-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: bookInfo.id,
          limit: 20
        })
      });
      if (res.ok) {
        // Refresh the page to show new images
        window.location.reload();
      }
    } catch {
      // Ignore errors
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="text-center py-16 max-w-md mx-auto">
      <div className="bg-white rounded-xl p-8 shadow-sm border border-stone-200">
        <BookOpen className="w-12 h-12 text-stone-300 mx-auto mb-4" />
        <h2 className="text-lg font-serif text-stone-800 mb-2">{bookInfo.title}</h2>
        {bookInfo.author && (
          <p className="text-stone-500 text-sm mb-4">by {bookInfo.author}</p>
        )}

        {!bookInfo.hasImages && bookInfo.hasOcr && (
          <>
            <div className="bg-amber-50 rounded-lg p-4 mb-4">
              <ImagePlus className="w-8 h-8 text-amber-600 mx-auto mb-2" />
              <p className="text-amber-800 text-sm">
                This book has OCR data but no extracted images yet.
              </p>
            </div>
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {extracting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Extracting...
                </span>
              ) : (
                'Extract Images'
              )}
            </button>
          </>
        )}

        {!bookInfo.hasImages && !bookInfo.hasOcr && (
          <div className="bg-stone-100 rounded-lg p-4">
            <AlertCircle className="w-8 h-8 text-stone-400 mx-auto mb-2" />
            <p className="text-stone-600 text-sm">
              This book needs OCR processing before images can be extracted.
            </p>
            <Link
              href={`/book/${bookInfo.id}`}
              className="inline-block mt-3 text-amber-600 hover:text-amber-700 text-sm"
            >
              Go to book page →
            </Link>
          </div>
        )}

        {bookInfo.hasImages && (
          <p className="text-stone-500 text-sm">
            No images match your current filters.
          </p>
        )}
      </div>
    </div>
  );
}
