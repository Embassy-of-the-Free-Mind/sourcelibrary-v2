'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search, Image as ImageIcon, BookOpen, X,
  SlidersHorizontal, Loader2, ImagePlus, AlertCircle
} from 'lucide-react';
import LikeButton from '@/components/ui/LikeButton';
import { canLoadMore } from '@/lib/gallery-pagination';
import { useIdentity } from '@/hooks/useIdentity';
import { BookLoader } from '@/components/ui/BookLoader';
import FeaturedCollections from '@/components/gallery/FeaturedCollections';
import IconclassFilter from '@/components/gallery/IconclassFilter';
import { formatAuthor, toGalleryCardUrl } from '@/lib/utils';
import AuthorName from '@/components/AuthorName';
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

interface BookCollectionOption {
  slug: string;
  name: string;
  book_count: number;
  parent?: string;
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
  bookCollections?: BookCollectionOption[];
  /** bookId the SSR payload was pre-filtered on (if any). Used to skip the initial client refetch when the URL filter already matches the SSR result. */
  initialBookId?: string;
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

/** Fisher-Yates shuffle (in-place) */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function GalleryClient({ initialData, initialCollections, bookCollections = [], initialBookId = '' }: GalleryClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const identity = useIdentity();
  // The global SL header is rendered by the page shell via ConditionalSiteHeader,
  // which suppresses it on embedded/tenant surfaces (CLAUDE.md invariant #5).

  // Path-tenants (e.g. /internet-archive/gallery) should never propagate
  // into book/page links — those URLs are canonical at /book/{id}. The
  // pathname is intentionally unused; tenant subdomain rendering is handled
  // upstream via proxy.ts rewrites.
  void pathname;
  const tenantPrefix = '';

  // Render the server-provided order on first paint (matches SSR HTML so we
  // don't trip React error #418 hydration mismatch), then shuffle once we're
  // past hydration. Math.random() inside a useState initializer ran twice —
  // once on the server, once on the client — and produced different orders.
  const [data, setData] = useState<GalleryResponse>(initialData);
  const [allItems, setAllItems] = useState<GalleryItem[]>(initialData.items);
  const [hasShuffled, setHasShuffled] = useState(false);
  useEffect(() => {
    if (hasShuffled) return;
    const shuffled = shuffle(initialData.items);
    setData(prev => ({ ...prev, items: shuffled }));
    setAllItems(shuffled);
    setHasShuffled(true);
    // initialData is the prop from the server — stable for the lifetime of this mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentOffset, setCurrentOffset] = useState(initialData.items.length);
  const [showFilters, setShowFilters] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // Monotonic id of the newest filter fetch — see the fetch effect below.
  const fetchSeqRef = useRef(0);

  // Search state
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookSearchResults, setBookSearchResults] = useState<BookSearchResult[]>([]);
  const [bookSearchLoading, setBookSearchLoading] = useState(false);
  const [showBookDropdown, setShowBookDropdown] = useState(false);
  const bookSearchRef = useRef<HTMLDivElement>(null);

  // Image search: `searchInput` is the typed text; the committed query lives in
  // the URL (`q`) and only updates on Enter / the search button — no live search.
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');

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
  const iconclassFilter = searchParams.get('iconclass') || '';
  const yearStart = searchParams.get('yearStart') || '';
  const yearEnd = searchParams.get('yearEnd') || '';
  // Committed image search query (drives the fetch); comes from the URL only.
  const imageSearchQuery = searchParams.get('q') || '';
  // Merged-gallery source facet: 'all' (default, interleaves illustrations + artworks),
  // 'illustration', or 'artwork'.
  const sourceFilter = searchParams.get('source') || 'all';
  // /api/gallery caps results at 3 images per book by default, for variety on the
  // unscoped browse. Collection pages link here with maxPerBook=999 so "view all
  // N plates" lands on all N — but the param was never read, so those links
  // opened a page showing 9 of 267 and looked broken.
  const maxPerBookParam = searchParams.get('maxPerBook');

  const limit = 48;

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
    router.push(`${tenantPrefix}/gallery?${params.toString()}`);
  }, [searchParams, router, tenantPrefix]);

