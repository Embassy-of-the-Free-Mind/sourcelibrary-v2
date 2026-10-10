'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, Heart, X } from 'lucide-react';
import { cn, getBookThumbnailUrl, getBookCardUrl } from '@/lib/utils';
import { bookCoverResponsiveLoader } from '@/lib/book-cover-loader';
import { isPublishedFirstTranslation } from '@/lib/book';
import AuthorName from '@/components/AuthorName';
import BookCoverPlaceholder from '@/components/BookCoverPlaceholder';
import FramedImg from '@/components/FramedImg';
import { coverFrame } from '@/lib/framed-image';
import { getEffectiveByline } from '@/lib/byline';
import { useEmbed, useEmbedHref } from '@/lib/EmbedContext';
import PlaceholderCover from '@/components/book/PlaceholderCover';
import { useLocale, useLocalePath, type Locale } from '@/lib/i18n';
import { languageName } from '@/lib/book-i18n';
import { localizedTitle, originalTitleIfDifferent, type LocalizedBookMap, hasLocalizedEdition } from '@/lib/localized';
import { languageToBcp47, titleLang } from '@/lib/language-code';
import { translationPercent, translationVerdict, type StoredTranslationState } from '@/lib/translation-completeness';
import PreviewBadge from '@/components/book/PreviewBadge';

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
  /** Translation denominator inputs — see src/lib/translation-completeness.ts. */
  pages_translatable?: number | null;
  pages_blank?: number | null;
  /** The stamped translation rung (#5287). Absent = unstamped: the card falls back to the percentage. */
  translation_state?: StoredTranslationState | null;
  /** Per-language title glosses — see src/lib/localized.ts. */
  localized?: LocalizedBookMap | null;
  thumbnail?: string;
  thumbnail_blob?: string;
  /** Canonical cover fields. `image_card` is the 500px AVIF variant; it is only
   *  used when it names the same page as `image_display` (see getBookCardUrl),
   *  so BOTH must be projected by any query feeding this card or the book
   *  silently falls back to the 2000px scan. */
  image_display?: string | null;
  image_card?: string | null;
  /** Where the page sits inside the cover scan (#6010). Applied only while it
   *  names the cover being drawn; a feed that does not project it changes nothing. */
  thumbnail_frame?: unknown;
  language?: string;
  has_doi?: boolean;
  is_first_translation?: boolean;
  ft_disposition?: string;
  published?: string;
  translation_percent?: number;
  resource_type?: string;
  /** True when this is a partial scan / preview of a larger work — shows the
   *  "Preview" badge on the cover. Mirrors `books.preview`. */
  preview?: boolean;
  /** Readers' hearts. Only a surface that ranks by likes sets it; the card
   *  then shows a ♥ count on the cover. Absent everywhere else. */
  like_count?: number;
}

/** The card's few words of chrome, so a Spanish surface can render it in Spanish. */
export interface CollectionBookCardLabels {
  firstTranslation: string;
  pages: string;
  ocr: string;
  translated: string;
  /** Rung `complete` (#5287): every translatable page is translated. */
  complete: string;
  /** An English original, readable as printed (no translation needed). */
  inEnglish: string;
  editedBy: string;
  /** Tag shown when the book has a Spanish edition. */
}

export const CARD_LABELS_EN: CollectionBookCardLabels = {
  firstTranslation: 'First Translation',
  pages: 'pages',
  ocr: 'OCR',
  translated: 'Translated',
  complete: 'Complete',
  inEnglish: 'In English',
  editedBy: 'edited by',
};

export const CARD_LABELS_ES: CollectionBookCardLabels = {
  firstTranslation: 'Primera traducción',
  pages: 'páginas',
  ocr: 'OCR',
  translated: 'Traducido',
  complete: 'Completo',
  inEnglish: 'En inglés',
  editedBy: 'editado por',
};

// Latin (#6254). "Conversus" is the ENGLISH translation; nothing is translated into Latin.
export const CARD_LABELS_LA: CollectionBookCardLabels = {
  firstTranslation: 'Prima conversio',
  pages: 'paginae',
  ocr: 'OCR',
  translated: 'Conversus',
  complete: 'Absolutus',
  inEnglish: 'Anglice',
  editedBy: 'edidit',
};

export const CARD_LABELS_NL: CollectionBookCardLabels = {
  firstTranslation: 'Eerste vertaling',
  pages: 'pagina’s',
  ocr: 'OCR',
  translated: 'Vertaald',
  complete: 'Volledig',
  inEnglish: 'Engelstalig',
  editedBy: 'bezorgd door',
};

export const CARD_LABELS_ZH: CollectionBookCardLabels = {
  firstTranslation: '首次译出',
  pages: '页',
  ocr: 'OCR',
  translated: '已译',
  complete: '全译',
  inEnglish: '英文原著',
  editedBy: '编者',
};

const CARD_LABELS: Record<Locale, CollectionBookCardLabels> = { en: CARD_LABELS_EN, es: CARD_LABELS_ES, la: CARD_LABELS_LA, nl: CARD_LABELS_NL, zh: CARD_LABELS_ZH };

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
}

function pctOf(n?: number, d?: number): number {
  if (!d || !n || n <= 0) return 0;
  return Math.min(100, Math.round((n / d) * 100));
}

