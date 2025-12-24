'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Book as BookIcon } from 'lucide-react';
import type { Book } from '@/lib/types';
import { cn } from '@/lib/utils';
import { recordLoadingMetric } from '@/lib/analytics';

interface BookCardProps {
  book: Book;
  priority?: boolean; // For first few cards to load eagerly
}

export default function BookCard({ book, priority = false }: BookCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const loadStartTime = useRef<number | null>(null);

  useEffect(() => {
    loadStartTime.current = performance.now();
  }, []);

  const handleImageLoad = () => {
    if (loadStartTime.current !== null) {
      const loadTime = performance.now() - loadStartTime.current;
      recordLoadingMetric('book_card_image_load', loadTime, {
        bookId: book.id,
        priority
      });
    }
    setImageLoaded(true);
  };

  return (
    <Link href={`/book/${book.id}`} className="group">
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow duration-200">
        {/* Image area - shimmer until loaded */}
        <div className="aspect-[3/4] relative bg-stone-100 overflow-hidden">
          {/* Shimmer placeholder - only for images, shows until loaded */}
          {!imageLoaded && !imageError && book.thumbnail && (
            <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
          )}

          {book.thumbnail && !imageError ? (
            <Image
              src={book.thumbnail}
              alt={book.title}
              fill
              className={cn(
                'object-cover group-hover:scale-105 transition-transform duration-300',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
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
        </div>

        {/* Text content - visible immediately, no shimmer */}
        <div className="p-4">
          <h3 className="font-serif font-semibold text-stone-900 line-clamp-2 group-hover:text-amber-700 transition-colors">
            {book.display_title || book.title}
          </h3>
          <p className="text-sm text-stone-600 mt-1">{book.author}</p>
          <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
            <span className="px-2 py-0.5 bg-stone-100 rounded">{book.language}</span>
            {book.published && <span>{book.published}</span>}
            {book.pages_count !== undefined && (
              <span>{book.pages_count} pages</span>
            )}
          </div>

          {/* Translation Progress */}
          {book.pages_count !== undefined && book.pages_count > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className={book.translation_percent === 100 ? 'text-green-600 font-medium' : 'text-stone-500'}>
                  {book.translation_percent === 100 ? 'Translated' : `${book.translation_percent || 0}% translated`}
                </span>
                {book.pages_translated !== undefined && book.translation_percent !== 100 && (
                  <span className="text-stone-400">{book.pages_translated}/{book.pages_count}</span>
                )}
              </div>
              <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    book.translation_percent === 100
                      ? 'bg-green-500'
                      : book.translation_percent && book.translation_percent > 0
                        ? 'bg-amber-500'
                        : 'bg-stone-200'
                  }`}
                  style={{ width: `${book.translation_percent || 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
