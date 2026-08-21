'use client';

/**
 * Shared library detail view component.
 * Used by both /libraries/[slug] and /[tenant] routes to render consistent library-detail UX.
 * Accepts data loaders as props to support both provider-based and tenant-based queries.
 */

import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, ExternalLink, Images, Library, Search } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionBookCard from '@/components/CollectionBookCard';
import CollectionFilters from '@/components/collections/CollectionFilters';
import { bookTitle } from '@/lib/collections-utils';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';
import BphUnifiedCatalogue from '@/components/libraries/BphUnifiedCatalogue';
import UnifiedCatalogue from '@/components/libraries/UnifiedCatalogue';
import { getBookThumbnailUrl } from '@/lib/utils';
import { getEmbedUiPolicy, embeddedContext } from '@/lib/embed-ui-policy';
import { useEmbed, useEmbedHref } from '@/lib/EmbedContext';
import UnifiedSearch from '@/components/search/UnifiedSearch';

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
  /** Display dimension on the BPH unified catalogue. Independent of `view`. */
  display?: 'list' | 'grid';
  isBph: boolean;
  /** True for tenants with a BPH-parity Books|Catalogue structure that is
   *  NOT BPH itself (currently: kloss-collection). Reads `library_catalog_records`
   *  via /api/catalog/[tenant]. Mutually exclusive with isBph for now — BPH
   *  still uses its bespoke bph_works pipeline. */
  hasUnifiedCatalogue?: boolean;
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
  display,
  isBph,
  hasUnifiedCatalogue = false,
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
  const embedPolicy = getEmbedUiPolicy(embeddedContext(embed));

  // BPH layout: `view` selects the FILTER (catalog = all 27,706, books =
  // digitised+translated subset). `display` selects the VIEW MODE (list =
  // BphCatalogBrowser table, grid = book covers grid). The two are independent —
  // clicking the list/grid icons changes display only; the Show all / Show
  // digitised toggle changes view only. Default landing (no view) keeps the
  // legacy Selected Books + Catalog combo.
  //
  // `hasUnifiedCatalogue` (kloss-collection and future tenants) opts into the
  // same shell but reads from the generic library_catalog_records table via
  // /api/catalog/[tenant]. BPH stays on its own bph_works pipeline for now.
  const usesUnifiedCatalogue = isBph || hasUnifiedCatalogue;
  const showSelectedBooksRow = isBph && view !== 'books' && view !== 'catalog';
  const showUnifiedCatalogue = usesUnifiedCatalogue && (view === 'books' || view === 'catalog');
  const catalogueMode = view === 'books' ? 'digitized' : 'all';
  const effectiveDisplay: 'list' | 'grid' =
    display ?? (catalogueMode === 'digitized' ? 'grid' : 'list');
  // BPH renders covers inside its unified shell on every view, so the
  // generic grid is always hidden there. Other unified-catalogue tenants
  // (kloss) only swap to the unified shell when the user explicitly picks
  // ?view=books|catalog (e.g. via the subdomain proxy's /catalogue rewrite);
  // the default landing keeps the standard books grid so the main-domain
  // /{tenant} path still has something to render.
  const showBooksGrid = !isBph && !showUnifiedCatalogue;

  return (
    <div className="min-h-screen bg-cream">
      {!embed && <ConditionalSiteHeader variant="light" />}
      {/* Hero, Illustrations, and Contributing Libraries are suppressed on
          the dedicated BPH catalogue/books views so the iframe renders just
          the catalogue. Webflow partners build their own page chrome around
          the iframe, so the hero is duplicative there. The default landing
          (no view param) and other tenants still show the full hero. */}
      {!showUnifiedCatalogue && (
      <>
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

          {/* On a tenant subdomain, `/search` is rewritten by proxy.ts to keep the
              URL clean. On a tenant URL prefix, link with the prefix so navigation
              stays scoped (the global /search route is not tenant-aware here).
              For BPH, the hero CTA points at the full catalogue (27,706 works);
              the unified search above only covers the digitised+translated subset. */}
          {tenantSlug && (
            <div className="max-w-2xl mb-5">
              <UnifiedSearch dropdownPosition="bottom" />
              {usesUnifiedCatalogue && catalogTotal > 0 ? (
                <Link
                  href={forceEmbedded ? '/catalogue' : `${basePath}/catalogue`}
                  className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mt-3"
                >
                  <Search className="w-3.5 h-3.5" />
                  Browse the full catalogue ({catalogTotal.toLocaleString('en-US')} works)
                </Link>
              ) : (
                <Link
                  href={forceEmbedded ? '/search' : `${basePath}/search`}
                  className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors mt-3"
                >
                  <Search className="w-3.5 h-3.5" />
                  Open the full search page
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-white/50">
            {usesUnifiedCatalogue && catalogTotal > 0 ? (
              <>
                <span>{catalogTotal.toLocaleString('en-US')} works in catalogue</span>
                <span className="w-px h-4 bg-white/20" />
                <span>{total.toLocaleString('en-US')} digitised on Source Library</span>
              </>
            ) : (
              <span>{total.toLocaleString('en-US')} translated books</span>
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

      {/* Contributing Libraries — only meaningful for aggregator tenants
          (Internet Archive, Gallica, etc). Single-institution tenants (BPH,
          Kloss, future partners) get an "Institution + Unknown" pair that
          adds noise without insight. Show only when there are >=3 distinct
          contributors. */}
      {contributingLibraries.length >= 3 && !usesUnifiedCatalogue && (
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
      </>
      )}

      {/* The unified-catalogue view (the EFM/BPH iframe homepage) gets a wider
          1500px container with 4rem vertical padding on desktop, dropping to
          2rem from tablet down. Other SharedLibraryView consumers (tenant
          home grids, /libraries/[slug]) keep the original 7xl / py-10. */}
      <div className={`${showUnifiedCatalogue ? 'max-w-[1500px] py-8 lg:py-16' : 'max-w-7xl py-10'} mx-auto px-6`}>
        {showUnifiedCatalogue && (
          isBph ? (
            <BphUnifiedCatalogue
              mode={catalogueMode}
              display={effectiveDisplay}
              catalogTotal={catalogTotal}
              basePath={basePath}
              digitizedUbns={digitizedUbns}
              tenantSlug={tenantSlug ?? undefined}
            />
          ) : (
            <UnifiedCatalogue
              tenant={partner.slug}
              mode={catalogueMode}
              display={effectiveDisplay}
              catalogTotal={catalogTotal}
              basePath={basePath}
              digitizedIds={digitizedUbns}
              tenantSlug={tenantSlug ?? undefined}
              libraryName={partner.name}
            />
          )
        )}
        {showBooksGrid ? (
          <>
            {/* All Books Header — only for non-BPH tenants. BPH uses the
                unified catalogue shell above for both modes. */}
            {!showUnifiedCatalogue && (
              <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                <div>
                  <h2
                    className="text-2xl sm:text-3xl text-primary font-display"
                  >
                    All Books
                  </h2>
                  <p className="text-sm text-muted mt-1">
                    {total.toLocaleString('en-US')} books from {partner.name}
                  </p>
                </div>

                <CollectionFilters
                  collectionId={partner.slug}
                  languages={filteredLanguages}
                  basePath={basePath}
                  showSearch
                />
              </div>
            )}

            {/* BPH unified mode renders the search/sort chrome above via
                BphUnifiedCatalogue so the look is identical in list and
                grid view. Skip the per-grid filter row here to avoid a
                duplicate sort dropdown. */}

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
                  bookUrlPrefix=""
                  priority={i < 10}
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
                  {total.toLocaleString('en-US')} books from the BPH collection translated on Source Library.
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
                      bookUrlPrefix=""
                      priority={i < 5}
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

            {/* Library Catalogue heading — only on the default landing
                (showSelectedBooksRow). The /catalog view uses the unified
                shell rendered above instead. */}
            {showSelectedBooksRow && (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl sm:text-3xl text-primary font-display">
                    Library Catalogue
                  </h2>
                  <p className="text-sm text-muted mt-1">
                    Complete catalogue of the Bibliotheca Philosophica Hermetica — {catalogTotal.toLocaleString('en-US')} works in the collection.
                    Works available on Source Library are marked with a book icon.
                  </p>
                </div>
                <BphCatalogBrowser
                  basePath={basePath}
                  digitizedUbns={digitizedUbns}
                  tenantSlug={tenantSlug ?? undefined}
                />
              </>
            )}
            {/* On the dedicated /catalog view (showUnifiedCatalogue=true,
                showSelectedBooksRow=false) the BphCatalogBrowser is rendered
                inside <BphUnifiedCatalogue> above. */}
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
            . Original provenance is preserved.
          </p>
        </div>
      </div>
    </div>
  );
}