// One status item: tick at 100%, cross at 0%, else the percentage. (book design.md)
// `done` overrides the percentage when the stamped rung has already decided.
function Status({ label, pctValue, doneClass, done }: { label: string; pctValue: number; doneClass: string; done?: boolean }) {
  if (done === true || (done === undefined && pctValue >= 100)) return <span className={`inline-flex items-center gap-1 ${doneClass}`}><Check className="w-3 h-3" /> {label}</span>;
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
export default function CollectionBookCard({ book, priority = false, bookUrlPrefix, href, lang = 'en' }: CollectionBookCardProps) {
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
  // The 500px AVIF card variant when this book has a live, non-stale one
  // (~43 KB); otherwise the 2000px display scan exactly as before (~750 KB).
  // getBookCardUrl returns null unless `image_card` is set AND names the same
  // page as `image_display`, so a cover changed since the backfill falls back
  // here rather than rendering the previous cover. See src/lib/utils.ts.
  const cardUrl = getBookCardUrl(book);
  const displayUrl = getBookThumbnailUrl(book, 'display');
  const primaryUrl = cardUrl || displayUrl;
  // What to try if the primary fails to load. When the primary IS the card, the
  // right retry is the full-size scan, not the 150px thumb — a browser too old
  // to decode AVIF (~4%) should get the correct cover, not a blurry one. Only
  // once that also fails do we drop to the thumb, which is the pre-existing
  // behaviour for every non-card book.
  const fallbackUrl = (cardUrl && displayUrl) || getBookThumbnailUrl(book, 'thumb');
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
  // The one translation formula (#4505): blank leaves are skipped on both sides, so a
  // book whose every readable page is translated gets its tick. Falls back to
  // pages_count when the surface did not project pages_translatable / pages_blank.
  const translatedPct = translationPercent({
    pages_count: pageCount,
    pages_translated: book.pages_translated,
    pages_translatable: book.pages_translatable,
    pages_blank: book.pages_blank,
  });
  const verdict = translationVerdict(book);
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
          <FramedImg
            as={Image}
            frame={coverFrame(book, thumbnailUrl)}
            src={thumbnailUrl}
            loader={bookCoverResponsiveLoader}
            alt={shownTitle}
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
        {(book.like_count ?? 0) > 0 && (
          <span
            className="absolute top-2 left-2 z-10 inline-flex items-center gap-1 text-[11px] font-medium text-white px-2 py-1 backdrop-blur-sm"
            style={{ background: 'rgba(20,16,12,0.5)' }}
            aria-label={`${book.like_count} ${book.like_count === 1 ? 'like' : 'likes'}`}
          >
            <Heart className="w-3 h-3 fill-current" aria-hidden /> {book.like_count!.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US')}
          </span>
        )}

        {(isPublishedFirstTranslation(book) || book.has_doi || book.preview) && (
          <div className="absolute top-2 right-2 z-10 flex flex-col gap-1.5 items-end">
            {book.preview && (
              <span className="text-[10px] font-medium text-white px-2 py-1 backdrop-blur-sm" style={{ background: 'rgba(120,90,30,0.72)' }}>
                <PreviewBadge lang={lang} />
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
        {/* `lang` only when the ORIGINAL title is what's shown — display_title
            is usually an English rendering, and the surface language is
            already on an ancestor. Assistive tech picks its voice from this. */}
        <h3 className="text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug" style={{ fontFamily: 'var(--font-body)' }} lang={titleLang(shownTitle, book)}>
          {shownTitle}
        </h3>
        {originalLine && (
          <p className="text-[11px] text-muted italic mt-0.5 line-clamp-1" lang={languageToBcp47(book.language)}>{originalLine}</p>
        )}
        <p className="text-xs text-muted mt-0.5 line-clamp-1">
          {byline.role === 'editor' ? <>{labels.editedBy} <AuthorName author={byline.editor} /></> : (book.author ? <AuthorName author={book.author} /> : null)}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted">
          {book.language && <span className="bg-warm px-1.5 py-0.5 text-secondary">{languageName(book.language, lang)}</span>}
          {(book.year ?? 0) > 0 ? <span>{book.year}</span> : (book.published ? <span>{book.published}</span> : null)}
          {isArtwork
            ? (book.resource_type ? <span className="capitalize">{book.resource_type.replace(/_/g, ' ')}</span> : null)
            : (pageCount > 0 ? <span>{pageCount.toLocaleString('en-US')} {labels.pages}</span> : null)}
        </div>

        {!isArtwork && pageCount > 0 && (
          <div className="flex items-center gap-3 mt-auto pt-3 text-[11px]">
            <Status label={labels.ocr} pctValue={ocrPct} doneClass="text-status-info" />
            {/* The stamped rung decides the verdict (#5287): "Translated" from
                `readable`, "Complete" only at `complete`, "In English" for a
                transcribed English original; below that, the percentage.
                Unstamped (verdict null) falls back to tick-at-100%. */}
            <Status
              label={verdict === 'complete' ? labels.complete : verdict === 'english_original' ? labels.inEnglish : labels.translated}
              pctValue={translatedPct}
              doneClass="text-status-success"
              done={verdict === null ? undefined : verdict !== 'none'}
            />
          </div>
        )}
      </div>
    </Link>
  );
}
