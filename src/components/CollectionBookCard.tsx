'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Calendar, FileText } from 'lucide-react';
import { cn, getBookThumbnailUrl } from '@/lib/utils';
import { firstTranslationBadge } from '@/lib/first-translation-labels';
import AuthorName from '@/components/AuthorName';
import { useEmbedHref } from '@/lib/EmbedContext';

interface CollectionBook {
  bookId: string;
  id?: string;
  slug?: string;
  title: string;
  display_title?: string | null;
  author: string;
  year: number;
  pages?: number;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  thumbnail?: string;
  thumbnail_blob?: string;
  language?: string;
  has_doi?: boolean;
  is_first_translation?: boolean;
  ft_disposition?: string;
  published?: string;
  translation_percent?: number;
  resource_type?: string;
}

interface CollectionBookCardProps {
  book: CollectionBook;
  priority?: boolean;
  /** Optional URL prefix (e.g. '/bph') — prepended to the /book/{slug} path */
  bookUrlPrefix?: string;
}

export default function CollectionBookCard({ book, priority = false, bookUrlPrefix }: CollectionBookCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const embedHref = useEmbedHref();

  const isArtwork = !!book.resource_type;
  const pageCount = book.pages_count || book.pages || 0;
  const primaryUrl = getBookThumbnailUrl(book, 'display');
  const fallbackUrl = getBookThumbnailUrl(book, 'thumb');
  const thumbnailUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl;
  const slug = book.slug || book.id || book.bookId;

  const bookHref = embedHref(`${bookUrlPrefix || ''}/book/${book.slug || book.id || book.bookId}`);
  const artworkHref = embedHref(`${bookUrlPrefix || ''}/artwork/${slug}`);

  return (
    <Link
      href={isArtwork ? artworkHref : bookHref}
      className="group block"
    >
      <div className="h-full rounded-xl border border-border-light hover:border-accent-rust/40 hover:shadow-lg transition-[border-color,box-shadow] overflow-hidden bg-white">
        {/* Book Poster with Shimmer Loading */}
        <div className="relative aspect-[3/4] bg-warm overflow-hidden">
          {/* Shimmer placeholder - only for images, shows until loaded */}
          {!imageLoaded && !imageError && thumbnailUrl && (
            <div className="absolute inset-0 bg-gradient-to-r from-border-light via-warm to-border-light bg-[length:200%_100%] animate-shimmer" />
          )}

          {thumbnailUrl && !imageError ? (
            <Image
              src={thumbnailUrl}
              alt={book.display_title || book.title}
              fill
              quality={85}
              className={cn(
                'object-cover group-hover:scale-105 transition-transform duration-300',
                priority ? 'opacity-100' : (imageLoaded ? 'opacity-100' : 'opacity-0')
              )}
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
              onLoad={() => setImageLoaded(true)}
              onError={() => {
                if (!useFallback && fallbackUrl) {
                  setUseFallback(true);
                } else {
                  setImageError(true);
                }
              }}
              priority={priority}
              loading={priority ? 'eager' : 'lazy'}
              placeholder="blur"
              blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMyIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIzIiBoZWlnaHQ9IjQiIGZpbGw9IiNlN2UyZGUiLz48L3N2Zz4="
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
                  {firstTranslationBadge(book.ft_disposition, book.language)}
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
            {book.display_title || book.title}
          </h3>
          <p className="text-sm text-secondary mb-3 line-clamp-1"><AuthorName author={book.author} /></p>

          <div className="flex flex-wrap gap-2 text-xs text-muted">
            {(() => {
              const chips: React.ReactNode[] = [];
              if (book.year > 0) {
                chips.push(
                  <span key="year" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {book.year}
                  </span>
                );
              } else if (book.published) {
                chips.push(
                  <span key="year" className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {book.published}
                  </span>
                );
              }
              if (isArtwork) {
                if (book.resource_type) {
                  chips.push(
                    <span key="type" className="capitalize">{book.resource_type.replace(/_/g, ' ')}</span>
                  );
                }
              } else {
                if (pageCount > 0) {
                  chips.push(
                    <span key="pages" className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {pageCount} pages
                    </span>
                  );
                }
                if (book.language) {
                  chips.push(<span key="lang">{book.language}</span>);
                }
              }
              return chips.flatMap((chip, i) => i === 0 ? [chip] : [<span key={`sep-${i}`}>•</span>, chip]);
            })()}
          </div>
        </div>
      </div>
    </Link>
  );
}
