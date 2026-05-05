'use client';

/**
 * Shared library detail view component.
 * Used by both /libraries/[slug] and /[tenant] routes to render consistent library-detail UX.
 * Accepts data loaders as props to support both provider-based and tenant-based queries.
 */

import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ExternalLink, Images, Library } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';
import { bookTitle } from '@/lib/collections-utils';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';
import { getBookThumbnailUrl } from '@/lib/utils';
import { getEmbedUiPolicy } from '@/lib/embed-ui-policy';
import { useEmbed, useEmbedHref } from '@/lib/EmbedContext';

export const PER_PAGE = 60;

interface BookItem {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  photo?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
}

interface LibraryPartner {
  name: string;
  description: string;
  url: string;
  providerKey?: string;
  slug: string;
}

interface GalleryImage {
  pageId?: string;
  page_id?: string;
  detectionIndex?: number;
  detection_index?: number;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  extractedUrl?: string;
  extracted_url?: string;
  imageUrl?: string;
  image_url?: string;
  museumDescription?: string;
  museum_description?: string;
  description?: string;
  bookTitle?: string;
  book_title?: string;
  type?: string;
}

interface ContributingLibrary {
  name: string;
  count: number;
}

interface Language {
  lang: string;
  count: number;
}

export interface SharedLibraryViewProps {
  partner: LibraryPartner;
  books: BookItem[];
  total: number;
  topBooks: BookItem[];
  languages: Language[];
  galleryImages: GalleryImage[];
  contributingLibraries: ContributingLibrary[];
  basePath: string;
  sort: string;
  language: string;
  q?: string;
  offset: number;
  view: string;
  isBph: boolean;
  digitizedUbns?: Record<string, { id: string; slug: string }>;
  catalogTotal?: number;
  /** Optional tenant slug to pass to nested components */
  tenantSlug?: string | null;
  /** Force embed behavior from the server (used by /embed routes) */
  forceEmbedded?: boolean;
}

