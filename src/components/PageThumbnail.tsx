'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Page } from '@/lib/types';
import { recordLoadingMetric } from '@/lib/analytics';

interface PageThumbnailProps {
  page: Page;
  bookId: string;
  index: number;
}

export default function PageThumbnail({ page, bookId, index }: PageThumbnailProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(index < 10); // Load first 10 immediately
  const imgRef = useRef<HTMLDivElement>(null);
  const loadStartTime = useRef<number | null>(null);

  useEffect(() => {
    loadStartTime.current = performance.now();
  }, []);

  const handleImageLoad = () => {
    if (loadStartTime.current !== null) {
      const loadTime = performance.now() - loadStartTime.current;
      recordLoadingMetric('page_thumbnail_load', loadTime, {
        bookId,
        pageId: page.id,
        pageNumber: page.page_number,
        index,
        eager: index < 10
      });
    }
    setImageLoaded(true);
  };

  const hasOcr = !!page.ocr?.data;
  const hasTranslation = !!page.translation?.data;
  const hasSummary = !!page.summary?.data;
  const isComplete = hasOcr && hasTranslation && hasSummary;

  // Build image URL with crop if available
  const getImageUrl = () => {
    // If we have a pre-generated cropped photo, use it
    const croppedPhoto = (page as unknown as Record<string, unknown>).cropped_photo as string | undefined;
    if (page.crop && croppedPhoto) {
      return croppedPhoto;
    }
    const baseUrl = page.photo_original || page.photo;
    if (!baseUrl) return null;
    if (page.crop?.xStart !== undefined && page.crop?.xEnd !== undefined) {
      return `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60&cx=${page.crop.xStart}&cw=${page.crop.xEnd}`;
    }
    return page.thumbnail || `/api/image?url=${encodeURIComponent(baseUrl)}&w=150&q=60`;
  };

  const imageUrl = getImageUrl();

  // Use Intersection Observer for images beyond the first 10
  useEffect(() => {
    if (shouldLoad || !imgRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' } // Start loading 200px before visible
    );

    observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <Link
      href={`/book/${bookId}/page/${page.id}`}
      className="group relative"
    >
      <div
        ref={imgRef}
        className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
      >
        {/* Shimmer placeholder - shows until image loads */}
        {!imageLoaded && !imageError && imageUrl && (
          <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer rounded-lg" />
        )}

        {imageUrl && !imageError && shouldLoad ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={`Page ${page.page_number}`}
            className={cn(
              'w-full h-full object-cover group-hover:scale-105 transition-transform duration-300',
              imageLoaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={handleImageLoad}
            onError={() => setImageError(true)}
          />
        ) : !shouldLoad ? (
          // Placeholder for images not yet triggered to load
          <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer rounded-lg" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stone-100">
            <span className="text-stone-400 text-sm">{page.page_number}</span>
          </div>
        )}

        {/* Status indicators */}
        <div className="absolute bottom-1 right-1 flex gap-0.5">
          {hasOcr && (
            <div className="w-2 h-2 rounded-full bg-blue-500" title="OCR complete" />
          )}
          {hasTranslation && (
            <div className="w-2 h-2 rounded-full bg-green-500" title="Translated" />
          )}
          {hasSummary && (
            <div className="w-2 h-2 rounded-full bg-purple-500" title="Summarized" />
          )}
        </div>

        {isComplete && (
          <div className="absolute top-1 right-1">
            <CheckCircle className="w-4 h-4 text-green-500 bg-white rounded-full" />
          </div>
        )}
      </div>
      <div className="text-center text-xs text-stone-500 mt-1">
        {page.page_number}
      </div>
    </Link>
  );
}