  // Fetch gallery data when filters change (resets items).
  // Skip on initial load when the SSR payload already matches the URL: no URL
  // filters at all, OR the URL's bookId equals what the server pre-filtered on
  // and no other filters are present.
  useEffect(() => {
    const hasNonBookFilters = collectionFilter || libraryFilter || imageSearchQuery || typeFilter || subjectFilter || iconclassFilter || yearStart || yearEnd || qualityParam || includeArchive;
    // The SSR payload is illustration-only; for the merged default ('all') or
    // artwork-only we must fetch on mount to pull artworks in. Only skip when the
    // request matches what the server already rendered (illustration-only, no filters).
    if (isInitialLoad && !hasNonBookFilters && bookId === initialBookId && sourceFilter === 'illustration') {
      setIsInitialLoad(false);
      return;
    }
    if (isInitialLoad) setIsInitialLoad(false);

    // Drop the previous filter's results the moment the filter set changes.
    // Keeping them meant a zero-result filter rendered "No images found"
    // alongside leftover items and a live "Load more" from the old query
    // (#3605) — two inconsistent pieces of state in one view.
    setAllItems([]);
    setCurrentOffset(0);

    // Only the newest request may write state. Two fetches overlap routinely
    // here (the identity id resolves after mount and re-runs this effect), and
    // an older one resolving last used to restore the previous filter's items
    // over the current filter's empty result.
    const requestId = ++fetchSeqRef.current;

    const fetchGallery = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await gallery.list({
          limit,
          offset: 0,
          bookId: bookId || undefined,
          collection: collectionFilter || undefined,
          maxPerBook: maxPerBookParam ? parseInt(maxPerBookParam, 10) : undefined,
          library: libraryFilter || undefined,
          query: imageSearchQuery || undefined,
          type: typeFilter || undefined,
          subject: subjectFilter || undefined,
          iconclass: iconclassFilter || undefined,
          yearFrom: yearStart ? parseInt(yearStart) : undefined,
          yearTo: yearEnd ? parseInt(yearEnd) : undefined,
          minQuality: qualityParam ? parseFloat(qualityParam) : undefined,
          source: sourceFilter !== 'all' ? (sourceFilter as 'illustration' | 'artwork') : undefined,
          visitorId: identity.id || undefined,
        });
        if (requestId !== fetchSeqRef.current) return;
        setData(json);
        setAllItems(json.items);
        // Paginate by page boundary, NOT cumulative item count. The merged
        // browse derives its page from `floor(offset / limit)`, so the next
        // offset must be a clean multiple of `limit`. Tracking the running
        // item count desynced whenever a page returned < limit items (e.g. a
        // type filter where artworks don't contribute → 36/page), which made
        // `floor(36/limit)` re-fetch page 0 → Load More showed duplicates or
        // appeared to do nothing.
        setCurrentOffset(limit);
      } catch (e) {
        if (requestId !== fetchSeqRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load gallery');
      } finally {
        if (requestId === fetchSeqRef.current) setLoading(false);
      }
    };

    fetchGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, collectionFilter, libraryFilter, imageSearchQuery, typeFilter, subjectFilter, iconclassFilter, yearStart, yearEnd, qualityParam, includeArchive, identity.id, sourceFilter]);

  // Load more handler — appends next batch to accumulated items
  const handleLoadMore = useCallback(async () => {
    // Guard on the in-flight flag only. The old `|| !data` early-out returned
    // silently and issued no request at all, which the reader experiences as a
    // dead button (#3605); `data` is not an input to the request anyway.
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const json = await gallery.list({
        limit,
        offset: currentOffset,
        bookId: bookId || undefined,
        collection: collectionFilter || undefined,
        maxPerBook: maxPerBookParam ? parseInt(maxPerBookParam, 10) : undefined,
        library: libraryFilter || undefined,
        query: imageSearchQuery || undefined,
        type: typeFilter || undefined,
        subject: subjectFilter || undefined,
        iconclass: iconclassFilter || undefined,
        yearFrom: yearStart ? parseInt(yearStart) : undefined,
        yearTo: yearEnd ? parseInt(yearEnd) : undefined,
        minQuality: qualityParam ? parseFloat(qualityParam) : undefined,
        source: sourceFilter !== 'all' ? (sourceFilter as 'illustration' | 'artwork') : undefined,
        visitorId: identity.id || undefined,
      });
      // Advance by a full page (see initial-fetch note). Dedup on append is a
      // belt-and-suspenders guard against any residual overlap (e.g. the
      // search path prepends one-off "lead" artworks on page 0).
      setAllItems(prev => {
        const seen = new Set(prev.map(it => `${it.pageId}-${it.detectionIndex}`));
        const fresh = json.items.filter((it: GalleryItem) => !seen.has(`${it.pageId}-${it.detectionIndex}`));
        return [...prev, ...fresh];
      });
      setCurrentOffset(prev => prev + limit);
      // Carry the response's own total AND hasMore forward. Trusting only the
      // stale total left the button live after a page that returned nothing,
      // so it kept fetching empty pages and appearing dead.
      setData(prev => prev
        ? { ...prev, total: json.total ?? prev.total, hasMore: json.hasMore }
        : json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more images');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, currentOffset, bookId, collectionFilter, libraryFilter, imageSearchQuery, typeFilter, subjectFilter, iconclassFilter, yearStart, yearEnd, qualityParam, identity.id, limit, sourceFilter]);

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

  // Prefer the server's reliable hasMore flag; fall back to total-vs-offset,
  // and never offer to extend an empty result set — a "Load more" button
  // rendered next to "No images found" is never right (#3605).
  const hasMore = canLoadMore(data, allItems.length, currentOffset);

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
    updateParams({ q: searchInput.trim() });
  };

  // Keep the input in sync with the committed query (back/forward, clearing a
  // chip, etc.) — only when `q` actually changes, never while typing.
  useEffect(() => {
    setSearchInput(imageSearchQuery);
  }, [imageSearchQuery]);

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
  const showCollections = !hasFilters;

  // Every filter that narrows the query — including the ones `hasFilters`
  // ignores, since any of them can be the reason a view came back empty
  // (a hand-typed or shared `?type=` value that matches no facet, say).
  const hasActiveFilters = Boolean(
    hasFilters || iconclassFilter || yearStart || yearEnd || qualityParam || includeArchive || sourceFilter !== 'all'
  );

  const clearAllFilters = useCallback(() => {
    router.push(`${tenantPrefix}/gallery`);
  }, [router, tenantPrefix]);

  return (
    <>
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-6 overflow-x-hidden animate-fade-in-up">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 mb-6">
          {/* Image Search */}
          <form onSubmit={handleImageSearch} className="flex-1 min-w-0 sm:min-w-[200px] max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input
              type="text"
              placeholder="Search images…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-[5.25rem] py-2 text-sm border border-stone-300 rounded-lg bg-white focus:ring-1 focus:ring-accent-rust focus:border-accent-rust"
            />
            <button
              type="submit"
              className="absolute right-0 top-0 bottom-0 px-4 text-sm font-medium bg-accent-rust text-white rounded-r-lg hover:bg-accent-rust/90 transition-colors"
            >
              Search
            </button>
          </form>

          {/* Book Search */}
          <div ref={bookSearchRef} className="relative min-w-0 sm:min-w-[200px] max-w-sm flex-1">
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
                    {book.author && <span className="text-stone-500 ml-1">— <AuthorName author={book.author} /></span>}
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
            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${showFilters ? 'bg-accent-rust text-white border-accent-rust' : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
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
                <button onClick={() => { setSearchInput(''); updateParams({ q: '' }); }} className="hover:text-blue-600">
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
              {/* Source: book plates vs standalone artworks */}
              <div>
                <label className="block text-xs font-medium text-stone-500 mb-2">Show</label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: 'all', label: 'Everything' },
                    { key: 'illustration', label: 'Plates' },
                    { key: 'artwork', label: 'Artworks' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => updateParams({ source: key === 'all' ? '' : key })}
                      className={`px-2 py-1 text-xs rounded-full transition-colors ${sourceFilter === key
                          ? 'bg-accent-rust text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

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
                      className={`px-2 py-1 text-xs rounded-full transition-colors ${currentQualityLevel === key
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

              {/* Collection */}
              {bookCollections.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-2">Collection</label>
                  <select
                    value={collectionFilter}
                    onChange={(e) => updateParams({ collection: e.target.value })}
                    className="w-full px-2 py-1 text-sm border border-stone-300 rounded"
                  >
                    <option value="">All collections</option>
                    {bookCollections.filter(c => !c.parent).map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name} ({c.book_count})
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              {/* Iconclass Subject */}
              <IconclassFilter
                value={iconclassFilter}
                onChange={(code) => updateParams({ iconclass: code })}
                compact
              />

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
            <BookLoader size="sm" variant="light" />
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
        {!loading && data?.bookInfo && allItems.length === 0 && (
          <BookEmptyState bookInfo={data.bookInfo} />
        )}

        {/* Empty State for Search with No Results */}
        {!loading && !data?.bookInfo && allItems.length === 0 && (
          <div className="text-center py-20">
            <ImageIcon className="w-16 h-16 text-stone-300 mx-auto mb-4" />
            <p className="text-stone-500 mb-2">No images found</p>
            <p className="text-stone-400 text-sm">
              {hasActiveFilters
                ? 'No images match these filters.'
                : 'Try a different search or browse all images'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full text-sm font-medium hover:bg-stone-50 hover:border-stone-400 transition-colors shadow-sm"
              >
                <X className="w-4 h-4" />
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Image Grid */}
        {!loading && data && allItems.length > 0 && (
          <>
            <div className="mb-4">
              <h2 className="text-2xl font-serif text-stone-800 mb-1">{hasFilters ? 'Results' : 'Browse Images'}</h2>
              <p className="text-stone-500 text-base">
                {data.total > 0
                  ? `${data.total.toLocaleString('en-US')} ${hasFilters ? 'results' : 'images'} — plates & standalone artworks`
                  : 'Plates & standalone artworks'}
              </p>
            </div>
            {/* Uneven masonry cropped by a fixed-height container + fade mask (handled inside). */}
            <GalleryMasonry items={allItems} hasMore={hasMore} tenantPrefix={tenantPrefix} collectionScope={collectionFilter || undefined} />
            <div className="mt-2" />

            {/* Load More */}
            {hasMore && (
              <div className="mt-8 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full text-sm font-medium hover:bg-stone-50 hover:border-stone-400 transition-colors shadow-sm disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// Masonry with intentionally UNEVEN columns, cropped by a fixed-height container
// + fade mask (NOT balanced). Tiles flow naturally round-robin; the container is
// capped to the shortest column's height so every column fills it (no whitespace
// gaps) while taller columns overflow past the bottom, where the mask fades the
// hard crop line. The cap grows with each load-more. 5 columns desktop, 3 below.
const MASONRY_GAP = 16;
function GalleryMasonry({ items, hasMore, tenantPrefix, collectionScope }: { items: GalleryItem[]; hasMore: boolean; tenantPrefix: string; collectionScope?: string }) {
  const [cols, setCols] = useState(5);
  const [containerWidth, setContainerWidth] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => {
      setCols(window.innerWidth >= 1024 ? 5 : 3);
      if (ref.current) setContainerWidth(ref.current.offsetWidth);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Natural round-robin — deliberately NOT height-balanced.
  const columns = useMemo(() => {
    const colArr: GalleryItem[][] = Array.from({ length: cols }, () => []);
    items.forEach((item, i) => colArr[i % cols].push(item));
    return colArr;
  }, [items, cols]);

  // Crop height = shortest column's pixel height (from aspect ratios — no DOM
  // measurement of tiles, so no flashing). Only crop while more pages remain.
  const cropHeight = useMemo(() => {
    if (!hasMore || !containerWidth || cols < 1) return undefined;
    const colWidth = (containerWidth - (cols - 1) * MASONRY_GAP) / cols;
    if (colWidth <= 0) return undefined;
    let minH = Infinity;
    for (const col of columns) {
      if (col.length === 0) continue;
      let h = 0;
      for (const it of col) { const a = it.aspect && it.aspect > 0 ? it.aspect : 0.75; h += colWidth / a + MASONRY_GAP; }
      if (h < minH) minH = h;
    }
    return Number.isFinite(minH) ? Math.round(minH - MASONRY_GAP) : undefined;
  }, [columns, containerWidth, cols, hasMore]);

  return (
    <div
      ref={ref}
      style={cropHeight ? {
        maxHeight: cropHeight,
        overflow: 'hidden',
        maskImage: 'linear-gradient(to bottom, #000 calc(100% - 20vh), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 20vh), transparent 100%)',
      } : undefined}
    >
      <div className="flex gap-3 sm:gap-4 items-start">
        {columns.map((col, ci) => (
          <div key={ci} className="flex-1 min-w-0 flex flex-col gap-3 sm:gap-4">
            {col.map((item, idx) => (
              <GalleryCard
                key={`${item.pageId}-${item.detectionIndex}`}
                item={item}
                priority={ci < cols && idx < 2}
                tenantPrefix={tenantPrefix}
                collectionScope={collectionScope}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function GalleryCard({ item, priority = false, tenantPrefix = '', collectionScope }: { item: GalleryItem; priority?: boolean; tenantPrefix?: string; collectionScope?: string }) {
  const [imageError, setImageError] = useState(false);
  const [useCropFallback, setUseCropFallback] = useState(false);
  const [cardFailed, setCardFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reservedAspect = item.aspect && item.aspect > 0 ? item.aspect : 0.75;

  // Standalone artworks have no bbox crop and link to their /book detail page,
  // not the gallery image viewer.
  const isArtwork = item.source === 'artwork';
  const cropUrl = !isArtwork && item.bbox ? getCroppedImageUrl(item.imageUrl, item.bbox) : null;
  // Prefer the 600px gallery `-card.jpg` for grid cards (sharp on retina; #2401),
  // falling back to the 300px thumb if its card variant isn't backfilled yet.
  // Extracted images (~2MB) are the last resort. Artwork thumbs are already
  // 600px, so toGalleryCardUrl returns null for them and blobUrl stays the thumb.
  const cardUrl = !cardFailed ? toGalleryCardUrl(item.thumbnailUrl) : null;
  const blobUrl = cardUrl || item.thumbnailUrl || item.extractedUrl;

  const displayUrl = useCropFallback
    ? (cropUrl || toThumbnailUrl(item.imageUrl))
    : (blobUrl || cropUrl || toThumbnailUrl(item.imageUrl));

  const galleryImageId = `${item.pageId}-${item.detectionIndex}`;
  // Forward the collection scope so the image viewer keeps prev/next inside the collection.
  const imageHref = isArtwork
    ? `${tenantPrefix}${item.link || `/book/${item.bookId}`}`
    : `${tenantPrefix}/gallery/image/${galleryImageId}${collectionScope ? `?collection=${encodeURIComponent(collectionScope)}` : ''}`;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 hover:shadow-md transition-all">
      {/* Reserve the exact tile box from the aspect ratio so nothing shifts as
          the image decodes (no jumping); the image then fades in smoothly. */}
      <Link href={imageHref} className="block relative bg-stone-100" style={{ aspectRatio: String(reservedAspect) }}>
        {!imageError ? (
          // Plain img (dodges next/image host allow-listing for external artwork hosts).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt={item.description}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className={`absolute inset-0 w-full h-full object-cover transition duration-500 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={(e) => {
              setLoaded(true);
              // Detect corrupt Blob thumbnails (real ones are 300px+)
              if (!useCropFallback && blobUrl && cropUrl) {
                const img = e.currentTarget;
                if (img.naturalWidth < 150 || img.naturalHeight < 150) setUseCropFallback(true);
              }
            }}
            onError={() => {
              // Card variant missing (not yet backfilled) → retry with the thumb.
              if (cardUrl) setCardFailed(true);
              else if (!useCropFallback && cropUrl) setUseCropFallback(true);
              else setImageError(true);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-stone-300">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(26,22,18,0.85)] via-[rgba(26,22,18,0.35)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300">
          <p className="text-sm text-white font-medium line-clamp-2 mb-0.5">
            {item.bookTitle}
          </p>
          {((item.author && item.author !== 'Various') || item.year) && (
            <p className="text-xs text-white/60 line-clamp-1">
              {item.author && item.author !== 'Various' ? formatAuthor(item.author).name : ''}{item.author && item.author !== 'Various' && item.year ? ', ' : ''}{item.year}
            </p>
          )}
        </div>

      </Link>

      <div className="absolute top-1.5 left-1.5 z-10">
        <div className="flex items-center bg-white/90 backdrop-blur-sm rounded-full shadow-sm hover:bg-white transition-colors px-1.5 py-0.5">
          <LikeButton
            targetType="image"
            targetId={galleryImageId}
            initialCount={item.likeCount ?? 0}
            initialLiked={item.likedByVisitor ?? false}
            size="sm"
            showCount={true}
          />
        </div>
      </div>
    </div>
  );
}

function BookEmptyState({ bookInfo }: { bookInfo: BookInfo }) {
  const pathname = usePathname();
  // Path-tenants (e.g. /internet-archive/gallery) should never propagate
  // into book/page links — those URLs are canonical at /book/{id}. The
  // pathname is intentionally unused; tenant subdomain rendering is handled
  // upstream via proxy.ts rewrites.
  void pathname;
  const tenantPrefix = '';
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
          <p className="text-stone-500 text-sm mb-4">by <AuthorName author={bookInfo.author} /></p>
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
              href={`${tenantPrefix}/book/${bookInfo.slug || bookInfo.id}`}
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
