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
import { useLocale, useLocalePath, type Locale } from '@/lib/i18n';
import { localizedTitle, originalTitleIfDifferent, type LocalizedBookMap, hasLocalizedEdition } from '@/lib/localized';

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
  pages_translated_es?: number;
  /** Per-language title glosses — see src/lib/localized.ts. */
  localized?: LocalizedBookMap | null;
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
  /** Singular form. A one-page broadside read "1 pages" on every surface. */
  page: string;
  ocr: string;
  translated: string;
  editedBy: string;
  /** Tag shown when the book has a Spanish edition. */
}

export const CARD_LABELS_EN: CollectionBookCardLabels = {
  firstTranslation: 'First Translation',
  pages: 'pages',
  page: 'page',
  ocr: 'OCR',
  translated: 'Translated',
  editedBy: 'edited by',
};

export const CARD_LABELS_ES: CollectionBookCardLabels = {
  firstTranslation: 'Primera traducción',
  pages: 'páginas',
  page: 'página',
  ocr: 'OCR',
  translated: 'Traducido',
  editedBy: 'editado por',
};

const CARD_LABELS: Record<Locale, CollectionBookCardLabels> = { en: CARD_LABELS_EN, es: CARD_LABELS_ES };

interface CollectionBookCardProps {
  book: CollectionBook;
  priority?: boolean;
  /** Optional URL prefix (e.g. '/bph') — prepended to the /book/{slug} path */
  bookUrlPrefix?: string;
  /** Full href override — e.g. straight into the reader (`/book/x/page-number/5?lang=es`). */
  href?: string;
  /**
   * Surface language. Picks the chrome strings AND the title shown: the
   * language's gloss (books.localized[lang].title) with the original title
   * beneath, or the original alone when no gloss exists yet. Default English.
   */
  lang?: Locale;
  /**
   * `catalog` is the /catalog grid's card: the same data and the same claim
   * gates, restyled. The status line drops to micro type and carries the
   * first-translation claim inline beside it, instead of a tag over the cover;
   * the hover lifts the whole card rather than recolouring the title. Every
   * other surface keeps `default`, which is the card described in
   * `.claude/docs/collection-book-card-design.md`.
   */
  variant?: 'default' | 'catalog';
}

function pctOf(n?: number, d?: number): number {
  if (!d || !n || n <= 0) return 0;
  return Math.min(100, Math.round((n / d) * 100));
}

// One status item: tick at 100%, cross at 0%, else the percentage. (book design.md)
function Status({ label, pctValue, doneClass, micro = false }: { label: string; pctValue: number; doneClass: string; micro?: boolean }) {
  const icon = micro ? 'w-2.5 h-2.5' : 'w-3 h-3';
  if (pctValue >= 100) return <span className={`inline-flex items-center gap-1 ${doneClass}`}><Check className={icon} /> {label}</span>;
  if (pctValue <= 0) return <span className="inline-flex items-center gap-1 text-muted"><X className={icon} /> {label}</span>;
  return <span className="text-muted">{pctValue}% {label}</span>;
}

/**
 * The single book-cover card used site-wide (catalogue, browse, collections,
 * languages, timeline, libraries, search, home). Per book design.md: square
 * corners, hairline border, 3:4 cover, dark-glass "First Translation" tag,
 * language pill · year · pages, and a single OCR/Translated status line (books
 * only). Keeps the robust data handling: artwork, embed placeholders, DOI.
 */
