'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  Image as ImageIcon, BookOpen, X, Loader2, ImagePlus, AlertCircle,
} from 'lucide-react';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import LikeButton from '@/components/ui/LikeButton';
import CatalogPagination from '@/components/collections/CatalogPagination';
import { BookLoader } from '@/components/ui/BookLoader';
import GalleryControls, { type GalleryUrlState } from '@/components/gallery/GalleryControls';
import { formatAuthor, toGalleryCardUrl } from '@/lib/utils';
import AuthorName from '@/components/AuthorName';
import {
  gallery,
  type GalleryResponse,
  type GalleryItem,
  type BookInfo,
  type BBox,
} from '@/lib/api-client';

interface BookCollectionOption {
  slug: string;
  name: string;
  book_count: number;
  parent?: string;
}

interface GalleryClientProps {
  initialData: GalleryResponse;
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

export default function GalleryClient({ initialData, bookCollections = [], initialBookId = '' }: GalleryClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // The global SL header is rendered by the page shell via ConditionalSiteHeader,
  // which suppresses it on embedded/tenant surfaces (CLAUDE.md invariant #5).
  // Same shared signal the header/footer use to drop global-only links on
  // partner subdomains (#3364, #3367).
  const isTenantHost = useIsEmbedded();

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
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  // Monotonic id of the newest filter fetch — see the fetch effect below.
  const fetchSeqRef = useRef(0);

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
  const topicFilter = searchParams.get('topic') || '';
  const yearStart = searchParams.get('yearStart') || '';
  const yearEnd = searchParams.get('yearEnd') || '';
  // Committed image search query (drives the fetch); comes from the URL only.
  const imageSearchQuery = searchParams.get('q') || '';
  // Merged-gallery source facet: 'all' (default, interleaves illustrations + artworks),
  // 'illustration', or 'artwork'.
  const sourceFilter = searchParams.get('source') || 'all';
  // Every image is reachable by default. Variety no longer comes from a per-book
  // cap (which hid ~3/4 of the gallery and made the count a lie) but from the
  // sort: within a quality score, book_rank comes first, so every book's best
  // image is shown before any book's second. A ?maxPerBook=N URL still caps.
  const maxPerBookParam = searchParams.get('maxPerBook');
  const maxPerBook = maxPerBookParam ? parseInt(maxPerBookParam, 10) : undefined;

  // Reader-chosen order (src/lib/gallery-sort.ts). '' = the default: best
  // quality for a browse, best match for a search. seed picks one of the
  // RANDOM_SEEDS shuffles and lives in the URL so a shuffled view can be shared.
  const sortParam = searchParams.get('sort') || '';
  const seedParam = searchParams.get('seed');
  const seed = seedParam !== null ? parseInt(seedParam, 10) : undefined;

  // Pages of 100 (about twenty rows of five), turned with the catalogue's own
  // pagination; ?page= keeps a page shareable and the back button working.
  const limit = 100;
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

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
    // Any change but a page turn goes back to page 1.
    params.delete('offset');
    params.delete('page');
    router.push(`${tenantPrefix}/gallery?${params.toString()}`);
  }, [searchParams, router, tenantPrefix]);

  // Everything the controls read, from the URL.
  const urlState: GalleryUrlState = {
    q: imageSearchQuery, topic: topicFilter, subject: subjectFilter, type: typeFilter, library: libraryFilter,
    collection: collectionFilter, bookId, yearStart, yearEnd, quality: currentQualityLevel as GalleryUrlState['quality'],
    source: sourceFilter, sort: sortParam,
  };
  // A fresh search or ask replaces every gallery parameter with its own.
  const replaceParams = useCallback((next: Record<string, string>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    if (next.sort === 'random' && seedParam) params.set('seed', seedParam);
    const qs = params.toString();
    router.push(`${tenantPrefix}/gallery${qs ? `?${qs}` : ''}`);
  }, [router, tenantPrefix, seedParam]);

  // Fetch gallery data when filters change (resets items).
  // Skip on initial load when the SSR payload already matches the URL: no URL
  // filters at all, OR the URL's bookId equals what the server pre-filtered on
  // and no other filters are present.
  useEffect(() => {
    const hasNonBookFilters = collectionFilter || libraryFilter || imageSearchQuery || typeFilter || subjectFilter || topicFilter || yearStart || yearEnd || qualityParam || includeArchive || sortParam;
    // The SSR payload is illustration-only; for the merged default ('all') or
    // artwork-only we must fetch on mount to pull artworks in. Only skip when the
    // request matches what the server already rendered (illustration-only, no filters).
    if (isInitialLoad && !hasNonBookFilters && bookId === initialBookId && sourceFilter === 'illustration' && page === 1) {
      setIsInitialLoad(false);
      return;
    }
    if (isInitialLoad) setIsInitialLoad(false);

    // Drop the previous filter's results the moment the filter set changes.
    // Keeping them meant a zero-result filter rendered "No images found"
    // alongside leftover items and a live "Load more" from the old query
    // (#3605) — two inconsistent pieces of state in one view.
    setAllItems([]);

    // Only the newest request may write state. Two fetches can overlap when
    // filters change quickly, and an older one resolving last used to restore
    // the previous filter's items over the current filter's empty result.
    // No visitor id is sent: the list must be the same URL for every reader so
    // the CDN can share it (liked state comes from LikeButton's own cache).
    const requestId = ++fetchSeqRef.current;

    const fetchGallery = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await gallery.list({
          limit,
          offset: (page - 1) * limit,
          bookId: bookId || undefined,
          collection: collectionFilter || undefined,
          maxPerBook,
          library: libraryFilter || undefined,
          query: imageSearchQuery || undefined,
          type: typeFilter || undefined,
          subject: subjectFilter || undefined,
          topic: topicFilter || undefined,
          yearFrom: yearStart ? parseInt(yearStart) : undefined,
          yearTo: yearEnd ? parseInt(yearEnd) : undefined,
          minQuality: qualityParam ? parseFloat(qualityParam) : undefined,
          source: sourceFilter !== 'all' ? (sourceFilter as 'illustration' | 'artwork') : undefined,
          sort: sortParam || undefined,
          seed,
        });
        if (requestId !== fetchSeqRef.current) return;
        // The default browse opens on a shuffled first screen (the order below
        // it stays best-first). Any explicit order, or a search, is shown as-is.
        const firstPage = !sortParam && !imageSearchQuery ? shuffle([...json.items]) : json.items;
        setData({ ...json, items: firstPage });
        setAllItems(firstPage);
      } catch (e) {
        if (requestId !== fetchSeqRef.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load gallery');
      } finally {
        if (requestId === fetchSeqRef.current) setLoading(false);
      }
    };

    fetchGallery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, collectionFilter, libraryFilter, imageSearchQuery, typeFilter, subjectFilter, topicFilter, maxPerBook, yearStart, yearEnd, qualityParam, includeArchive, sourceFilter, sortParam, seed, page]);

  // Pages from the response: the server's hasMore is authoritative (the plates-only
  // browse reports an estimated total), so the last page is the one that says no more.
  const totalPages = data?.hasMore === false
    ? page
    : Math.max(page + (data?.hasMore ? 1 : 0), Math.ceil((data?.total ?? 0) / limit));
  const goToPage = useCallback((n: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (n > 1) params.set('page', String(n)); else params.delete('page');
    const qs = params.toString();
    router.push(`${tenantPrefix}/gallery${qs ? `?${qs}` : ''}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [searchParams, router, tenantPrefix]);

  const hasFilters = bookId || collectionFilter || typeFilter || subjectFilter || topicFilter || libraryFilter || imageSearchQuery;

  // Every filter that narrows the query — including the ones `hasFilters`
  // ignores, since any of them can be the reason a view came back empty
  // (a hand-typed or shared `?type=` value that matches no facet, say).
  const hasActiveFilters = Boolean(
    hasFilters || yearStart || yearEnd || qualityParam || includeArchive || sourceFilter !== 'all'
  );

  const clearAllFilters = useCallback(() => {
    router.push(`${tenantPrefix}/gallery`);
  }, [router, tenantPrefix]);

  return (
    <>
      <div className="max-w-[var(--container-wide)] mx-auto px-4 sm:px-6 md:px-12 pt-4 md:pt-[26px] pb-6 overflow-x-hidden animate-fade-in-up">
        <GalleryControls
          state={urlState}
          replace={replaceParams}
          update={updateParams}
          data={data}
          loading={loading}
          bookCollections={bookCollections}
          isTenantHost={isTenantHost}
        />
        <div className="mt-6" />

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
            {/* Uneven masonry cropped by a fixed-height container + fade mask (handled inside). */}
            {/* Every image on the page is shown: no crop and fade, since the next page starts after the last one. */}
            <GalleryMasonry items={allItems} hasMore={false} tenantPrefix={tenantPrefix} collectionScope={collectionFilter || undefined} />
            <CatalogPagination currentPage={page} totalPages={totalPages} onPageChange={goToPage} />
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

  // Each tile goes to the shortest column so far (heights from aspect ratios,
  // no DOM measurement), so a page ends nearly level. Round-robin used to be
  // deliberate, for the old Load more's crop-and-fade; with pages, every tile is
  // shown and a ragged bottom left one column hanging far below the rest.
  const columns = useMemo(() => {
    const colArr: GalleryItem[][] = Array.from({ length: cols }, () => []);
    const heights = Array.from({ length: cols }, () => 0);
    for (const item of items) {
      let c = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[c] - 0.01) c = i;
      colArr[c].push(item);
      heights[c] += 1 / (item.aspect && item.aspect > 0 ? item.aspect : 0.75) + 0.06;
    }
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
  // but only when the row says it exists (item.cardUrl): deriving it blind cost
  // one guaranteed 404 per un-backfilled crop per render (#4465). onError still
  // falls back to the 300px thumb, then the extracted image (~2MB). Artwork
  // thumbs are already 600px, so toGalleryCardUrl returns null for them.
  const cardUrl = !cardFailed && item.cardUrl ? toGalleryCardUrl(item.thumbnailUrl) : null;
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
              // Card variant unreadable despite card_url → retry with the thumb.
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
