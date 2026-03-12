'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Book as BookIcon } from 'lucide-react';
import type { Book } from '@/lib/types';
import { recordLoadingMetric } from '@/lib/analytics';
import { bookUrl } from '@/lib/slugify';

interface BookCardProps {
  book: Book;
  priority?: boolean; // For first few cards to load eagerly
}

export default function BookCard({ book, priority = false }: BookCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showTooltip, setShowTooltip] = useState(false);
  const loadStartTime = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tooltipTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadStartTime.current = performance.now();
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeout.current) {
        clearTimeout(tooltipTimeout.current);
      }
    };
  }, []);

  // Prefer full-res thumbnail (archived_photo or IIIF) over 150px thumbnail_blob
  // Next.js Image optimization handles resizing, caching, and format conversion
  const thumbnailUrl = book.thumbnail || book.thumbnail_blob;

  // Determine image source type for analytics
  const getImageSource = (): 'blob' | 'ia' | 'local' | 'other' => {
    if (!thumbnailUrl) return 'other';
    if (thumbnailUrl.includes('blob.vercel-storage.com')) return 'blob';
    if (thumbnailUrl.includes('archive.org')) return 'ia';
    if (thumbnailUrl.startsWith('/api/')) return 'local';
    return 'other';
  };

  const handleImageLoad = () => {
    if (loadStartTime.current !== null) {
      const loadTime = performance.now() - loadStartTime.current;
      const source = getImageSource();
      recordLoadingMetric('book_card_image_load', loadTime, {
        bookId: book.id,
        priority,
        source, // 'blob' = Vercel Blob, 'ia' = Internet Archive, 'local' = API proxy, 'other' = unknown
        isArchived: source === 'blob'
      });
    }
    setImageLoaded(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  const handleMouseEnter = () => {
    // Show tooltip after 500ms delay
    tooltipTimeout.current = setTimeout(() => {
      setShowTooltip(true);
    }, 1000);
  };

  const handleMouseLeave = () => {
    // Clear timeout and hide tooltip
    if (tooltipTimeout.current) {
      clearTimeout(tooltipTimeout.current);
      tooltipTimeout.current = null;
    }
    setShowTooltip(false);
  };

  return (
    <Link href={bookUrl(book)} className="group relative">
      <div
        ref={cardRef}
        className="bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200 h-full flex flex-col"
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Hover Tooltip */}
        {showTooltip && (
          <div
            className="fixed px-4 py-2 bg-stone-900 text-white text-sm rounded-lg shadow-xl z-50 pointer-events-none min-w-[300px] max-w-[400px]"
            style={{
              left: `${mousePos.x + (cardRef.current?.getBoundingClientRect().left || 0) + 15}px`,
              top: `${mousePos.y + (cardRef.current?.getBoundingClientRect().top || 0) + 15}px`,
            }}
          >
            <div className="font-serif font-semibold">{book.display_title || book.title}</div>
            <div className="text-stone-300 text-xs mt-1">{book.author}</div>
          </div>
        )}

        {/* Image area - shimmer sits behind image, covered naturally as image loads */}
        <div className="aspect-[3/4] relative bg-stone-100 overflow-hidden flex-shrink-0">
          {/* Shimmer placeholder - always rendered behind image, hidden once loaded */}
          {!imageLoaded && !imageError && thumbnailUrl && (
            <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
          )}

          {thumbnailUrl && !imageError ? (
            <Image
              src={thumbnailUrl}
              alt={book.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              onLoad={handleImageLoad}
              onError={() => setImageError(true)}
              priority={priority}
              loading={priority ? 'eager' : 'lazy'}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <BookIcon className="w-16 h-16 text-stone-300" />
            </div>
          )}

          {book.is_first_translation && (
            <div className="absolute top-2 right-2 z-10">
              <div className="bg-accent-gold text-white text-[10px] px-1.5 py-0.5 rounded-full shadow font-medium">
                First Translation
              </div>
            </div>
          )}
        </div>

        {/* Text content - visible immediately, no shimmer */}
        <div className="p-4 flex-1 flex flex-col">
          <h3 className="font-serif font-semibold text-stone-900 line-clamp-2 group-hover:text-accent-rust transition-colors">
            {book.display_title || book.title}
          </h3>
          <p className="text-sm text-stone-600 mt-1 line-clamp-1">{book.author}</p>
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-2 text-xs text-stone-500">
            <span className="px-2 py-0.5 bg-stone-100 rounded">
              {book.language?.startsWith('Multiple') ? 'Multiple' : book.language}
            </span>
            {book.published && <span>{book.published}</span>}
            {book.pages_count !== undefined && (
              <span>{book.pages_count} pages</span>
            )}
          </div>

          {/* OCR & Translation Progress */}
          {book.pages_count !== undefined && book.pages_count > 0 && (
            <div className="mt-auto pt-3 space-y-2">
              {/* OCR Status */}
              {(() => {
                const ocrPercent = book.pages_count > 0
                  ? Math.round(((book.pages_ocr || 0) / book.pages_count) * 100)
                  : 0;
                return (
                  <div className="flex items-center justify-between text-xs">
                    <span className={ocrPercent === 100 ? 'text-blue-600 font-medium' : 'text-stone-500'}>
                      {ocrPercent === 100 ? '✓ OCR' : ocrPercent > 0 ? `${ocrPercent}% OCR` : 'No OCR'}
                    </span>
                    {ocrPercent > 0 && ocrPercent < 100 && (
                      <span className="text-stone-400">{book.pages_ocr}/{book.pages_count}</span>
                    )}
                  </div>
                );
              })()}

              {/* Translation Progress */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={(book.translation_percent ?? 0) >= 95 ? 'text-status-success font-medium' : 'text-stone-500'}>
                    {(book.translation_percent ?? 0) >= 95 ? '✓ Translated' : `${book.translation_percent || 0}% Translated`}
                  </span>
                  {book.pages_translated !== undefined && (book.translation_percent ?? 0) < 95 && (
                    <span className="text-stone-400">{book.pages_translated}/{book.pages_count}</span>
                  )}
                </div>
                <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${(book.translation_percent ?? 0) >= 95
                      ? 'bg-status-success'
                      : book.translation_percent && book.translation_percent > 0
                        ? 'bg-accent-gold/80'
                        : 'bg-stone-200'
                      }`}
                    style={{ width: `${Math.min(book.translation_percent || 0, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
