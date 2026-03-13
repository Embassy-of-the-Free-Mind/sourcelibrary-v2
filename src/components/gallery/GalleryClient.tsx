'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Image as ImageIcon, BookOpen, X, ChevronLeft, ChevronRight,
  SlidersHorizontal, Loader2, ImagePlus, AlertCircle
} from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';
import { BookLoader } from '@/components/ui/BookLoader';
import FeaturedCollections from '@/components/gallery/FeaturedCollections';
import UserMenu from '@/components/layout/UserMenu';
import { LIBRARY_PARTNERS, getPartnerByProvider } from '@/lib/library-partners';
import {
  gallery,
  books,
  type GalleryResponse,
  type GalleryItem,
  type BookInfo,
  type BBox,
} from '@/lib/api-client';

interface BookSearchResult {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
}

interface GalleryClientProps {
  initialData: GalleryResponse;
  initialCollections?: Array<{
    id: string;
    slug: string;
    title: string;
    description: string;
    imageCount: number;
    featured: boolean;
    coverImage: { url: string; description: string } | null;
  }>;
}

/** Downsize a IIIF URL for gallery thumbnails (400px wide instead of full) */
function toThumbnailUrl(url: string): string {
  if (!url) return url;
  if (url.includes('/full/')) {
    return url.replace(/\/full\/(full|max|\d+,)\//, '/full/400,/');
  }
  return url;
}

function getCroppedImageUrl(imageUrl: string, bbox: BBox): string {
  const params = new URLSearchParams({
    url: toThumbnailUrl(imageUrl),
    x: bbox.x.toString(),
    y: bbox.y.toString(),
    w: bbox.width.toString(),
    h: bbox.height.toString()
  });
  return `/api/crop-image?${params}`;
}

export default function GalleryClient({ initialData, initialCollections }: GalleryClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State
  const [data, setData] = useState<GalleryResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Search state
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchResult[]>([]);
  const [bookSearchLoading, setBookSearchLoading] = useState(false);
  const [showBookDropdown, setShowBookDropdown] = useState(false);
  const bookSearchRef = useRef<HTMLDivElement>(null);

  // Image search state
  const [imageSearchQuery, setImageSearchQuery] = useState(searchParams.get('q') || '');

  // Quality toggle state
  const qualityParam = searchParams.get('minQuality');
  const includeArchive = searchParams.get('includeArchive') === 'true';
  const currentQualityLevel = includeArchive ? 'archive' : (qualityParam === '0.9' ? 'exhibition' : 'gallery');

  // Filter state from URL
  const bookId = searchParams.get('bookId') || searchParams.get('book') || '';
  const collectionFilter = searchParams.get('collection') || '';
  const libraryFilter = searchParams.get('library') || '';
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
    params.delete('offset');
    router.push(`/gallery?${params.toString()}`);
  }, [searchParams, router]);

  // Fetch gallery data (skip on initial load only if no URL filters — server data is unfiltered)
  useEffect(() => {
    const hasUrlFilters = bookId || collectionFilter || libraryFilter || imageSearchQuery || typeFilter || subjectFilter || yearStart || yearEnd || qualityParam || includeArchive;
    if (isInitialLoad && !hasUrlFilters) {
      setIsInitialLoad(false);
      return;
    }
    if (isInitialLoad) setIsInitialLoad(false);

    const fetchGallery = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await gallery.list({
          limit,
          offset: page * limit,
          bookId: bookId || undefined,
          collection: collectionFilter || undefined,
          library: libraryFilter || undefined,
          query: imageSearchQuery || undefined,
          type: typeFilter || undefined,
          subject: subjectFilter || undefined,
          yearFrom: yearStart ? parseInt(yearStart) : undefined,
          yearTo: yearEnd ? parseInt(yearEnd) : undefined,
          minQuality: qualityParam ? parseFloat(qualityParam) : undefined,
        });
        // Preserve filters from initial page load on pagination
        if (page > 0 && data?.filters && (!json.filters?.types?.length)) {
          json.filters = data.filters;
        }
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load gallery');
      } finally {
        setLoading(false);
      }
    };

    fetchGallery();
  }, [bookId, collectionFilter, libraryFilter, imageSearchQuery, typeFilter, subjectFilter, yearStart, yearEnd, page, qualityParam, includeArchive]);

  // Book search with debounce
  useEffect(() => {
    if (!bookSearchQuery.trim()) {
      setBookSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setBookSearchLoading(true);
      try {
        const data = await books.search(bookSearchQuery, { limit: '10' });
        setBookSearchResults(data.books.map(book => ({
          id: book.id,
          title: book.title,
          display_title: book.display_title,
          author: book.author
        })));
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

  const handleQualityChange = (level: string) => {
    if (level === 'archive') {
      updateParams({ includeArchive: 'true', minQuality: '' });
    } else if (level === 'exhibition') {
      updateParams({ minQuality: '0.9', includeArchive: '' });
    } else {
      updateParams({ minQuality: '', includeArchive: '' });
    }
  };

  const hasFilters = bookId || collectionFilter || typeFilter || subjectFilter || libraryFilter || imageSearchQuery;
  const showCollections = !hasFilters && page === 0;

  return (
    <>
      {/* Header */}
      <header className="bg-stone-900 text-white py-3 sticky top-0 z-20">
        <div className="px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity" aria-label="Source Library home">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
                <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
                <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
              </svg>
              <span className="text-lg uppercase tracking-wider hidden sm:inline">
                <span className="font-semibold">Source</span>
                <span className="font-light">Library</span>
              </span>
            </Link>
            <span className="text-stone-600 hidden sm:inline">/</span>
            <Link href="/gallery" className="hover:opacity-80 transition-opacity">
              <span className="text-base font-serif">Image Gallery</span>
            </Link>
          </div>
          <UserMenu variant="hero" />
        </div>
      </header>

      <div className="px-4 sm:px-6 lg:px-8 py-6">
        {/* Search & Filter Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          {/* Image Search */}
          <form onSubmit={handleImageSearch} className="flex-1 min-w-[200px] max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search images..."
              value={imageSearchQuery}
              onChange={(e) => setImageSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:ring-1 focus:ring-accent-rust focus:border-accent-rust"
            />
          </form>

          {/* Book Search */}
          <div ref={bookSearchRef} className="relative min-w-[200px] max-w-sm flex-1">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Filter by book..."
              value={bookSearchQuery}
              onChange={(e) => {
                setBookSearchQuery(e.target.value);
                setShowBookDropdown(true);
              }}
              onFocus={() => bookSearchResults.length > 0 && setShowBookDropdown(true)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:ring-1 focus:ring-accent-rust focus:border-accent-rust"
            />
            {showBookDropdown && bookSearchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-stone-200 z-30 max-h-64 overflow-y-auto">
                {bookSearchResults.map((book) => (
                  <button
                    key={book.id}
                    onClick={() => handleBookSelect(book)}
                    className="w-full text-left px-3 py-2 hover:bg-stone-50 text-sm border-b border-stone-100 last:border-0"
                  >
                    <span className="font-medium text-stone-800">{book.display_title || book.title}</span>
                    {book.author && <span className="text-stone-500 ml-1">— {book.author}</span>}
                  </button>
                ))}
              </div>
            )}
            {bookSearchLoading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 animate-spin" />
            )}
          </div>

          {/* Filters Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
              showFilters ? 'bg-accent-rust text-white border-accent-rust' : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
          </button>
        </div>

        {/* Active Filters / Book Info */}
        {(data?.bookInfo || collectionFilter || typeFilter || subjectFilter || libraryFilter || imageSearchQuery || currentQualityLevel !== 'gallery') && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {data?.bookInfo && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-gold/15 text-accent-gold-dark rounded-full">
                  <BookOpen className="w-4 h-4" />
                  <span className="text-sm font-medium">{data.bookInfo.title}</span>
                  {data.bookInfo.year && <span className="text-xs">({data.bookInfo.year})</span>}
                  <button onClick={clearBookFilter} className="ml-1 hover:text-accent-rust" title="Clear filter">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <button
                  onClick={clearBookFilter}
                  className="text-sm text-stone-500 hover:text-stone-700 underline underline-offset-2 transition-colors"
                >
                  View all images
                </button>
              </>
            )}
            {collectionFilter && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-gold/15 text-accent-gold-dark rounded-full text-sm">
                Collection: {collectionFilter.replace(/-/g, ' ')}
                <button onClick={() => updateParams({ collection: '' })} className="hover:text-accent-gold-dark">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            {libraryFilter && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-stone-200 text-stone-700 rounded-full text-sm">
                Library: {getPartnerByProvider(libraryFilter)?.shortName || libraryFilter}
                <button onClick={() => updateParams({ library: '' })} className="hover:text-stone-900">
                  <X className="w-3 h-3" />
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
            {currentQualityLevel !== 'gallery' && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 text-purple-800 rounded-full text-sm">
                {currentQualityLevel === 'exhibition' ? 'Best only' : 'All images'}
                <button onClick={() => handleQualityChange('gallery')} className="hover:text-purple-600">
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
              {/* Quality Toggle */}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-2">Image Quality</label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: 'gallery', label: 'Gallery quality' },
                    { key: 'exhibition', label: 'Best only' },
                    { key: 'archive', label: 'Show all' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => handleQualityChange(key)}
                      className={`px-2 py-1 text-xs rounded-full transition-colors ${
                        currentQualityLevel === key
                          ? 'bg-accent-rust text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Library */}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-2">Library</label>
                <select
                  value={libraryFilter}
                  onChange={(e) => updateParams({ library: e.target.value })}
                  className="w-full px-2 py-1 text-sm border border-stone-300 rounded"
                >
                  <option value="">All libraries</option>
                  {Object.values(LIBRARY_PARTNERS).map((p) => (
                    <option key={p.providerKey} value={p.providerKey}>{p.shortName}</option>
                  ))}
                </select>
              </div>

              {/* Image Type */}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-2">Image Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => updateParams({ type: e.target.value })}
                  className="w-full px-2 py-1 text-sm border border-stone-300 rounded"
                >
                  <option value="">All types</option>
                  {data.filters.types.map((type) => (
                    <option key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subjects */}
              {data.filters.subjects.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-2">Subject</label>
                  <select
                    value={subjectFilter}
                    onChange={(e) => updateParams({ subject: e.target.value })}
                    className="w-full px-2 py-1 text-sm border border-stone-300 rounded"
                  >
                    <option value="">All subjects</option>
                    {data.filters.subjects.map((subject) => (
                      <option key={subject} value={subject}>
                        {subject.charAt(0).toUpperCase() + subject.slice(1)}
                      </option>
                    ))}
                  </select>
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

        {/* Featured Collections */}
        {showCollections && (
          <FeaturedCollections initialCollections={initialCollections} />
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <BookLoader size="sm" variant="dark" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-20">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-status-error">{error}</p>
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
            {!hasFilters && (
              <div className="mb-4">
                <h2 className="text-2xl font-serif text-stone-800 mb-1">Browse Images</h2>
                <p className="text-stone-500 text-base">
                  {data.total.toLocaleString()} illustrations from rare alchemical, Hermetic, and philosophical manuscripts.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
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
    </>
  );
}

function GalleryCard({ item }: { item: GalleryItem }) {
  const [imageError, setImageError] = useState(false);
  const [useCropFallback, setUseCropFallback] = useState(false);

  const cropUrl = item.bbox ? getCroppedImageUrl(item.imageUrl, item.bbox) : null;
  const blobUrl = item.extractedUrl || item.thumbnailUrl;

  const displayUrl = useCropFallback
    ? (cropUrl || toThumbnailUrl(item.imageUrl))
    : (blobUrl || cropUrl || toThumbnailUrl(item.imageUrl));

  const isPreGenerated = !useCropFallback && !!blobUrl;
  const galleryImageId = `${item.pageId}-${item.detectionIndex}`;

  return (
    <div className="relative group rounded-lg overflow-hidden hover:shadow-md transition-all hover:-translate-y-0.5">
      <Link href={`/gallery/image/${galleryImageId}`} className="block relative aspect-square bg-stone-100">
        {!imageError ? (
          <Image
            src={displayUrl}
            alt={item.description}
            fill
            quality={85}
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
            onLoad={(e) => {
              // Detect corrupt Blob thumbnails (real ones are 300px+)
              if (!useCropFallback && blobUrl && cropUrl) {
                const img = e.target as HTMLImageElement;
                if (img.naturalWidth < 150 || img.naturalHeight < 150) {
                  setUseCropFallback(true);
                }
              }
            }}
            onError={() => {
              if (!useCropFallback && cropUrl) {
                setUseCropFallback(true);
              } else {
                setImageError(true);
              }
            }}
            unoptimized={!isPreGenerated && !!item.bbox}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone-300">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
          <p className="text-sm text-white font-medium line-clamp-2 mb-0.5">
            {item.bookTitle}
          </p>
          {(item.author || item.year) && (
            <p className="text-xs text-white/60 line-clamp-1">
              {item.author}{item.author && item.year ? ', ' : ''}{item.year}
            </p>
          )}
        </div>

        {item.type && (
          <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white capitalize">
            {item.type}
          </span>
        )}
      </Link>

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
      await gallery.extractImages(bookInfo.id);
      window.location.reload();
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
            <div className="bg-accent-gold/8 rounded-lg p-4 mb-4">
              <ImagePlus className="w-8 h-8 text-accent-rust mx-auto mb-2" />
              <p className="text-accent-gold-dark text-sm">
                This book has OCR data but no extracted images yet.
              </p>
            </div>
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="px-6 py-2 bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 disabled:opacity-50 transition-colors"
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
              href={`/book/${bookInfo.slug || bookInfo.id}`}
              className="inline-block mt-3 text-accent-rust hover:text-accent-rust text-sm"
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
