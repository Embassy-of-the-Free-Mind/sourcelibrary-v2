'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Calendar, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollectionBook {
  bookId: string;
  id?: string;
  slug?: string;
  title: string;
  author: string;
  year: number;
  pages?: number;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  thumbnail?: string;
  language?: string;
  has_doi?: boolean;
  is_first_translation?: boolean;
  published?: string;
  translation_percent?: number;
}

interface CollectionBookCardProps {
  book: CollectionBook;
  priority?: boolean;
}

export default function CollectionBookCard({ book, priority = false }: CollectionBookCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const pageCount = book.pages_count || book.pages || 0;

  return (
    <Link
      href={`/book/${book.slug || book.id || book.bookId}`}
      className="group block"
    >
      <div className="h-full rounded-xl border border-border-light hover:border-accent-rust/40 hover:shadow-lg transition-[border-color,box-shadow] overflow-hidden bg-white">
        {/* Book Poster with Shimmer Loading */}
        <div className="relative aspect-[3/4] bg-warm overflow-hidden">
          {/* Shimmer placeholder - only for images, shows until loaded */}
          {!imageLoaded && !imageError && book.thumbnail && (
            <div className="absolute inset-0 bg-gradient-to-r from-border-light via-warm to-border-light bg-[length:200%_100%] animate-shimmer" />
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
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              priority={priority}
              loading={priority ? 'eager' : 'lazy'}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <BookOpen className="w-16 h-16 text-muted" />
            </div>
          )}

          {/* Status badges */}
          {(book.is_first_translation || book.has_doi) && (
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 items-end">
              {book.is_first_translation && (
                <div className="bg-accent-gold text-white text-xs px-2 py-1 rounded-full shadow-lg font-medium">
                  First Translation
                </div>
              )}
              {book.has_doi && (
                <div className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full shadow-lg font-medium">
                  DOI
                </div>
              )}
            </div>
          )}
        </div>

        {/* Book Info */}
        <div className="p-4">
          <h3
            className="text-base font-bold text-primary group-hover:text-accent-rust transition-colors mb-2 leading-tight line-clamp-2"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {book.title}
          </h3>
          <p className="text-sm text-secondary mb-3 line-clamp-1">{book.author}</p>

          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {book.year}
            </span>
            {pageCount > 0 && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  {pageCount} pages
                </span>
              </>
            )}
            {book.language && (
              <>
                <span>•</span>
                <span>{book.language}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