export default function SharedLibraryView({
  partner,
  books,
  total,
  topBooks,
  languages,
  galleryImages,
  contributingLibraries,
  basePath,
  sort,
  language: languageFilter,
  q,
  offset,
  view,
  isBph,
  digitizedUbns = {},
  catalogTotal = 0,
  tenantSlug,
  forceEmbedded = false,
}: SharedLibraryViewProps) {
  const embedFromContext = useEmbed();
  const embed = forceEmbedded || embedFromContext;
  const embedHref = useEmbedHref();
  const totalPages = Math.ceil(total / PER_PAGE);
  const currentPage = Math.floor(offset / PER_PAGE) + 1;
  const filteredLanguages = languages.filter(l => l.count > 2);
  const externalPartnerUrl = partner.url?.trim() || '';
  const hasExternalPartnerUrl = /^https?:\/\//i.test(externalPartnerUrl);
  const embedPolicy = getEmbedUiPolicy(embed);

  // BPH layout modes:
  //   view === 'books'   → full books grid only (digitized SL books)
  //   view === 'catalog' → catalog browser only (full 27,706-work catalog, no Selected Books)
  //   default            → Selected Books + Catalog combo (the main-site landing experience)
  const showBooksGrid = !isBph || view === 'books';
  const showSelectedBooksRow = isBph && view !== 'books' && view !== 'catalog';

  return (
    <div className="min-h-screen bg-cream">
      {!embed && <ConditionalSiteHeader variant="dark" />}
      {/* Hero Section */}
      <div className="relative bg-dark overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />

        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <h1
            className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display"
          >
            {partner.name}
          </h1>

          <p className="text-lg text-white/70 max-w-3xl leading-relaxed mb-4">
            {partner.description}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            <span>{total.toLocaleString()} translated books</span>
            {isBph && catalogTotal > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{catalogTotal.toLocaleString()} works in catalog</span>
              </>
            )}
            {languages.length > 0 && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <span>{languages.slice(0, 5).map(l => l.lang).join(', ')}</span>
              </>
            )}

            {hasExternalPartnerUrl && embedPolicy.showTenantHeroExternalLink && (
              <>
                <span className="w-px h-4 bg-white/20" />
                <a
                  href={externalPartnerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white/50 hover:text-white/80 transition-colors"
                >
                  {externalPartnerUrl.replace(/^https?:\/\//, '')}
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gallery Grid - hidden in embed mode */}
      {galleryImages.length > 0 && embedPolicy.showGalleryImages && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <h2
              className="text-xl sm:text-2xl text-primary mb-4 font-display"
            >
              Illustrations
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {galleryImages.slice(0, 11).map((img: GalleryImage) => {
                const thumb = img.thumbnailUrl || img.thumbnail_url || img.extractedUrl || img.extracted_url || img.imageUrl || img.image_url;
                const pageId = img.pageId || img.page_id;
                const detIdx = img.detectionIndex ?? img.detection_index;
                const galleryId = `${pageId}-${detIdx}`;
                return (
                  <Link
                    key={galleryId}
                    href={embedHref(`${basePath}/gallery/image/${galleryId}`)}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md"
                    title={img.museumDescription || img.museum_description || img.description || img.bookTitle || img.book_title}
                  >
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt={img.description || img.bookTitle || img.book_title || 'Illustration'}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(min-width: 1024px) 160px, (min-width: 640px) 140px, 120px"
                      />
                    ) : (
                      <div className="w-full h-full bg-cream flex items-center justify-center">
                        <Images className="w-6 h-6 text-muted" />
                      </div>
                    )}
                    {img.type && (
                      <span className="absolute bottom-1.5 left-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded capitalize leading-none">
                        {img.type}
                      </span>
                    )}
                  </Link>
                );
              })}
              <Link
                href={embedHref(`${basePath}/gallery`)}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream flex items-center justify-center"
              >
                <div className="text-center px-2">
                  <Images className="w-6 h-6 text-muted mx-auto mb-1.5 group-hover:text-accent-rust transition-colors" />
                  <span className="text-xs text-secondary group-hover:text-accent-rust transition-colors font-medium">
                    See all illustrations
                  </span>
                </div>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Contributing Libraries (for IA and similar aggregators — hide for BPH since it IS the library) */}
      {contributingLibraries.length > 0 && !isBph && (
        <div className="bg-warm border-b border-border-light">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="flex items-center gap-2 mb-4">
              <Library className="w-5 h-5 text-accent-rust" />
              <h2
                className="text-xl sm:text-2xl text-primary font-display"
              >
                Contributing Libraries
              </h2>
            </div>
            <p className="text-sm text-muted mb-4">
              These institutions provided the physical books digitized through {partner.name}.
            </p>
            <div className="flex flex-wrap gap-2">
              {contributingLibraries.map((lib) => (
                <span
                  key={lib.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-border-light rounded-full text-secondary"
                >
                  {lib.name}
                  <span className="text-xs text-muted">({lib.count})</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-6 py-10">
        {showBooksGrid ? (
          <>
            {/* All Books Header */}
            <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
              <div>
                <h2
                  className="text-2xl sm:text-3xl text-primary font-display"
                >
                  All Books
                </h2>
                <p className="text-sm text-muted mt-1">
                  {total.toLocaleString()} books from {partner.name}
                </p>
              </div>

              <CollectionFilters
                collectionId={partner.slug}
                languages={filteredLanguages}
                basePath={basePath}
                showSearch
              />
            </div>

            {/* Books Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {books.map((book, i) => (
                <CollectionBookCard
                  key={book.id}
                  book={{
                    bookId: book.id,
                    id: book.id,
                    slug: book.slug,
                    title: bookTitle(book),
                    author: book.author || '',
                    year: book.year || 0,
                    pages_count: book.pages_count,
                    pages_ocr: book.pages_ocr,
                    pages_translated: book.pages_translated,
                    thumbnail: getBookThumbnailUrl(book) || book.photo || undefined,
                    thumbnail_blob: book.thumbnail_blob,
                    language: book.language,
                    published: book.published,
                    translation_percent: book.pages_ocr && book.pages_translated
                      ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
                      : 0,
                  }}
                  priority={i < 10}
                  bookUrlPrefix={basePath !== '/' ? basePath : undefined}
                />
              ))}
            </div>

            {/* Empty state */}
            {books.length === 0 && (
              <div className="text-center py-16">
                <BookOpen className="w-12 h-12 text-muted mx-auto mb-4" />
                <p className="text-lg text-secondary">No books found matching your filters.</p>
                <Link
                  href={embedHref(basePath)}
                  className="text-sm text-accent-rust hover:underline mt-2 inline-block"
                >
                  Clear filters
                </Link>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-10 text-sm">
                {offset > 0 ? (
                  <Link
                    href={embedHref(`${basePath}?view=books&sort=${sort}${languageFilter ? `&language=${languageFilter}` : ''}&offset=${Math.max(0, offset - PER_PAGE)}`)}
                    className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                    Previous
                  </span>
                )}
                <span className="text-muted">
                  Page {currentPage} of {totalPages}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={embedHref(`${basePath}?view=books&sort=${sort}${languageFilter ? `&language=${languageFilter}` : ''}&offset=${offset + PER_PAGE}`)}
                    className="px-4 py-2 rounded-lg border border-border-light hover:bg-warm transition-colors"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="px-4 py-2 rounded-lg border border-border-light opacity-30">
                    Next
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          /* BPH: Catalog (with optional Selected Books on the default landing) */
          <div>
            {/* Selected Books row — hidden on the dedicated /catalog view */}
            {showSelectedBooksRow && topBooks.length > 0 && (
              <div className="mb-10">
                <h2 className="text-2xl sm:text-3xl text-primary font-display mb-1">
                  Selected Books
                </h2>
                <p className="text-sm text-muted mb-4">
                  {total.toLocaleString()} books from the BPH collection translated on Source Library.
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                  {topBooks.map((book, i) => (
                    <CollectionBookCard
                      key={book.id}
                      book={{
                        bookId: book.id,
                        id: book.id,
                        slug: book.slug,
                        title: bookTitle(book),
                        author: book.author || '',
                        year: book.year || 0,
                        pages_count: book.pages_count,
                        pages_ocr: book.pages_ocr,
                        pages_translated: book.pages_translated,
                        thumbnail: getBookThumbnailUrl(book) || book.photo || undefined,
                        thumbnail_blob: book.thumbnail_blob,
                        language: book.language,
                        published: book.published,
                        translation_percent: book.pages_ocr && book.pages_translated
                          ? Math.round((book.pages_translated / Math.max((book.pages_ocr || 0) - (book.pages_blank || 0), 1)) * 100)
                          : 0,
                      }}
                      priority={i < 5}
                      bookUrlPrefix={basePath !== '/' ? basePath : undefined}
                    />
                  ))}
                  <Link
                    href={embedHref(`${basePath}?view=books`)}
                    className="group flex flex-col items-center justify-center rounded-lg border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md bg-cream aspect-[2/3] min-h-[180px]"
                  >
                    <BookOpen className="w-6 h-6 text-muted mb-2 group-hover:text-accent-rust transition-colors" />
                    <span className="text-sm text-secondary group-hover:text-accent-rust transition-colors font-medium text-center px-3">
                      See all books
                    </span>
                  </Link>
                </div>
              </div>
            )}

            {/* Library Catalog */}
            <div className="mb-6">
              <h2 className="text-2xl sm:text-3xl text-primary font-display">
                Library Catalog
              </h2>
              <p className="text-sm text-muted mt-1">
                Complete catalog of the Bibliotheca Philosophica Hermetica — {catalogTotal.toLocaleString()} works in the collection.
                Works available on Source Library are marked with a book icon.
              </p>
            </div>
            <BphCatalogBrowser
              basePath={basePath}
              digitizedUbns={digitizedUbns}
              tenantSlug={tenantSlug ?? undefined}
            />
          </div>
        )}

        {/* Attribution */}
        <div className="mt-16 pt-8 border-t border-border-light">
          <p className="text-sm text-muted leading-relaxed max-w-3xl">
            All book images and metadata are sourced from{' '}
            {hasExternalPartnerUrl && embedPolicy.showExternalLinks ? (
              <a
                href={externalPartnerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-rust hover:underline"
              >
                {partner.name}
              </a>
            ) : (
              <span className="text-secondary">{partner.name}</span>
            )}
            . Original provenance is preserved for every page. Source Library provides OCR transcription, translation, and indexing as a scholarly service.
          </p>
        </div>
      </div>
    </div>
  );
}
