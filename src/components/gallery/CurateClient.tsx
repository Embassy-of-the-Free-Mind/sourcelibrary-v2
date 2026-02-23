'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, Loader2, Check, Filter } from 'lucide-react';
import type { GalleryItem } from '@/lib/api-client/types/gallery';

const VISITOR_ID_KEY = 'sl_visitor_id';
const LIKES_CACHE_KEY = 'sl_likes_cache';
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

function getImageId(item: GalleryItem): string {
  return `${item.pageId}:${item.detectionIndex}`;
}

function getImageSrc(item: GalleryItem): string {
  return item.thumbnailUrl || item.extractedUrl || item.imageUrl;
}

export default function CurateClient() {
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Filters
  const [minQuality, setMinQuality] = useState(0.5);
  const [filterType, setFilterType] = useState('');
  const [showLikedOnly, setShowLikedOnly] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const initialLoadDone = useRef(false);

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
  }, [minQuality, filterType, types.length]);

  // Load liked IDs from server on mount
  useEffect(() => {
    const visitorId = getVisitorId();
    if (!visitorId) return;

    // Use localStorage cache as initial state
    const cache = getLikesCache();
    const initialLiked = new Set<string>();
    for (const key of Object.keys(cache)) {
      if (key.startsWith('image:') && cache[key]) {
        initialLiked.add(key.replace('image:', ''));
      }
    }
    setLikedIds(initialLiked);

    // Then fetch from server for accuracy
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
          // Update cache
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
  }, [minQuality, filterType]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current && !showLikedOnly) {
          fetchImages(offset, false);
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, offset, fetchImages, showLikedOnly]);

  // Toggle like
  const handleToggleLike = useCallback(async (item: GalleryItem) => {
    const imageId = getImageId(item);
    const visitorId = getVisitorId();
    if (!visitorId || toggling.has(imageId)) return;

    setToggling(prev => new Set(prev).add(imageId));

    // Optimistic update
    const wasLiked = likedIds.has(imageId);
    setLikedIds(prev => {
      const next = new Set(prev);
      if (wasLiked) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
    setLikeInCache(`image:${imageId}`, !wasLiked);
    setApplied(false);

    try {
      const res = await fetch('/api/likes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_type: 'image',
          target_id: imageId,
          visitor_id: visitorId,
        }),
      });
      const data = await res.json();
      // Sync with server response
      setLikedIds(prev => {
        const next = new Set(prev);
        if (data.liked) next.add(imageId);
        else next.delete(imageId);
        return next;
      });
      setLikeInCache(`image:${imageId}`, data.liked);
    } catch {
      // Revert on error
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
  }, [likedIds, toggling]);

  // Apply curated flag
  const handleApplyCurated = useCallback(async () => {
    if (likedIds.size === 0) return;
    if (!confirm(`Mark ${likedIds.size} images as curated? This will boost their gallery_quality by 0.1.`)) return;

    setApplying(true);
    try {
      const res = await fetch('/api/gallery/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds: [...likedIds] }),
      });
      const data = await res.json();
      if (data.success) {
        setApplied(true);
      } else {
        alert(data.error || 'Failed to apply curated flag');
      }
    } catch (err) {
      alert('Failed to apply curated flag');
      console.error(err);
    } finally {
      setApplying(false);
    }
  }, [likedIds]);

  // Filter displayed images
  const displayImages = showLikedOnly
    ? images.filter(img => likedIds.has(getImageId(img)))
    : images;

  const heartedCount = likedIds.size;

  return (
    <div className="max-w-[2000px] mx-auto">
      {/* Header bar */}
      <div className="sticky top-0 z-20 bg-cream/95 backdrop-blur-sm border-b border-border-light px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <h1 className="font-serif text-xl text-text-primary">Curate</h1>
            <span className="text-sm text-text-muted">
              <span className="text-accent-rust font-medium">{heartedCount}</span> hearted
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

            {/* Show liked only toggle */}
            <button
              onClick={() => setShowLikedOnly(v => !v)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                border transition-colors
                ${showLikedOnly
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-border-light text-text-secondary hover:border-border-medium'
                }
              `}
            >
              <Heart className="w-3.5 h-3.5" fill={showLikedOnly ? 'currentColor' : 'none'} />
              Liked only
            </button>

            {/* Apply curated button */}
            {heartedCount > 0 && (
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
                {applied ? 'Applied' : `Apply ${heartedCount} as curated`}
              </button>
            )}
          </div>
        </div>

        {/* Filter controls */}
        {filtersOpen && (
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border-light flex-wrap">
            {/* Min quality slider */}
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

            {/* Type filter */}
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

      {/* Image grid */}
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12 gap-0.5 p-0.5">
        {displayImages.map((item) => {
          const imageId = getImageId(item);
          const isLiked = likedIds.has(imageId);
          const isToggling = toggling.has(imageId);

          return (
            <div
              key={`${item.pageId}-${item.detectionIndex}`}
              className="relative aspect-square group cursor-pointer overflow-hidden bg-warm"
              onClick={() => handleToggleLike(item)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getImageSrc(item)}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />

              {/* Heart overlay — visible on hover or when liked */}
              <div
                className={`
                  absolute inset-0 flex items-center justify-center
                  transition-opacity duration-150
                  ${isLiked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                `}
              >
                <div className={`
                  rounded-full p-1.5
                  ${isLiked ? '' : 'bg-black/30'}
                `}>
                  <Heart
                    className={`
                      w-5 h-5 drop-shadow-md transition-transform duration-150
                      ${isLiked ? 'text-red-500 scale-110' : 'text-white'}
                      ${isToggling ? 'animate-pulse' : ''}
                    `}
                    fill={isLiked ? 'currentColor' : 'none'}
                    strokeWidth={isLiked ? 0 : 2.5}
                  />
                </div>
              </div>

              {/* Quality badge — tiny, bottom-right */}
              {item.galleryQuality !== undefined && (
                <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono text-white/70 bg-black/40 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  {item.galleryQuality.toFixed(2)}
                </span>
              )}
            </div>
          );
        })}
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
          {showLikedOnly ? 'No liked images yet. Click hearts to curate.' : 'No images found.'}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {!showLikedOnly && <div ref={sentinelRef} className="h-1" />}
    </div>
  );
}
