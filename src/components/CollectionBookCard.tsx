'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, X } from 'lucide-react';
import { cn, getBookThumbnailUrl } from '@/lib/utils';
import { bookCoverResponsiveLoader } from '@/lib/book-cover-loader';
import { isPublishedFirstTranslation } from '@/lib/book';
import AuthorName from '@/components/AuthorName';
import BookCoverPlaceholder from '@/components/BookCoverPlaceholder';
import { getEffectiveByline } from '@/lib/byline';
import { useEmbed, useEmbedHref } from '@/lib/EmbedContext';
import PlaceholderCover from '@/components/book/PlaceholderCover';

export interface CollectionBook {
  bookId?: string;
  id?: string;
  slug?: string;
  title: string;
  display_title?: string | null;
  author?: string;
  /** Editor for edited volumes/anthologies — shown as "edited by X" when
   *  author is missing/"Unknown". See src/lib/byline.ts. */
  editor?: string | null;
  year?: number;
  pages?: number;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  /** Pages with a Spanish edition — shows the "Español" tag when > 0. */
  pages_translated_es?: number;
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

/** The card's few words of chrome, so a Spanish surface can render it in Spanish. */
export interface CollectionBookCardLabels {
  firstTranslation: string;
  pages: string;
  ocr: string;
  translated: string;
  editedBy: string;
  /** Tag shown when the book has a Spanish edition. */
  spanishEdition: string;
}

export const CARD_LABELS_EN: CollectionBookCardLabels = {
  firstTranslation: 'First Translation',
  pages: 'pages',
  ocr: 'OCR',
  translated: 'Translated',
  editedBy: 'edited by',
  spanishEdition: 'Español',
};

export const CARD_LABELS_ES: CollectionBookCardLabels = {
  firstTranslation: 'Primera traducción',
  pages: 'páginas',
  ocr: 'OCR',
  translated: 'Traducido',
  editedBy: 'editado por',
  spanishEdition: 'En español',
};

interface CollectionBookCardProps {
  book: CollectionBook;
  priority?: boolean;
  /** Optional URL prefix (e.g. '/bph') — prepended to the /book/{slug} path */
  bookUrlPrefix?: string;
  /** Full href override — e.g. straight into the reader (`/book/x/page-number/5?lang=es`). */
  href?: string;
  /** Chrome strings; defaults to English. */
  labels?: CollectionBookCardLabels;
}

function pctOf(n?: number, d?: number): number {
  if (!d || !n || n <= 0) return 0;
  return Math.min(100, Math.round((n / d) * 100));
}

// One status item: tick at 100%, cross at 0%, else the percentage. (book design.md)
function Status({ label, pctValue, doneClass }: { label: string; pctValue: number; doneClass: string }) {
  if (pctValue >= 100) return <span className={`inline-flex items-center gap-1 ${doneClass}`}><Check className="w-3 h-3" /> {label}</span>;
  if (pctValue <= 0) return <span className="inline-flex items-center gap-1 text-muted"><X className="w-3 h-3" /> {label}</span>;
  return <span className="text-muted">{pctValue}% {label}</span>;
}

/**
 * The single book-cover card used site-wide (catalogue, browse, collections,
 * languages, timeline, libraries, search, home). Per book design.md: square
 * corners, hairline border, 3:4 cover, dark-glass "First Translation" tag,
 * language pill · year · pages, and a single OCR/Translated status line (books
 * only). Keeps the robust data handling: artwork, embed placeholders, DOI.
 */
export default function CollectionBookCard({ book, priority = false, bookUrlPrefix, href, labels = CARD_LABELS_EN }: CollectionBookCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const embedHref = useEmbedHref();
  const embed = useEmbed();

  const isArtwork = !!book.resource_type;
  const pageCount = book.pages_count || book.pages || 0;
  const primaryUrl = getBookThumbnailUrl(book, 'display');
  const fallbackUrl = getBookThumbnailUrl(book, 'thumb');
  const thumbnailUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl;
  const slug = book.slug || book.id || book.bookId || '';

  const bookHref = embedHref(`${bookUrlPrefix || ''}/book/${encodeURIComponent(slug)}`);
  const artworkHref = embedHref(`${bookUrlPrefix || ''}/artwork/${encodeURIComponent(slug)}`);

  const ocrPct = pctOf(book.pages_ocr, pageCount);
  const translatedPct = pctOf(book.pages_translated, pageCount);
  const byline = getEffectiveByline({ ...book, author: book.author || '' });

  return (
    <Link
      href={href ?? (isArtwork ? artworkHref : bookHref)}
      className="group flex flex-col h-full border border-border-light bg-white hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow] animate-fade-in-up"
    >
      {/* Cover */}
      <div className="relative aspect-[3/4] bg-warm overflow-hidden">
        {!imageLoaded && !imageError && thumbnailUrl && (
          <div className="absolute inset-0 bg-gradient-to-r from-border-light via-warm to-border-light bg-[length:200%_100%] animate-shimmer" />
        )}

        {thumbnailUrl && !imageError ? (
          <Image
            src={thumbnailUrl}
            loader={bookCoverResponsiveLoader}
            alt={book.display_title || book.title}
            fill
            quality={85}
            className={cn(
              'object-cover group-hover:scale-105 transition-transform duration-300',
              priority ? 'opacity-100' : (imageLoaded ? 'opacity-100' : 'opacity-0'),
            )}
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 20vw"
            onLoad={() => setImageLoaded(true)}
            onError={() => {
              if (!useFallback && fallbackUrl) setUseFallback(true);
              else setImageError(true);
            }}
            priority={priority}
            loading={priority ? 'eager' : 'lazy'}
            placeholder="blur"
            blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMyIgaGVpZ2h0PSI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIzIiBoZWlnaHQ9IjQiIGZpbGw9IiNlN2UyZGUiLz48L3N2Zz4="
          />
        ) : embed && !isArtwork ? (
          <PlaceholderCover
            title={book.display_title || book.title}
            author={book.author}
            year={(book.year ?? 0) > 0 ? book.year : book.published}
          />
        ) : (
          <BookCoverPlaceholder
            title={book.display_title || book.title}
            author={isArtwork ? undefined : book.author}
          />
        )}

        {/* Tags — dark-glass First Translation (+ DOI), square per book design.md */}
        {(isPublishedFirstTranslation(book) || book.has_doi || (book.pages_translated_es ?? 0) > 0) && (
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1.5 items-end">
            {(book.pages_translated_es ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(20,16,12,0.5)' }} lang="es">
                {labels.spanishEdition}
              </span>
            )}
            {isPublishedFirstTranslation(book) && (
              <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(20,16,12,0.5)' }}>
                {labels.firstTranslation}
              </span>
            )}
            {book.has_doi && (
              <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(37,99,235,0.85)' }}>
                DOI
              </span>
            )}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-3">
        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug" style={{ fontFamily: 'var(--font-body)' }}>
          {book.display_title || book.title}
        </h3>
        <p className="text-xs text-muted mt-0.5 line-clamp-1">
          {byline.role === 'editor' ? <>{labels.editedBy} <AuthorName author={byline.editor} /></> : (book.author ? <AuthorName author={book.author} /> : null)}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted">
          {book.language && <span className="bg-warm px-1.5 py-0.5 text-secondary">{book.language}</span>}
          {(book.year ?? 0) > 0 ? <span>{book.year}</span> : (book.published ? <span>{book.published}</span> : null)}
          {isArtwork
            ? (book.resource_type ? <span className="capitalize">{book.resource_type.replace(/_/g, ' ')}</span> : null)
            : (pageCount > 0 ? <span>{pageCount.toLocaleString('en-US')} {labels.pages}</span> : null)}
        </div>

        {!isArtwork && pageCount > 0 && (
          <div className="flex items-center gap-3 mt-auto pt-3 text-[11px]">
            <Status label={labels.ocr} pctValue={ocrPct} doneClass="text-status-info" />
            <Status label={labels.translated} pctValue={translatedPct} doneClass="text-status-success" />
          </div>
        )}
      </div>
    </Link>
  );
}
