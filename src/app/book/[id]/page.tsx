import { Suspense, cache } from 'react';
import { Metadata } from 'next';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { Calendar, Globe, FileText, BookText, BookMarked, Images } from 'lucide-react';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import EarlyAccessGate from '@/components/book/EarlyAccessGate';
import BookDedication from '@/components/book/BookDedication';
import BookHistory from '@/components/book/BookHistory';
import BookIndex from '@/components/book/BookIndex';
import BookAnalytics from '@/components/book/BookAnalytics';
import CoverImagePicker from '@/components/book/CoverImagePicker';
import DownloadButton from '@/components/ui/DownloadButton';
import BibliographicInfo from '@/components/book/BibliographicInfo';
import PublishEditionButton from '@/components/editions/PublishEditionButton';
import EditionsPanel from '@/components/editions/EditionsPanel';
import SchemaOrgMetadata from '@/components/seo/SchemaOrgMetadata';
import CategoryPicker from '@/components/ui/CategoryPicker';
import { linkEntities, buildEntityList } from '@/lib/link-entities';
import { BookShare } from '@/components/ui/ShareButton';
import LikeButton from '@/components/ui/LikeButton';
import CiteButton from '@/components/ui/CiteButton';
import { AuthCheck } from '@/components/auth/AuthCheck';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { authorUrl } from '@/lib/slugify';
import SiteHeader from '@/components/layout/SiteHeader';

// ISR: rebuild at most every hour (requires no searchParams/headers() usage)
export const revalidate = 3600;

// Run SSR near the database to cut cross-region latency (~200ms RTT savings)
export const preferredRegion = 'fra1';

// Allow any [id] — paths not pre-generated will use ISR on first request
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface PageProps {
  params: Promise<{ id: string }>;
}

// Cached book lookup — deduplicates between generateMetadata and BookInfo
// within a single server render. Uses the broader projection from getBook
// so the result is reusable by both code paths.
const getCachedBookLookup = cache(async (id: string) => {
  const db = await Promise.race([
    getDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 5000)),
  ]);
  return findBookByIdOrSlug(db, id, {
    chapters: 0,
    reading_sections: 0,
    pipeline: 0,
    pipeline_auto: 0,
    split_check: 0,
    'index.sectionSummaries': 0,
    'index.people': 0,
    'index.places': 0,
    'index.concepts': 0,
    'index.keyTerms': 0,
  });
});

// Lightweight book fetch for metadata — reuses cached lookup
async function getBookForMetadata(id: string): Promise<Book | null> {
  const result = await getCachedBookLookup(id);
  return result ? (result.book as unknown as Book) : null;
}



