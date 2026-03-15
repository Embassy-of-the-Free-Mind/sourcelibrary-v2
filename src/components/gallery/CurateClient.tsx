'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { toast } from 'sonner';
import { Grid, type CellComponentProps } from 'react-window';
import { Heart, ThumbsDown, Loader2, Check, Filter, X, ChevronLeft, ChevronRight, Info, Shuffle, Clock, Grid3X3, LayoutGrid, Square } from 'lucide-react';
import type { GalleryItem } from '@/lib/api-client/types/gallery';

const VISITOR_ID_KEY = 'sl_visitor_id';
const LIKES_CACHE_KEY = 'sl_likes_cache';
const DOWNVOTES_KEY = 'sl_curate_downvotes';
const BATCH_SIZE = 200;

function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  let visitorId = localStorage.getItem(VISITOR_ID_KEY);
  if (!visitorId) {
    visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }
  return visitorId;
}

function getLikesCache(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const cached = localStorage.getItem(LIKES_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setLikeInCache(key: string, liked: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const cache = getLikesCache();
    if (liked) {
      cache[key] = true;
    } else {
      delete cache[key];
    }
    localStorage.setItem(LIKES_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

function getDownvotesCache(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const cached = localStorage.getItem(DOWNVOTES_KEY);
    return cached ? new Set(JSON.parse(cached)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDownvotesCache(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DOWNVOTES_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage errors
  }
}

function getImageId(item: GalleryItem): string {
  return `${item.pageId}:${item.detectionIndex}`;
}

function getImageSrc(item: GalleryItem): string {
  return item.thumbnailUrl || item.extractedUrl || item.imageUrl;
}

// --- Memoized tile component (win #1) ---
interface ImageTileProps {
  item: GalleryItem;
  imageId: string;
  isLiked: boolean;
  isDownvoted: boolean;
  isToggling: boolean;
  infoOpen: boolean;
  isExcluded: boolean;
  onLike: (item: GalleryItem, e: React.MouseEvent) => void;
  onDownvote: (item: GalleryItem, e: React.MouseEvent) => void;
  onClickTile: () => void;
  onToggleInfo: (imageId: string) => void;
  onExcludeBook: (item: GalleryItem) => void;
}

const ImageTile = memo(function ImageTile({
  item, imageId, isLiked, isDownvoted, isToggling, infoOpen, isExcluded,
  onLike, onDownvote, onClickTile, onToggleInfo, onExcludeBook,
}: ImageTileProps) {
  const hasRating = isLiked || isDownvoted;

  return (
    <div
      className={`
        relative aspect-square group cursor-pointer overflow-hidden bg-warm
        ${isDownvoted ? 'opacity-40' : ''}
      `}
      onClick={onClickTile}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getImageSrc(item)}
        alt=""
        loading="lazy"
        className="w-full h-full object-cover"
      />

      {/* Action buttons — visible on hover or when rated */}
      <div
        className={`
          absolute inset-0 flex items-center justify-center gap-3
          transition-opacity duration-150
          ${hasRating ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        `}
      >
        <button
          onClick={(e) => onLike(item, e)}
          className={`
            rounded-full p-1.5 transition-all duration-150
            ${isLiked ? '' : 'bg-black/30 hover:bg-black/50'}
          `}
        >
          <Heart
            className={`
              w-5 h-5 drop-shadow-md transition-transform duration-150
              ${isLiked ? 'text-status-error scale-110' : 'text-white'}
              ${isToggling ? 'animate-pulse' : ''}
            `}
            fill={isLiked ? 'currentColor' : 'none'}
            strokeWidth={isLiked ? 0 : 2.5}
          />
        </button>

        <button
          onClick={(e) => onDownvote(item, e)}
          className={`
            rounded-full p-1.5 transition-all duration-150
            ${isDownvoted ? '' : 'bg-black/30 hover:bg-black/50'}
          `}
        >
          <ThumbsDown
            className={`
              w-4.5 h-4.5 drop-shadow-md transition-transform duration-150
              ${isDownvoted ? 'text-blue-500 scale-110' : 'text-white'}
            `}
            fill={isDownvoted ? 'currentColor' : 'none'}
            strokeWidth={isDownvoted ? 0 : 2.5}
          />
        </button>
      </div>

      {/* Info button — bottom-left */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleInfo(imageId);
        }}
        className="absolute bottom-0.5 left-0.5 rounded-full p-0.5 bg-black/40 text-white/70 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {/* Info overlay */}
      {infoOpen && (
        <div
          className="absolute inset-x-0 bottom-0 bg-black/85 text-white p-2 text-[10px] leading-tight z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-medium line-clamp-2">{item.bookTitle}</p>
          {item.author && <p className="text-white/60 mt-0.5">{item.author}{item.year ? `, ${item.year}` : ''}</p>}
          <p className="text-white/50 mt-0.5">
            {item.type && <span className="capitalize">{item.type}</span>}
            {item.galleryQuality !== undefined && <span> · {item.galleryQuality.toFixed(2)}</span>}
            {item.pageNumber > 0 && <span> · p.{item.pageNumber}</span>}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExcludeBook(item);
            }}
            className={`mt-1 text-[9px] px-1.5 py-0.5 rounded transition-colors ${
              isExcluded
                ? 'bg-amber-500/30 text-amber-300'
                : 'bg-white/10 text-white/50 hover:bg-amber-500/20 hover:text-amber-300'
            }`}
          >
            {isExcluded ? 'Excluded from showcase' : 'Exclude book from showcase'}
          </button>
        </div>
      )}

      {/* Quality badge — tiny, bottom-right */}
      {item.galleryQuality !== undefined && !infoOpen && (
        <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono text-white/70 bg-black/40 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
          {item.galleryQuality.toFixed(2)}
        </span>
      )}
    </div>
  );
});

// --- Grid cell component for react-window v2 ---
interface GridCellProps {
  displayImages: GalleryItem[];
  columnCount: number;
  likedIds: Set<string>;
  downvotedIds: Set<string>;
  toggling: Set<string>;
  infoId: string | null;
  excludedBooks: Set<string>;
  onLike: (item: GalleryItem, e: React.MouseEvent) => void;
  onDownvote: (item: GalleryItem, e: React.MouseEvent) => void;
  onClickTile: (idx: number) => void;
  onToggleInfo: (imageId: string) => void;
  onExcludeBook: (item: GalleryItem) => void;
  gap: number;
}

function GridCell({ columnIndex, rowIndex, style, ...cellProps }: CellComponentProps<GridCellProps>) {
  const { displayImages, columnCount, likedIds, downvotedIds, toggling, infoId, excludedBooks, onLike, onDownvote, onClickTile, onToggleInfo, onExcludeBook, gap } = cellProps;
  const idx = rowIndex * columnCount + columnIndex;
  if (idx >= displayImages.length) return <div style={style} />;

  const item = displayImages[idx];
  const imageId = getImageId(item);

  return (
    <div style={{ ...style, padding: gap / 2 }}>
      <ImageTile
        item={item}
        imageId={imageId}
        isLiked={likedIds.has(imageId)}
        isDownvoted={downvotedIds.has(imageId)}
        isToggling={toggling.has(imageId)}
        infoOpen={infoId === imageId}
        isExcluded={excludedBooks.has(item.bookId)}
        onLike={onLike}
        onDownvote={onDownvote}
        onClickTile={() => onClickTile(idx)}
        onToggleInfo={onToggleInfo}
        onExcludeBook={onExcludeBook}
      />
    </div>
  );
}

// --- Column count for grid sizes at various breakpoints ---
function useColumnCount(gridSize: 'sm' | 'md' | 'lg'): number {
  const [cols, setCols] = useState(6);

  useEffect(() => {
    function compute() {
      const w = window.innerWidth;
      if (gridSize === 'sm') {
        if (w >= 1280) return 12;
        if (w >= 1024) return 10;
        if (w >= 768) return 8;
        if (w >= 640) return 6;
        return 4;
      } else if (gridSize === 'md') {
        if (w >= 1280) return 6;
        if (w >= 1024) return 5;
        if (w >= 768) return 4;
        if (w >= 640) return 3;
        return 2;
      } else {
        if (w >= 768) return 3;
        if (w >= 640) return 2;
        return 1;
      }
    }

    setCols(compute());
    const handler = () => setCols(compute());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [gridSize]);

  return cols;
}

// --- Main component ---
export default function CurateClient() {
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [downvotedIds, setDownvotedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [excludedBooks, setExcludedBooks] = useState<Set<string>>(new Set());

  // Grid size
  const [gridSize, setGridSize] = useState<'sm' | 'md' | 'lg'>('md');

  // Sort
  const [sortMode, setSortMode] = useState<'default' | 'random' | 'likes' | 'time'>('default');
  const [randomSeed, setRandomSeed] = useState(0);

  // Filters
  const [minQuality, setMinQuality] = useState(0.5);
  const [filterType, setFilterType] = useState('');
  const [filterCollection, setFilterCollection] = useState('');
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const [showDownvotedOnly, setShowDownvotedOnly] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [collections, setCollections] = useState<{ slug: string; name: string }[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Virtualization
  const columnCount = useColumnCount(gridSize);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const initialLoadDone = useRef(false);

  // Stable refs for callbacks (win #4 — avoids useCallback re-creation)
  const likedIdsRef = useRef(likedIds);
  likedIdsRef.current = likedIds;
  const downvotedIdsRef = useRef(downvotedIds);
  downvotedIdsRef.current = downvotedIds;
  const toggledRef = useRef(toggling);
  toggledRef.current = toggling;

  // Fetch images from gallery API
  const fetchImages = useCallback(async (newOffset: number, reset: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const params = new URLSearchParams({
        limit: BATCH_SIZE.toString(),
        offset: newOffset.toString(),
        minQuality: minQuality.toString(),
        maxPerBook: '999',
      });
      if (filterType) params.append('type', filterType);
      if (filterCollection) params.append('collection', filterCollection);

      const res = await fetch(`/api/gallery?${params}`);
      const data = await res.json();

      if (reset) {
        setImages(data.items || []);
      } else {
        setImages(prev => [...prev, ...(data.items || [])]);
      }

      setTotal(data.total || 0);
      setHasMore((data.items?.length || 0) >= BATCH_SIZE);
      setOffset(newOffset + (data.items?.length || 0));

      // Capture filter types on first load
      if (data.filters?.types?.length && types.length === 0) {
        setTypes(data.filters.types);
      }
    } catch (err) {
      console.error('Failed to fetch gallery:', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [minQuality, filterType, filterCollection]);

  // Fetch ALL images (for sorting modes)
  const fetchAll = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const allItems: GalleryItem[] = [];
      let fetchOffset = 0;
      let keepGoing = true;

      while (keepGoing) {
        const params = new URLSearchParams({
          limit: '1000',
          offset: fetchOffset.toString(),
          minQuality: minQuality.toString(),
          maxPerBook: '999',
        });
        if (filterType) params.append('type', filterType);
        if (filterCollection) params.append('collection', filterCollection);

        const res = await fetch(`/api/gallery?${params}`);
        const data = await res.json();
        const items = data.items || [];
        allItems.push(...items);
        fetchOffset += items.length;

        if (items.length < 1000) keepGoing = false;

        if (allItems.length === items.length) {
          setTotal(data.total || 0);
          if (data.filters?.types?.length && types.length === 0) {
            setTypes(data.filters.types);
          }
        }
      }

      setImages(allItems);
      setHasMore(false);
      setOffset(allItems.length);
    } catch (err) {
      console.error('Failed to fetch all gallery:', err);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [minQuality, filterType, filterCollection]);

  // When sort mode changes to non-default, load all images if we haven't yet
  useEffect(() => {
    if (sortMode !== 'default' && hasMore && images.length < total) {
      fetchAll();
    }
  }, [sortMode]);

  // Load liked IDs + downvoted IDs on mount
  useEffect(() => {
    setDownvotedIds(getDownvotesCache());

    const visitorId = getVisitorId();
    if (!visitorId) return;

    const cache = getLikesCache();
    const initialLiked = new Set<string>();
    for (const key of Object.keys(cache)) {
      if (key.startsWith('image:') && cache[key]) {
        initialLiked.add(key.replace('image:', ''));
      }
    }
    setLikedIds(initialLiked);

    fetch('/api/collections')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCollections(data.map((c: { slug: string; name: string }) => ({ slug: c.slug, name: c.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)));
        }
      })
      .catch(() => {});

    fetch(`/api/likes/mine?visitor_id=${visitorId}&type=image&limit=5000`)
      .then(res => res.json())
      .then(data => {
        if (data.items) {
          const serverLiked = new Set<string>();
          for (const item of data.items) {
            const id = item.galleryImageId || item.id;
            if (id) serverLiked.add(id);
          }
          setLikedIds(serverLiked);
          for (const id of serverLiked) {
            setLikeInCache(`image:${id}`, true);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Initial load + reset on filter change
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
    }
    setOffset(0);
    setHasMore(true);
    fetchImages(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minQuality, filterType, filterCollection]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current && !showLikedOnly && !showDownvotedOnly) {
          fetchImages(offset, false);
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, offset, fetchImages, showLikedOnly, showDownvotedOnly]);

  // Toggle like — uses refs so the callback identity is stable
  const handleToggleLike = useCallback(async (item: GalleryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const imageId = getImageId(item);
    const visitorId = getVisitorId();
    if (!visitorId || toggledRef.current.has(imageId)) return;

    if (downvotedIdsRef.current.has(imageId)) {
      setDownvotedIds(prev => {
        const next = new Set(prev);
        next.delete(imageId);
        saveDownvotesCache(next);
        return next;
      });
    }

    setToggling(prev => new Set(prev).add(imageId));
    setApplied(false);

    const wasLiked = likedIdsRef.current.has(imageId);
    setLikedIds(prev => {
      const next = new Set(prev);
      if (wasLiked) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
    setLikeInCache(`image:${imageId}`, !wasLiked);

    try {
      const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'image', target_id: imageId, visitor_id: visitorId }),
      });
      const data = await res.json();
      setLikedIds(prev => {
        const next = new Set(prev);
        if (data.liked) next.add(imageId);
        else next.delete(imageId);
        return next;
      });
      setLikeInCache(`image:${imageId}`, data.liked);
    } catch {
      setLikedIds(prev => {
        const next = new Set(prev);
        if (wasLiked) next.add(imageId);
        else next.delete(imageId);
        return next;
      });
      setLikeInCache(`image:${imageId}`, wasLiked);
    } finally {
      setToggling(prev => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  }, []);

  // Toggle downvote — stable callback via refs
  const handleToggleDownvote = useCallback((item: GalleryItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const imageId = getImageId(item);

    if (likedIdsRef.current.has(imageId)) {
      const visitorId = getVisitorId();
      if (visitorId) {
        setLikedIds(prev => {
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
        setLikeInCache(`image:${imageId}`, false);
        fetch('/api/likes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_type: 'image', target_id: imageId, visitor_id: visitorId }),
        }).catch(() => {});
      }
    }

    setDownvotedIds(prev => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      saveDownvotesCache(next);
      return next;
    });
    setApplied(false);
  }, []);

  const handleToggleInfo = useCallback((imageId: string) => {
    setInfoId(prev => prev === imageId ? null : imageId);
  }, []);

  const handleExcludeBook = useCallback(async (item: GalleryItem) => {
    if (excludedBooks.has(item.bookId)) return;
    try {
      const res = await fetch('/api/gallery/curate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: item.bookId, galleryExclude: true }),
      });
      if (res.ok) {
        setExcludedBooks(prev => new Set(prev).add(item.bookId));
        toast.success(`Excluded: ${item.bookTitle}`);
      }
    } catch { toast.error('Failed to exclude book'); }
  }, [excludedBooks]);

  // Apply curation
  const handleApplyCurated = useCallback(async () => {
    const upCount = likedIdsRef.current.size;
    const downCount = downvotedIdsRef.current.size;
    if (upCount === 0 && downCount === 0) return;

    const parts = [];
    if (upCount > 0) parts.push(`${upCount} upvoted (+0.1 quality)`);
    if (downCount > 0) parts.push(`${downCount} downvoted (-0.15 quality)`);
    if (!confirm(`Apply curation? ${parts.join(', ')}`)) return;

    setApplying(true);
    try {
      const res = await fetch('/api/gallery/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upvoteIds: [...likedIdsRef.current],
          downvoteIds: [...downvotedIdsRef.current],
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApplied(true);
        toast.success(`Applied: ${data.upvotes.modified} boosted, ${data.downvotes.modified} penalized`);
      } else {
        toast.error(data.error || 'Failed to apply curation');
      }
    } catch (err) {
      toast.error('Failed to apply curation');
      console.error(err);
    } finally {
      setApplying(false);
    }
  }, []);

  // --- Win #2: useMemo on filter + sort ---
  const displayImages = useMemo(() => {
    let filtered: GalleryItem[];
    if (showLikedOnly) {
      filtered = images.filter(img => likedIds.has(getImageId(img)));
    } else if (showDownvotedOnly) {
      filtered = images.filter(img => downvotedIds.has(getImageId(img)));
    } else {
      filtered = images;
    }

    if (sortMode === 'default') return filtered;

    const sorted = [...filtered];
    if (sortMode === 'random') {
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(((Math.sin(i + randomSeed) + 1) / 2) * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
    } else if (sortMode === 'likes') {
      sorted.sort((a, b) => {
        const aLiked = likedIds.has(getImageId(a)) ? 1 : 0;
        const bLiked = likedIds.has(getImageId(b)) ? 1 : 0;
        return bLiked - aLiked;
      });
    } else if (sortMode === 'time') {
      sorted.sort((a, b) => (a.year || 9999) - (b.year || 9999));
    }
    return sorted;
  }, [images, likedIds, downvotedIds, showLikedOnly, showDownvotedOnly, sortMode, randomSeed]);

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      else if (e.key === 'ArrowRight') setLightboxIndex(i => i !== null ? Math.min(i + 1, displayImages.length - 1) : null);
      else if (e.key === 'ArrowLeft') setLightboxIndex(i => i !== null ? Math.max(i - 1, 0) : null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxIndex, displayImages.length]);

  const heartedCount = likedIds.size;
  const downvotedCount = downvotedIds.size;

  // --- Win #3: Virtualized grid ---
  const rowCount = Math.ceil(displayImages.length / columnCount);
  const gap = 4;

  const handleClickTile = useCallback((idx: number) => {
    setLightboxIndex(idx);
  }, []);

  const cellProps = useMemo<GridCellProps>(() => ({
    displayImages,
    columnCount,
    likedIds,
    downvotedIds,
    toggling,
    infoId,
    excludedBooks,
    onLike: handleToggleLike,
    onDownvote: handleToggleDownvote,
    onClickTile: handleClickTile,
    onToggleInfo: handleToggleInfo,
    onExcludeBook: handleExcludeBook,
    gap,
  }), [displayImages, columnCount, likedIds, downvotedIds, toggling, infoId, excludedBooks, handleToggleLike, handleToggleDownvote, handleClickTile, handleToggleInfo, handleExcludeBook]);

  return (
    <div className="max-w-[2000px] mx-auto">
      {/* Header bar */}
      <div className="sticky top-0 z-20 bg-cream/95 backdrop-blur-sm border-b border-border-light px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <h1 className="font-serif text-xl text-text-primary">Curate</h1>
            <span className="text-sm text-text-muted">
              <span className="text-status-error font-medium">{heartedCount}</span>
              {' '}
              <Heart className="w-3 h-3 inline text-status-error" fill="currentColor" />
              {downvotedCount > 0 && (
                <>
                  {' / '}
                  <span className="text-blue-500 font-medium">{downvotedCount}</span>
                  {' '}
                  <ThumbsDown className="w-3 h-3 inline text-blue-500" fill="currentColor" />
                </>
              )}
              {' / '}
              <span>{total.toLocaleString()}</span> total
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Filters toggle */}
            <button
              onClick={() => setFiltersOpen(v => !v)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${filtersOpen
                  ? 'border-accent-rust/30 bg-accent-rust/5 text-accent-rust'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Filter className="w-3.5 h-3.5" />
              Filters
            </button>

            {/* Grid size toggle */}
            <div className="inline-flex rounded-md border border-border-light overflow-hidden">
              {([['sm', Grid3X3, 'Small'], ['md', LayoutGrid, 'Medium'], ['lg', Square, 'Large']] as const).map(([size, Icon, label]) => (
                <button
                  key={size}
                  onClick={() => setGridSize(size)}
                  title={label}
                  className={`
                    p-1.5 transition-colors
                    ${gridSize === size
                      ? 'bg-accent-rust/10 text-accent-rust'
                      : 'text-text-secondary hover:bg-warm'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>

            {/* Sort buttons */}
            <button
              onClick={() => {
                setSortMode('random');
                setRandomSeed(s => s + 1);
              }}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${sortMode === 'random'
                  ? 'border-accent-rust/30 bg-accent-rust/5 text-accent-rust'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Shuffle className="w-3.5 h-3.5" />
              Random
            </button>

            <button
              onClick={() => setSortMode(s => s === 'likes' ? 'default' : 'likes')}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${sortMode === 'likes'
                  ? 'border-accent-rust/30 bg-accent-rust/5 text-accent-rust'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Heart className="w-3.5 h-3.5" />
              By likes
            </button>

            <button
              onClick={() => setSortMode(s => s === 'time' ? 'default' : 'time')}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${sortMode === 'time'
                  ? 'border-accent-rust/30 bg-accent-rust/5 text-accent-rust'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Clock className="w-3.5 h-3.5" />
              By year
            </button>

            {/* Show liked only toggle */}
            <button
              onClick={() => { setShowLikedOnly(v => !v); setShowDownvotedOnly(false); }}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${showLikedOnly
                  ? 'border-red-300 bg-red-50 text-status-error'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Heart className="w-3.5 h-3.5" fill={showLikedOnly ? 'currentColor' : 'none'} />
              Liked
            </button>

            {/* Show downvoted only toggle */}
            {downvotedCount > 0 && (
              <button
                onClick={() => { setShowDownvotedOnly(v => !v); setShowLikedOnly(false); }}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                  border transition-colors
                  ${showDownvotedOnly
                    ? 'border-blue-300 bg-blue-50 text-blue-600'
                    : 'border-border-light text-text-secondary hover:border-border-medium'
                  }
                `}
              >
                <ThumbsDown className="w-3.5 h-3.5" fill={showDownvotedOnly ? 'currentColor' : 'none'} />
                Downvoted
              </button>
            )}

            {/* Apply curated button */}
            {(heartedCount > 0 || downvotedCount > 0) && (
              <button
                onClick={handleApplyCurated}
                disabled={applying || applied}
                className={`
                  inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                  transition-colors
                  ${applied
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-accent-rust text-white hover:bg-accent-rust/90'
                  }
                  disabled:opacity-50
                `}
              >
                {applying ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : applied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : null}
                {applied ? 'Applied' : `Apply ${heartedCount + downvotedCount} ratings`}
              </button>
            )}
          </div>
        </div>

        {/* Filter controls */}
        {filtersOpen && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border-light flex-wrap">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Min quality
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={minQuality}
                onChange={e => setMinQuality(parseFloat(e.target.value))}
                className="w-32 accent-accent-rust"
              />
              <span className="font-mono text-xs w-8">{minQuality.toFixed(2)}</span>
            </label>

            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Collection
              <select
                value={filterCollection}
                onChange={e => setFilterCollection(e.target.value)}
                className="px-2 py-1 text-sm border border-border-light rounded bg-white"
              >
                <option value="">All</option>
                {collections.map(c => (
                  <option key={c.slug} value={c.slug}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Type
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="px-2 py-1 text-sm border border-border-light rounded bg-white"
              >
                <option value="">All</option>
                {types.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Virtualized image grid (win #3) */}
      <div ref={containerRef} className={gridSize === 'lg' ? 'max-w-5xl mx-auto' : ''} style={{ height: 'calc(100vh - 60px)' }}>
        {containerWidth > 0 && displayImages.length > 0 && (
          <Grid<GridCellProps>
            columnCount={columnCount}
            columnWidth={Math.floor(containerWidth / columnCount)}
            rowCount={rowCount}
            rowHeight={Math.floor(containerWidth / columnCount)}
            overscanCount={4}
            cellComponent={GridCell}
            cellProps={cellProps}
            style={{ overflowX: 'hidden' }}
          />
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
        </div>
      )}

      {/* Empty state */}
      {!loading && displayImages.length === 0 && (
        <div className="flex justify-center py-16 text-text-muted text-sm">
          {showLikedOnly
            ? 'No liked images yet.'
            : showDownvotedOnly
            ? 'No downvoted images yet.'
            : 'No images found.'}
        </div>
      )}

      {/* Infinite scroll sentinel (fallback for non-virtualized path) */}
      {!showLikedOnly && !showDownvotedOnly && <div ref={sentinelRef} className="h-1" />}

      {/* Lightbox */}
      {lightboxIndex !== null && displayImages[lightboxIndex] && (() => {
        const item = displayImages[lightboxIndex];
        const imageId = getImageId(item);
        const isLiked = likedIds.has(imageId);
        const isDownvoted = downvotedIds.has(imageId);
        const fullSrc = item.extractedUrl || item.imageUrl;

        return (
          <div
            className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
            onClick={() => setLightboxIndex(null)}
          >
            {/* Top bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/50" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => handleToggleLike(item, e)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <Heart
                    className={`w-5 h-5 ${isLiked ? 'text-status-error' : 'text-white'}`}
                    fill={isLiked ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  onClick={(e) => handleToggleDownvote(item, e)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <ThumbsDown
                    className={`w-5 h-5 ${isDownvoted ? 'text-blue-500' : 'text-white'}`}
                    fill={isDownvoted ? 'currentColor' : 'none'}
                  />
                </button>
                {item.galleryQuality !== undefined && (
                  <span className="text-white/60 text-xs font-mono">{item.galleryQuality.toFixed(2)}</span>
                )}
                <span className="text-white/70 text-xs max-w-sm truncate hidden sm:inline">
                  {item.bookTitle}{item.author ? ` — ${item.author}` : ''}{item.year ? ` (${item.year})` : ''}
                </span>
                {item.type && (
                  <span className="text-white/40 text-xs capitalize hidden md:inline">· {item.type}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-xs">{lightboxIndex + 1} / {displayImages.length}</span>
                <button
                  onClick={() => setLightboxIndex(null)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Image + nav */}
            <div className="flex-1 flex items-center justify-center relative overflow-hidden" onClick={e => e.stopPropagation()}>
              {lightboxIndex > 0 && (
                <button
                  onClick={() => setLightboxIndex(lightboxIndex - 1)}
                  className="absolute left-2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6 text-white" />
                </button>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fullSrc}
                alt={item.description || ''}
                className="max-w-full max-h-full object-contain"
                onClick={() => setLightboxIndex(null)}
              />

              {lightboxIndex < displayImages.length - 1 && (
                <button
                  onClick={() => setLightboxIndex(lightboxIndex + 1)}
                  className="absolute right-2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
                >
                  <ChevronRight className="w-6 h-6 text-white" />
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