export default function CollectionBookCard({ book, priority = false, bookUrlPrefix, href, lang = 'en', variant = 'default' }: CollectionBookCardProps) {
  const isCatalog = variant === 'catalog';
  const labels = CARD_LABELS[lang];
  const shownTitle = localizedTitle(book, lang);
  const originalLine = lang === 'en' ? null : originalTitleIfDifferent(book, lang);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [useFallback, setUseFallback] = useState(false);
  const embedHref = useEmbedHref();
  const embed = useEmbed();
  // A card on a localized surface links to that surface's twin — /es/collections/…
  // → /es/book/… — so the prefix never drops on a click. But only for a book
  // that HAS an edition in that language: an /es URL is a promise the page is
  // in Spanish, and a book without one has no Spanish page to point at.
  // localePath is registry-guarded on top of that, so /artwork/… is untouched.
  const localePath = useLocalePath();
  const urlLocale = useLocale();

  const isArtwork = !!book.resource_type;
  const pageCount = book.pages_count || book.pages || 0;
  const primaryUrl = getBookThumbnailUrl(book, 'display');
  const fallbackUrl = getBookThumbnailUrl(book, 'thumb');
  const thumbnailUrl = useFallback && fallbackUrl ? fallbackUrl : primaryUrl;
  const slug = book.slug || book.id || book.bookId || '';

  // "Does this book exist in the surface language?" — asked through the shared
  // helper, never by reading a counter here. A book WRITTEN in Spanish is a
  // Spanish edition with no translated pages at all (#4120), so the old
  // `pages_translated_es > 0` test sent Cogolludo, Landa and Scherzer from an
  // /es grid straight to their ENGLISH page. `hasLocalizedEdition` returns null
  // when `language` was not projected and it genuinely cannot tell; treat that
  // as "no" so an /es URL is never a promise we can't keep.
  // Asked against the URL's locale, not the `lang` PROP: `localePath` prefixes
  // with whatever the URL says, so testing the prop would let a card that was
  // rendered without `lang` on an /es page prefix every book — including ones
  // with no Spanish page at all. Both sides of the guard read the same locale.
  const hasLocalizedTwin = hasLocalizedEdition(book as unknown as Record<string, unknown>, urlLocale) === true;
  const localized = (href: string) => (hasLocalizedTwin ? localePath(href) : href);
  const bookHref = localized(embedHref(`${bookUrlPrefix || ''}/book/${encodeURIComponent(slug)}`));
  const artworkHref = embedHref(`${bookUrlPrefix || ''}/artwork/${encodeURIComponent(slug)}`);

  const ocrPct = pctOf(book.pages_ocr, pageCount);
  const translatedPct = pctOf(book.pages_translated, pageCount);
  const byline = getEffectiveByline({ ...book, author: book.author || '' });

  return (
    <Link
      href={href ?? (isArtwork ? artworkHref : bookHref)}
      className={cn(
        'group flex flex-col h-full border bg-white',
        isCatalog
          /* The lift lives on the root, so `animate-fade-in-up` (which ends on a
             transform and would out-rank a hover one under its `forwards` fill)
             is swapped for a plain opacity fade. */
          ? 'border-border-light hover:border-border-medium hover:-translate-y-[3px] hover:shadow-[0_14px_28px_-18px_rgba(26,22,18,0.45)] transition-[transform,border-color,box-shadow] duration-300 ease-out animate-fade-in'
          : 'border-border-light hover:border-accent-rust/40 hover:shadow-md transition-[border-color,box-shadow] animate-fade-in-up',
      )}
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
            alt={shownTitle}
            fill
            quality={85}
            className={cn(
              'object-cover transition-transform',
              /* Slower and shallower than the default card's: on a 60-card grid
                 a fast 5% jump reads as a twitch, not a response. */
              isCatalog ? 'group-hover:scale-[1.035] duration-[600ms] ease-out' : 'group-hover:scale-105 duration-300',
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
            title={shownTitle}
            author={book.author}
            year={(book.year ?? 0) > 0 ? book.year : book.published}
          />
        ) : (
          <BookCoverPlaceholder
            title={shownTitle}
            author={isArtwork ? undefined : book.author}
          />
        )}

        {/* Tags — dark-glass First Translation (+ DOI), square per book design.md
        
            No "Español" tag. A tag on a cover has to earn its place against
            the one that matters, and this one said nothing to either reader:
            on the English site it announces an edition you are not looking
            at, and on /es the page already sorts into "in Spanish" and
            "not yet", so the heading above the grid has said it. Stacked over
            First Translation it read as the more important of the two. */}
        {isCatalog && (
          /* A whisper of shade rising off the foot of the cover on hover — it
             seats the card against the page without moving anything. */
          <div
            className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
            style={{ background: 'linear-gradient(180deg, rgba(20,16,12,0) 55%, rgba(20,16,12,0.22) 100%)' }}
          />
        )}

        {/* The catalogue card moves the First Translation claim down to the
            status line — same gate, same words, read where the reader is
            already comparing OCR and Translated rather than stamped over the
            scan. The DOI tag stays: it is about the record, not the text. */}
        {((isPublishedFirstTranslation(book) && !isCatalog) || book.has_doi) && (
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1.5 items-end">
            {isPublishedFirstTranslation(book) && !isCatalog && (
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
        <h3
          className={cn(
            'text-sm font-semibold text-primary line-clamp-2 leading-snug transition-colors',
            /* No recolour on hover here: the lift already says the card is
               live, and a title that turns red on a page of 60 titles is the
               loudest thing in the grid. */
            isCatalog ? 'decoration-border-medium underline-offset-[3px] group-hover:underline' : 'group-hover:text-accent-rust',
          )}
          style={{ fontFamily: 'var(--font-body)' }}
        >
          {shownTitle}
        </h3>
        {originalLine && (
          <p className="text-[11px] text-muted italic mt-0.5 line-clamp-1">{originalLine}</p>
        )}
        <p className="text-xs text-muted mt-0.5 line-clamp-1">
          {byline.role === 'editor' ? <>{labels.editedBy} <AuthorName author={byline.editor} /></> : (book.author ? <AuthorName author={book.author} /> : null)}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted">
          {book.language && <span className="bg-warm px-1.5 py-0.5 text-secondary">{book.language}</span>}
          {(book.year ?? 0) > 0 ? <span>{book.year}</span> : (book.published ? <span>{book.published}</span> : null)}
          {isArtwork
            ? (book.resource_type ? <span className="capitalize">{book.resource_type.replace(/_/g, ' ')}</span> : null)
            : (pageCount > 0 ? <span>{pageCount.toLocaleString('en-US')} {pageCount === 1 ? labels.page : labels.pages}</span> : null)}
        </div>

        {!isArtwork && pageCount > 0 && (
          isCatalog ? (
            /* Micro type, and tight enough that OCR, Translated and the
               first-translation claim sit on ONE line at desktop card width.
               Below that they wrap, in that order of importance. */
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-auto pt-3 text-[9px] font-medium uppercase tracking-[0.035em] [&>span]:whitespace-nowrap">
              <Status label={labels.ocr} pctValue={ocrPct} doneClass="text-status-info" micro />
              <Status label={labels.translated} pctValue={translatedPct} doneClass="text-status-success" micro />
              {isPublishedFirstTranslation(book) && (
                <span className="text-accent-gold-dark">{labels.firstTranslation}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 mt-auto pt-3 text-[11px]">
              <Status label={labels.ocr} pctValue={ocrPct} doneClass="text-status-info" />
              <Status label={labels.translated} pctValue={translatedPct} doneClass="text-status-success" />
            </div>
          )
        )}
      </div>
    </Link>
  );
}