export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const book = await getBookForMetadata(id);

  if (!book) {
    return { title: 'Book Not Found - Source Library', robots: { index: false, follow: false } };
  }

  const title = book.display_title || book.title;
  const ogTitle = book.published ? `${title} (${book.published})` : title;
  const description = `Read the English translation of "${title}" by ${book.author}${book.published ? ` (${book.published})` : ''}. Digitized and translated with AI from the original ${book.language || 'manuscript'}.`;
  const bookUrl = `/book/${book.slug || book.id}`;

  // Get publication date for OG tags
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');
  const publishedDate = currentEdition?.published_at
    ? new Date(currentEdition.published_at).toISOString()
    : book.created_at
      ? new Date(book.created_at).toISOString()
      : undefined;
  const modifiedDate = book.updated_at
    ? new Date(book.updated_at).toISOString()
    : undefined;

  // Google Scholar meta tags for academic discoverability
  // https://scholar.google.com/intl/en/scholar/inclusion.html#indexing
  const scholarMeta: Record<string, string | string[]> = {
    'citation_title': book.title,
    'citation_author': book.author,
    'citation_fulltext_html_url': `https://sourcelibrary.org${bookUrl}`,
  };
  if (book.published) scholarMeta['citation_publication_date'] = book.published;
  if (book.language) scholarMeta['citation_language'] = book.language;
  if (book.publisher) scholarMeta['citation_publisher'] = book.publisher;
  if (book.doi) scholarMeta['citation_doi'] = book.doi;

  // Don't index books with no meaningful content for search engines:
  // - No OCR at all, or
  // - Very thin (1-3 OCR pages) with no translation
  const pagesOcr = book.pages_ocr ?? 0;
  const pagesTranslated = book.pages_translated ?? 0;
  const shouldIndex = pagesOcr > 3 || (pagesOcr > 0 && pagesTranslated > 0);

  return {
    title: `${title} - Source Library`,
    description,
    ...(!shouldIndex && { robots: { index: false, follow: true } }),
    alternates: {
      canonical: bookUrl,
    },
    other: scholarMeta,
    openGraph: {
      title: ogTitle,
      description,
      type: 'article',
      siteName: 'Source Library',
      locale: 'en_US',
      url: bookUrl,
      // OG image generated by opengraph-image.tsx (branded 1200x630 card)
      ...(publishedDate && { publishedTime: publishedDate }),
      ...(modifiedDate && { modifiedTime: modifiedDate }),
      authors: [book.author],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

interface GalleryImagePreview { id: string; extracted_url?: string; thumbnail_url?: string; image_url?: string; description?: string; type?: string; page_number?: number; gallery_quality?: number }
interface BookCollectionPreview { slug: string; name: string; subtitle?: string; color?: string; book_count?: number; featured_images?: Array<{ extracted_url?: string; thumbnail_url?: string; image_url?: string }> }

async function getBook(id: string): Promise<{ book: Book; pages: Page[]; totalBooks: number; galleryImageCount: number; galleryImages: GalleryImagePreview[]; bookCollections: BookCollectionPreview[]; matchedBySlug: boolean } | null> {
  // Reuse the cached book lookup (shared with generateMetadata — saves a full DB round trip)
  const [result, db] = await Promise.all([
    getCachedBookLookup(id),
    getDb(),
  ]);

  if (!result) return null;
  const { book, matchedBySlug } = result;

  // Use the book's id field, or fall back to _id string
  const bookId = book.id || book._id?.toString();

  // Inclusion projection — only fetch fields the book detail UI actually uses
  // Status dots need .updated_at; image count needs array length via .type
  // All queries have maxTimeMS to fail fast during DB degradation
  const [pagesRaw, totalBooks, galleryImageCount, galleryImagesRaw, bookCollectionsRaw] = await Promise.all([
    db.collection('pages')
      .find({ book_id: bookId, page_type: { $ne: 'digitizer-insert' } }, {
        projection: {
          _id: 0,
          id: 1,
          page_number: 1,
          photo: 1,
          photo_original: 1,
          archived_photo: 1,
          cropped_photo: 1,
          thumbnail: 1,
          thumbnail_blob: 1,
          crop: 1,
          'ocr.updated_at': 1,
          'translation.updated_at': 1,
          'summary.updated_at': 1,
          display_brightness: 1,
          page_type: 1,
        },
        maxTimeMS: 5000,
      })
      .sort({ page_number: 1 })
      .toArray(),
    db.collection('books').estimatedDocumentCount().catch(() => 1200),
    db.collection('gallery_images').countDocuments(
      { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_hidden: { $ne: true } },
      { maxTimeMS: 5000 },
    ).catch(() => 0),
    // Top 8 gallery images for preview row
    db.collection('gallery_images')
      .find(
        { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_hidden: { $ne: true } },
        { projection: { _id: 0, id: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1, description: 1, type: 1, page_number: 1, gallery_quality: 1 }, maxTimeMS: 5000 },
      )
      .sort({ gallery_quality: -1 })
      .limit(8)
      .toArray()
      .catch(() => []),
    // Collections this book belongs to
    book.collections?.length
      ? db.collection('collections')
          .find(
            { slug: { $in: book.collections }, hidden: { $ne: true } },
            { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, color: 1, book_count: 1, featured_images: 1 }, maxTimeMS: 5000 },
          )
          .sort({ order: 1 })
          .toArray()
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pagesRaw));
  const galleryImages = JSON.parse(JSON.stringify(galleryImagesRaw)) as GalleryImagePreview[];
  const bookCollections = JSON.parse(JSON.stringify(bookCollectionsRaw)) as BookCollectionPreview[];

  return { book: serializedBook as Book, pages: serializedPages as Page[], totalBooks, galleryImageCount, galleryImages, bookCollections, matchedBySlug };
}

// Skeleton for book info while loading
function BookInfoSkeleton() {
  return (
    <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
          <div className="flex-shrink-0 flex justify-center sm:justify-start">
            <div className="w-32 sm:w-48 aspect-[3/4] rounded-lg overflow-hidden bg-stone-700">
              <div className="w-full h-full bg-gradient-to-r from-stone-700 via-stone-600 to-stone-700 bg-[length:200%_100%] animate-shimmer" />
            </div>
          </div>
          <div className="flex-1 text-center sm:text-left">
            <div className="h-8 w-64 bg-stone-700 rounded mb-2" />
            <div className="h-6 w-40 bg-stone-700 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Skeleton for pages grid
function PagesGridSkeleton() {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4">
      {Array.from({ length: 20 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="w-full h-full bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
          </div>
          <div className="h-3 w-6 bg-stone-100 rounded mx-auto mt-1" />
        </div>
      ))}
    </div>
  );
}

// Book info component (streams in via Suspense)
async function BookInfo({ id }: { id: string }) {
  let data;
  try {
    data = await getBook(id);
  } catch (err) {
    console.error('[Book page] getBook failed:', err instanceof Error ? err.message : err);
    // Return a friendly message instead of crashing the Suspense boundary
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h2>
          <p className="text-secondary mb-6">This book is taking longer than expected to load. Please try again in a moment.</p>
          <Link href="/" className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  const { book, pages, totalBooks, galleryImageCount, galleryImages, bookCollections } = data;

  // Empty shell books (0 pages from failed imports) should 404
  if (!book.pages_count || book.pages_count === 0) {
    notFound();
  }

  // Content gating handled client-side by useBetaGate hook in BookPagesSection
  // Featured books bypass the gate; others show email modal on page click

  // Note: ObjectId→slug redirect is handled by proxy.ts → /api/redirect/book-slug

  // Note: projection excludes .data fields, so check for object existence instead
  const ocrCount = pages.filter(p => p.ocr).length;
  const translatedCount = pages.filter(p => p.translation).length;
  const imageCount = galleryImageCount;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > pages.length / 2; // >50% translated
  // Image downloads restricted for non-commercial licensed sources (BSB, Bodleian, Vatican, etc.)
  const imgLicense = (book as any).image_source?.license || 'unknown';
  const imageRestricted = imgLicense === 'unknown' || /\bnc\b/i.test(imgLicense);
  const indexBrief = (book as unknown as { index?: { bookSummary?: { brief?: string } } }).index?.bookSummary?.brief;
  const readingSummary = (book as unknown as { reading_summary?: { overview?: string } }).reading_summary?.overview;
  const summaryText = indexBrief || readingSummary || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  const hasSummary = !!summaryText;
  const isComplete = ocrCount === pages.length && translatedCount === pages.length && hasSummary;
  const summaryEntities = buildEntityList((book as unknown as { index?: { people?: Array<{ term: string }>; places?: Array<{ term: string }>; concepts?: Array<{ term: string }> } }).index);

  return (
    <>
      {/* Schema.org JSON-LD for Google Scholar */}
      <SchemaOrgMetadata
        book={book}
        pageCount={pages.length}
        translatedCount={translatedCount}
        currentEdition={currentEdition}
      />

      {/* Cross-book citation_reference meta tags + related books stream in separately */}

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Thumbnail - clickable to change */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <CoverImagePicker
                bookId={book.id}
                currentThumbnail={book.thumbnail}
                currentThumbnailBlob={book.thumbnail_blob}
                bookTitle={book.title}
                pages={pages}
              />
            </div>

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold break-words">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic text-sm sm:text-base">{book.title}</p>
              )}
              <p className="text-lg sm:text-xl text-stone-300 mt-2">
                {authorUrl(book.author) ? (
                  <Link href={authorUrl(book.author)!} className="hover:text-white transition-colors">
                    {book.author}
                  </Link>
                ) : book.author}
              </p>

              {/* DOI badge */}
              {book.doi && (
                <a
                  href={`https://doi.org/${book.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-white/10 hover:bg-white/20 text-stone-200 rounded-full text-xs font-mono transition-colors"
                >
                  DOI: {book.doi}
                </a>
              )}

              {/* Book metadata */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6 text-sm text-stone-400">
                {book.language && (
                  <div className="flex items-center gap-2" data-testid="language-metadata">
                    <Globe className="w-4 h-4" />
                    {book.language}
                  </div>
                )}
                {(book.published || book.source_work_dates?.length) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {book.source_work_dates?.length ? (
                      <span>
                        {book.source_work_dates.find(l => l.type === 'composition')
                          ? `${book.source_work_dates.find(l => l.type === 'composition')!.author || ''} ${book.source_work_dates.find(l => l.type === 'composition')!.date_display}`.trim()
                          : ''}
                        {book.source_work_dates.find(l => l.type === 'composition') && book.published
                          ? <span className="text-stone-500"> · published {book.published}</span>
                          : ''}
                        {!book.source_work_dates.find(l => l.type === 'composition') && book.source_work_dates.find(l => l.type === 'translation')
                          ? `${book.source_work_dates.find(l => l.type === 'translation')!.author || ''} trans. ${book.source_work_dates.find(l => l.type === 'translation')!.date_display}`.trim()
                          : ''}
                        {!book.source_work_dates.find(l => l.type === 'composition') && !book.source_work_dates.find(l => l.type === 'translation') && book.published
                          ? book.published
                          : ''}
                      </span>
                    ) : book.published}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {pages.length} pages
                </div>
                {imageCount > 0 && (
                  <Link
                    href={`/gallery?bookId=${book.id}`}
                    className="flex items-center gap-2 text-accent-gold hover:text-accent-gold transition-colors"
                    title="View identified images in gallery"
                  >
                    <Images className="w-4 h-4" />
                    {imageCount} images
                  </Link>
                )}
              </div>

              {book.is_first_translation && (
                <div className="mt-3">
                  <Link
                    href="/blog/first-translation-methodology"
                    className="px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors"
                  >
                    First English Translation
                  </Link>
                </div>
              )}

              {/* Source attribution — always visible */}
              {(book.image_source?.provider_name || book.image_source?.contributing_library) && (
                <p className="text-xs text-stone-500 mt-3">
                  Images:{' '}
                  {book.image_source.source_url ? (
                    <a href={book.image_source.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-stone-300 transition-colors">
                      {book.image_source.attribution || book.image_source.contributing_library || book.image_source.provider_name}
                    </a>
                  ) : (
                    <span>{book.image_source.attribution || book.image_source.contributing_library || book.image_source.provider_name}</span>
                  )}
                </p>
              )}

              {/* Dedication */}
              <div className="mt-3">
                <BookDedication bookId={book.id} dedication={(book as any).dedication || null} />
              </div>

              {/* Actions */}
              <div className="flex flex-col items-center sm:items-start gap-3 mt-5 text-sm">
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                  {/* Publish — admin only */}
                  <AuthCheck role="admin">
                    {isComplete ? (
                      <PublishEditionButton
                        bookId={book.id}
                        bookTitle={book.display_title || book.title}
                        translatedCount={translatedCount}
                        totalPages={pages.length}
                        currentEdition={currentEdition}
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 px-3 py-1.5 text-stone-500 cursor-not-allowed" title="Complete OCR, translation & summary first">
                        <BookMarked className="w-4 h-4" />
                        <span className="opacity-60">Publish</span>
                      </span>
                    )}
                  </AuthCheck>

                  {/* Utility actions */}
                  <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5">
                    <CiteButton
                      bookId={book.id}
                      title={book.title}
                      displayTitle={book.display_title}
                      author={book.author}
                      year={book.published}
                      publisher={book.publisher}
                      placePublished={book.place_published}
                      language={book.language}
                      doi={book.doi}
                      editionVersion={currentEdition?.version}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <DownloadButton
                      bookId={book.id}
                      bookTitle={book.display_title || book.title}
                      hasTranslations={hasTranslations}
                      hasOcr={hasOcr}
                      hasImages={pages.length > 0}
                      imageRestricted={imageRestricted}
                      variant="header"
                    />
                    <span className="hidden sm:block w-px h-5 bg-white/10 mx-1" />
                    <div className="flex items-center gap-2.5 px-2 py-1.5">
                      <BookAnalytics bookId={book.id} className="text-stone-300" />
                      <LikeButton
                        targetType="book"
                        targetId={book.id}
                        size="sm"
                        showCount={true}
                        className="text-stone-300"
                      />
                    </div>
                    <span className="hidden sm:block w-px h-5 bg-white/10 mx-1" />
                    <BookShare
                      title={book.display_title || book.title}
                      author={book.author}
                      year={book.published}
                      bookId={book.id}
                      doi={book.doi}
                      label="Share"
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                  </div>
                </div>

                {/* Search — separate line */}
                <SearchPanel bookId={book.id} />
              </div>

              {/* Bibliographic Info */}
              <BibliographicInfo book={book} pagesCount={pages.length} />
            </div>
          </div>
        </div>
      </div>

      {/* Clean break between dark header and light content */}
      <div className="h-px bg-stone-200" />

      {/* Book Summary */}
      {(() => {
        return (
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>About This Book</h2>
                {hasTranslations ? (
                  <Link
                    href={`/book/${book.id}/guide`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-accent-rust hover:text-accent-gold-dark hover:bg-accent-gold/8 rounded-lg transition-colors"
                  >
                    <BookText className="w-4 h-4" />
                    {hasSummary ? 'Full Summary & Index' : 'Generate Summary'}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-stone-400 cursor-not-allowed" title="Translate pages first">
                    <BookText className="w-4 h-4" />
                    <span className="opacity-60">Generate Summary</span>
                  </span>
                )}
              </div>

              {/* Categories */}
              <div className="mb-4 pb-4 border-b border-stone-100">
                <CategoryPicker
                  bookId={book.id}
                  currentCategories={book.categories || []}
                />
              </div>
              {hasSummary ? (
                <div className="prose-content max-w-none">
                  {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                    <p key={i} className="mb-4 last:mb-0">
                      {linkEntities(paragraph, summaryEntities)}
                    </p>
                  ))}
                </div>
              ) : hasTranslations ? (
                <p className="text-stone-500 text-sm">
                  No summary yet. Generate a summary to unlock the full book index.
                </p>
              ) : (
                <p className="text-stone-500 text-sm">
                  Translate pages to unlock summary generation.
                </p>
              )}
            </div>

            {/* Editions Panel */}
            {book.editions?.length ? (
              <EditionsPanel
                bookId={book.id}
                editions={book.editions as TranslationEdition[]}
              />
            ) : null}

            {/* Index — tiered with filter */}
            {(() => {
              const allEntries = (book as unknown as { index?: { entries?: Array<{ term: string; pages: number[]; type: 'vocab' | 'term' | 'keyword' }> } }).index?.entries;
              if (!allEntries || allEntries.length === 0) return null;

              // Drop hapax (single-mention) entries server-side to keep serialization small
              const entries = allEntries.filter(e => e.pages.length >= 2);
              if (entries.length === 0) return null;

              return (
                <BookIndex
                  entries={entries}
                  bookSlug={book.slug || book.id}
                  totalPages={pages.length}
                />
              );
            })()}

            {/* Gallery Images Preview */}
            {galleryImages.length > 0 && (
              <div className="card p-6 mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Illustrations
                    <span className="text-sm font-normal text-stone-400 ml-2">{galleryImageCount}</span>
                  </h2>
                  <Link
                    href={`/gallery?bookId=${book.id}`}
                    className="text-sm text-accent-rust hover:text-accent-gold-dark transition-colors"
                  >
                    View All &rarr;
                  </Link>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
                  {galleryImages.map((img) => {
                    const src = img.extracted_url || img.thumbnail_url || img.image_url;
                    if (!src) return null;
                    return (
                      <Link
                        key={img.id}
                        href={`/gallery/image/${img.id}`}
                        className="flex-shrink-0 group"
                      >
                        <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 group-hover:border-accent-rust/40 transition-colors">
                          <img
                            src={src}
                            alt={img.description || 'Illustration'}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                        </div>
                        {img.type && (
                          <p className="text-[10px] text-stone-400 mt-1 text-center truncate w-28 sm:w-36">{img.type}</p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Related Books removed — will be pre-computed (see GitHub issue) */}
          </div>
        );
      })()}

      {/* Stats + Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        {(() => {
          const membersOnlyUntil = (book as unknown as { members_only_until?: string }).members_only_until;
          if (membersOnlyUntil && new Date(membersOnlyUntil) > new Date()) {
            return (
              <EarlyAccessGate membersOnlyUntil={membersOnlyUntil}>
                <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />
              </EarlyAccessGate>
            );
          }
          return <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />;
        })()}
        <AuthCheck role="admin">
          <BookHistory bookId={book.id} />
        </AuthCheck>
      </main>
    </>
  );
}

export default async function BookDetailPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-cream">
      {/* Header - renders immediately */}
      <SiteHeader variant="light" />

      {/* Book content streams in */}
      <Suspense fallback={
        <>
          <BookInfoSkeleton />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>
            <PagesGridSkeleton />
          </main>
        </>
      }>
        <BookInfo id={id} />
      </Suspense>
      <SignUpCTA />
    </div>
  );
}
