import { Suspense, cache } from 'react';
import { Metadata } from 'next';
import { ObjectId } from 'mongodb';
import { getReadDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Book, Page, TranslationEdition } from '@/lib/types';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { deduplicateByDHash } from '@/lib/dhash';
import { getBookDetail } from '@/lib/books-catalog';
import { Calendar, Globe, FileText, BookMarked, Images, BookOpen } from 'lucide-react';
import ArtworkInfo from '@/components/artwork/ArtworkInfo';
import SearchPanel from '@/components/search/SearchPanel';
import BookPagesSection from '@/components/book/BookPagesSection';
import EarlyAccessGate from '@/components/book/EarlyAccessGate';
import BookDedication from '@/components/book/BookDedication';
import BookHistory from '@/components/book/BookHistory';
import BookIndex from '@/components/book/BookIndex';
import ChaptersDropdown from '@/components/book/ChaptersDropdown';
import BookAnalytics from '@/components/book/BookAnalytics';
import CoverImagePicker from '@/components/book/CoverImagePicker';
import DownloadButton from '@/components/ui/DownloadButton';
import BibliographicInfo from '@/components/book/BibliographicInfo';
import BphCatalogueRecord from '@/components/book/BphCatalogueRecord';
import RelatedEditions from '@/components/book/RelatedEditions';
import RelatedBooks from '@/components/book/RelatedBooks';
import AuthorCrossReference from '@/components/book/AuthorCrossReference';
import PublishEditionButton from '@/components/editions/PublishEditionButton';
import EditionsPanel from '@/components/editions/EditionsPanel';
import SchemaOrgMetadata from '@/components/seo/SchemaOrgMetadata';
import DublinCoreMeta from '@/components/seo/DublinCoreMeta';
import CategoryPicker from '@/components/ui/CategoryPicker';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import ExpandableGuide from '@/components/book/ExpandableGuide';
import { AISection } from '@/components/embed/AISection';
import AuthorAuthority from '@/components/book/AuthorAuthority';
import { linkEntities, buildEntityList } from '@/lib/link-entities';
import LikeButton from '@/components/ui/LikeButton';
import CiteButton from '@/components/ui/CiteButton';
import { AuthCheck } from '@/components/auth/AuthCheck';
import EmbedNavigationReporter from '@/components/embed/EmbedNavigationReporter';
import SignUpCTA from '@/components/auth/SignUpCTA';
import { authorUrl } from '@/lib/slugify';
import { firstTranslationBadge, firstTranslationDescription } from '@/lib/first-translation-labels';
import { formatAuthor, getBookThumbnailUrl } from '@/lib/utils';
import { getEffectiveByline } from '@/lib/byline';
import AuthorName from '@/components/AuthorName';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import { resolveTenantId } from '@/lib/tenant-context';
import { getEmbedUiPolicy, type EmbedUiPolicy } from '@/lib/embed-ui-policy';

// Cached tenant ID lookup - avoids headers() which would disable ISR
const getCachedTenantId = cache(async (slug: string): Promise<string | undefined> => {
  const id = await resolveTenantId(slug);
  return id ?? undefined;
});

// ISR: serve cached HTML, revalidate in background every 24h.
// Pipeline also calls /api/admin/revalidate-book for immediate updates after OCR/translation/enrichment.
// Using 86400 instead of false so pages self-heal after deploys (which purge the cache).
export const revalidate = 86400;

// Run SSR near the database to cut cross-region latency (~200ms RTT savings)
export const preferredRegion = 'fra1';

// Allow any [id] — paths not pre-generated will use ISR on first request
export const dynamicParams = true;
export async function generateStaticParams() {
  return []; // All paths generated on demand via ISR
}

interface PageProps {
  params: Promise<{ tenant: string; id: string }>;
  isEmbedded?: boolean;
}

// Cached book lookup — deduplicates between generateMetadata and BookInfo
// within a single server render.
//
// Tries Supabase first (<50ms) for the book shell, then falls back to Atlas.
// When Supabase succeeds, getBook() can start ALL Atlas queries in parallel
// (pages, gallery, collections, full book refetch) instead of waiting for the
// book lookup before starting page queries.
const getCachedBookLookup = cache(async (id: string): Promise<{
  book: Record<string, unknown>;
  matchedBySlug: boolean;
  fromCatalog: boolean;
} | null> => {
  // Try Supabase first — instant lookup from the books_catalog mirror
  try {
    const catalogResult = await getBookDetail(id);
    if (catalogResult) {
      return {
        book: catalogResult.book as unknown as Record<string, unknown>,
        matchedBySlug: catalogResult.matchedBySlug,
        fromCatalog: true,
      };
    }
  } catch {
    // Supabase down — fall through to Atlas
  }

  // Fall back to Atlas (slower but has everything)
  const db = await Promise.race([
    getReadDb(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DB timeout')), 15000)),
  ]);
  const result = await findBookByIdOrSlug(db, id, {
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
  if (!result) return null;
  return { book: result.book as Record<string, unknown>, matchedBySlug: result.matchedBySlug, fromCatalog: false };
});

function getBookTenantId(book: Record<string, unknown> | Book): string | undefined {
  return (book as any).tenantId || (book as any).tenant_id;
}

// Lightweight book fetch for metadata — reuses cached lookup
async function getBookForMetadata(id: string, tenantId?: string | null, tenantSlug?: string): Promise<Book | null> {
  const result = await getCachedBookLookup(id);
  if (result && tenantId) {
    const db = await getReadDb();
    const scoped = await findBookByIdOrSlug(db, id, {
      reading_sections: 0,
      pipeline: 0,
      pipeline_auto: 0,
      split_check: 0,
      'index.sectionSummaries': 0,
      'index.people': 0,
      'index.places': 0,
      'index.concepts': 0,
      'index.keyTerms': 0,
    }, tenantId, tenantSlug);
    return scoped ? (scoped.book as unknown as Book) : null;
  }
  return result ? (result.book as unknown as Book) : null;
}



export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id, tenant } = await params;
  const tenantId = await getCachedTenantId(tenant);
  let book: Book | null;
  try {
    book = await getBookForMetadata(id, tenantId, tenant);
  } catch {
    return { title: 'Source Library', robots: { index: false, follow: false } };
  }

  if (!book) {
    return { title: 'Book Not Found - Source Library', robots: { index: false, follow: false } };
  }

  // Wrong tenant — suppress metadata entirely so the 404 isn't indexed.
  // Match either UUID (tenantId) or slug (tenant_id) — legacy docs may have only one set.
  const bookTenantUuid = (book as any).tenantId as string | undefined;
  const bookTenantSlug = (book as any).tenant_id as string | undefined;
  const hasTenantField = !!(bookTenantUuid || bookTenantSlug);
  const matchesTenant =
    (bookTenantUuid && tenantId && bookTenantUuid === tenantId) ||
    (bookTenantSlug && tenant && bookTenantSlug === tenant);
  if (hasTenantField && !matchesTenant) {
    return { title: 'Not Found - Source Library', robots: { index: false, follow: false } };
  }

  const title = book.display_title || book.title;
  const ogTitle = book.published ? `${title} (${book.published})` : title;
  // Byline for citations / meta tags. Falls back to editor for edited volumes,
  // magazines and anthologies where the catalogue has no single author. Keep
  // formatAuthor() in the chain to strip bibliographic brackets etc.
  const byline = getEffectiveByline(book);
  const bylineName = byline.displayName
    ? formatAuthor(byline.displayName).name || byline.displayName
    : formatAuthor(book.author).name || book.author;
  const bylineLabel = byline.isEditor ? `${bylineName} (ed.)` : bylineName;
  const year = book.published ? ` (${book.published})` : '';
  // Build description front-loading title+byline+date, truncated to 155 chars for SEO
  let description = `${title} by ${bylineLabel}${year} — read the full English translation online.`;
  if (description.length > 155) {
    description = `${title} by ${bylineLabel}${year}`.slice(0, 152) + '...';
  }
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
  //
  // citation_author covers both authors and editors for compilations — Google
  // Scholar doesn't have a separate citation_editor tag, but the `(ed.)`
  // suffix is the standard convention and is preserved through search results.
  const scholarMeta: Record<string, string | string[]> = {
    'citation_title': book.title,
    'citation_author': bylineLabel,
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
      types: {
        'application/ld+json': `https://sourcelibrary.org/api/dts/collection?id=${book.id}`,
      },
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
      authors: [bylineLabel],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      // Twitter image generated by opengraph-image.tsx
    },
  };
}

interface GalleryImagePreview { id: string; extracted_url?: string; thumbnail_url?: string; image_url?: string; description?: string; type?: string; page_number?: number; gallery_quality?: number; dhash?: string; book_id?: string }
interface BookCollectionPreview { slug: string; name: string; subtitle?: string; color?: string; book_count?: number; featured_images?: Array<{ extracted_url?: string; thumbnail_url?: string; image_url?: string }> }

interface AuthorEntityPreview {
  name?: string;
  canonical_name?: string;
  aliases?: string[];
  viaf_id?: string;
  wikidata_id?: string;
  lcnaf_id?: string;
  gnd_id?: string;
  wikipedia_url?: string;
  wikidata_birth_date?: string;
  wikidata_death_date?: string;
}

async function getBook(id: string, tenantId?: string, tenantSlug?: string): Promise<{ book: Book; pages: Page[]; totalBooks: number; galleryImages: GalleryImagePreview[]; galleryImageCount: number; bookCollections: BookCollectionPreview[]; matchedBySlug: boolean; authorEntity: AuthorEntityPreview | null } | null> {
  // Reuse the cached book lookup (shared with generateMetadata — saves a full DB round trip)
  // When Supabase serves the lookup (<50ms), we get the bookId instantly and can start
  // ALL Atlas queries in parallel — including a full book refetch for fields not in the catalog.
  const [result, db] = await Promise.all([
    getCachedBookLookup(id),
    getReadDb(),
  ]);

  if (!result) return null;
  let effectiveResult = result;
  if (tenantId) {
    const scoped = await findBookByIdOrSlug(db, id, {
      reading_sections: 0,
      pipeline: 0,
      pipeline_auto: 0,
      split_check: 0,
      'index.sectionSummaries': 0,
      'index.people': 0,
      'index.places': 0,
      'index.concepts': 0,
      'index.keyTerms': 0,
    }, tenantId, tenantSlug);
    if (!scoped) return null;
    effectiveResult = {
      book: scoped.book as Record<string, unknown>,
      matchedBySlug: scoped.matchedBySlug,
      fromCatalog: false,
    };
  }

  const { book: quickBook, matchedBySlug, fromCatalog } = effectiveResult;

  // Use the book's id field, or fall back to _id string
  const bookId = (quickBook.id || quickBook._id?.toString()) as string;

  // When the lookup came from Supabase catalog, we need to fetch the full book from Atlas
  // for fields not in the catalog (editions, translation_verification, index, etc.).
  // This runs in parallel with pages/gallery/collections — no sequential bottleneck.
  const fullBookPromise = fromCatalog
    ? findBookByIdOrSlug(db, bookId, {
      reading_sections: 0,
      pipeline: 0,
      pipeline_auto: 0,
      split_check: 0,
      'index.sectionSummaries': 0,
      'index.people': 0,
      'index.places': 0,
      'index.concepts': 0,
      'index.keyTerms': 0,
    }, tenantId).catch(() => null)
    : Promise.resolve(null); // Already have full book from Atlas

  // All queries have maxTimeMS to fail fast during DB degradation
  const [fullBookResult, pagesRaw, totalBooks, galleryImagesRaw, galleryImageCount, bookCollectionsRaw] = await Promise.all([
    fullBookPromise,
    // Use page_number >= 0 to skip archived-spread pages (negative numbers).
    // This uses the {book_id, page_number} compound index efficiently.
    // Digitizer-inserts are still filtered in JS (rare, no index benefit).
    db.collection('pages')
      .find({ book_id: bookId, page_number: { $gte: 0 } }, {
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
          image_display: 1,
          image_thumb: 1,
          crop: 1,
          'ocr.updated_at': 1,
          'translation.updated_at': 1,
          'summary.updated_at': 1,
          display_brightness: 1,
          page_type: 1,
          split_from_spread: 1,
        },
        maxTimeMS: 5000,
      })
      .sort({ page_number: 1 })
      .limit(110) // slight over-fetch to account for digitizer-inserts filtered below
      .toArray()
      .then(docs => docs.filter(d => d.page_type !== 'digitizer-insert' && d.page_type !== 'archived-spread' && (d.page_number == null || d.page_number >= 0)).slice(0, 100)),
    db.collection('books').estimatedDocumentCount().catch(() => 1200),
    // Top 8 gallery images for preview row
    db.collection('gallery_images')
      .find(
        { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
        { projection: { _id: 0, id: 1, extracted_url: 1, thumbnail_url: 1, image_url: 1, description: 1, type: 1, page_number: 1, gallery_quality: 1, dhash: 1, book_id: 1 }, maxTimeMS: 5000 },
      )
      .sort({ gallery_quality: -1 })
      .limit(30) // over-fetch to allow dhash dedup to filter duplicates
      .toArray()
      .catch(() => []),
    // Separate count query for accurate image count display
    db.collection('gallery_images')
      .countDocuments(
        { book_id: bookId, gallery_quality: { $gte: 0.7 }, book_visible: true, extracted_url: { $ne: null }, image_url: { $ne: null } },
        { maxTimeMS: 5000 },
      )
      .catch(() => 0),
    // Collections this book belongs to
    (quickBook.collections as string[] | undefined)?.length
      ? db.collection('collections')
        .find(
          { slug: { $in: quickBook.collections as string[] }, visible: true },
          { projection: { _id: 0, slug: 1, name: 1, subtitle: 1, color: 1, book_count: 1, featured_images: 1 }, maxTimeMS: 5000 },
        )
        .sort({ order: 1 })
        .toArray()
        .catch(() => [])
      : Promise.resolve([]),
  ]);

  // Use the full Atlas book when available (has editions, translation_verification, etc.)
  // Fall back to the catalog book (Supabase) if Atlas fetch failed
  const book = fullBookResult?.book ?? quickBook;

  // Author authority record (variants / VIAF / Wikidata) — only when the
  // book has been linked to an entity. Loaded in parallel with the index
  // doc; failures are non-fatal (the AuthorAuthority component just doesn't
  // render). See scripts/enrichment/viaf-author-linking.mjs for how the
  // link gets set.
  const authorEntityIdRaw = (book as { author_entity_id?: string }).author_entity_id;
  const authorEntityId = typeof authorEntityIdRaw === 'string' && ObjectId.isValid(authorEntityIdRaw)
    ? authorEntityIdRaw
    : null;

  const [bookIndexDoc, authorEntity] = await Promise.all([
    db.collection('book_indexes').findOne(
      { book_id: bookId },
      { projection: { _id: 0, book_id: 0 }, maxTimeMS: 5000 }
    ).catch(() => null),
    authorEntityId
      ? db.collection('entities').findOne(
          { _id: new ObjectId(authorEntityId) },
          {
            projection: {
              _id: 0,
              name: 1, canonical_name: 1, aliases: 1,
              viaf_id: 1, wikidata_id: 1, lcnaf_id: 1, gnd_id: 1,
              wikipedia_url: 1,
              wikidata_birth_date: 1, wikidata_death_date: 1,
            },
            maxTimeMS: 3000,
          }
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Merge index data back onto book for rendering (if found in dedicated collection)
  if (bookIndexDoc) {
    (book as any).index = { ...(book as any).index, ...bookIndexDoc };
  }

  // Serialize MongoDB objects to plain JavaScript objects
  const serializedBook = JSON.parse(JSON.stringify(book));
  const serializedPages = JSON.parse(JSON.stringify(pagesRaw)) as Page[];

  // Infer crop data for uncropped pages in spread books.
  // The crop pipeline skips covers/blanks, leaving them as full spreads.
  // Detect the book's parity convention from existing crops, then fill gaps.
  // Guards: need 6+ cropped pages AND a decisive parity majority (>75%)
  // to avoid misfiring on books with sparse or inconsistent crop data.
  const pagesWithCrop = serializedPages.filter(p => p.crop?.xStart !== undefined);
  if (pagesWithCrop.length >= 6) {
    let oddLeft = 0, oddRight = 0;
    for (const p of pagesWithCrop) {
      if (p.page_number % 2 === 1) {
        (p.crop!.xStart as number) > 400 ? oddRight++ : oddLeft++;
      }
    }
    const oddVotes = oddLeft + oddRight;
    const majorityPct = oddVotes > 0 ? Math.max(oddLeft, oddRight) / oddVotes : 0;

    if (oddVotes >= 3 && majorityPct >= 0.75) {
      const oddIsLeft = oddLeft > oddRight;
      for (const p of serializedPages) {
        if (p.crop || p.split_from_spread) continue;
        const isOdd = p.page_number % 2 === 1;
        const useLeft = oddIsLeft ? isOdd : !isOdd;
        (p as any).crop = useLeft
          ? { xStart: 0, xEnd: 510 }
          : { xStart: 490, xEnd: 1000 };
      }
    }
  }

  const galleryImagesParsed = JSON.parse(JSON.stringify(galleryImagesRaw)) as (GalleryImagePreview & { gallery_quality: number; book_id: string })[];
  const galleryImages = deduplicateByDHash(galleryImagesParsed).slice(0, 8) as GalleryImagePreview[];
  const bookCollections = JSON.parse(JSON.stringify(bookCollectionsRaw)) as BookCollectionPreview[];

  const serializedEntity = authorEntity ? JSON.parse(JSON.stringify(authorEntity)) : null;

  return { book: serializedBook as Book, pages: serializedPages as Page[], totalBooks, galleryImages, galleryImageCount, bookCollections, matchedBySlug, authorEntity: serializedEntity };
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
async function BookInfo({ id, tenantId, tenantSlug, embedPolicy }: { id: string; tenantId?: string; tenantSlug: string; embedPolicy: EmbedUiPolicy }) {
  let data;
  try {
    data = await getBook(id, tenantId, tenantSlug);
  } catch (err) {
    console.error('[Book page] getBook failed:', err instanceof Error ? err.message : err);
    // Return a friendly message instead of crashing the Suspense boundary
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-display text-primary mb-3">Temporarily Unavailable</h2>
          <p className="text-secondary mb-6">This book is taking longer than expected to load. Please try again in a moment.</p>
          <Link href={`/${tenantSlug || ''}`} className="text-accent-rust hover:underline">Return to Library</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    notFound();
  }

  const { book, pages, totalBooks, galleryImages, galleryImageCount, bookCollections, authorEntity } = data;

  // Enforce tenant isolation: book must belong to the tenant in the URL.
  // Books are stored with EITHER `tenantId` (UUID) or `tenant_id` (slug) — sometimes both.
  // Match against whichever form is present so legacy artwork docs (slug-only) don't 404.
  const bookTenantUuid = (book as any).tenantId as string | undefined;
  const bookTenantSlug = (book as any).tenant_id as string | undefined;
  const hasTenantField = !!(bookTenantUuid || bookTenantSlug);
  const matchesTenant =
    (bookTenantUuid && tenantId && bookTenantUuid === tenantId) ||
    (bookTenantSlug && tenantSlug && bookTenantSlug === tenantSlug);
  if (hasTenantField && !matchesTenant) {
    notFound();
  }

  // Empty shell books (0 pages from failed imports) should 404
  // But visual art (paintings, prints, etc.) legitimately has no page documents
  const isVisualArt = book.resource_type && book.resource_type !== 'printed_book' && book.resource_type !== 'manuscript';
  if (!isVisualArt && (!book.pages_count || book.pages_count === 0)) {
    notFound();
  }

  // Visual art gets a dedicated layout — no OCR, no pages grid, no translation stats
  if (isVisualArt) {
    // Find related books by this artist (when source_book isn't already set)
    let relatedBooksByAuthor: Array<{ id: string; slug: string; title: string; thumbnail?: string; thumbnail_blob?: string }> = [];
    const hasSourceBook = !!(book as any).source_book;
    const authorName = book.author?.trim();
    const isKnownAuthor = authorName && !/^unknown/i.test(authorName) && !/^unidentified/i.test(authorName) && !/^anonymous/i.test(authorName);
    if (!hasSourceBook && isKnownAuthor) {
      const artDb = await getReadDb();
      relatedBooksByAuthor = await artDb.collection('books')
        .find(
          { author: authorName, content_type: { $ne: 'artwork' }, pages_count: { $gt: 0 } },
          { projection: { id: 1, slug: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1 }, maxTimeMS: 3000 },
        )
        .limit(6)
        .toArray()
        .then(docs => JSON.parse(JSON.stringify(docs)))
        .catch(() => []);
    }

    return (
      <ArtworkInfo
        book={book}
        collections={bookCollections}
        relatedBooks={relatedBooksByAuthor}
        isEmbedded={!embedPolicy.showAuthorCrossReference}
      />
    );
  }

  // Content gating handled client-side by useBetaGate hook in BookPagesSection
  // Featured books bypass the gate; others show email modal on page click

  // Note: ObjectId→slug redirect is handled by proxy.ts → /api/redirect/book-slug

  // Use book-level cached counts (not page array, which is truncated to first 100 pages)
  const ocrCount = book.pages_ocr ?? pages.filter(p => p.ocr).length;
  const translatedCount = book.pages_translated ?? pages.filter(p => p.translation).length;
  const totalPages = book.pages_count || pages.length;
  const imageCount = galleryImageCount || galleryImages.length;
  const currentEdition = (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'published') || (book.editions as TranslationEdition[] | undefined)?.find(e => e.status === 'draft');

  // Progression: OCR → Translation → Summary → Ask AI / Publish
  const hasOcr = ocrCount > 0;
  const hasTranslations = translatedCount > totalPages / 2; // >50% translated
  // Image-download access classification (mirrors classifyImageAccess in lib/purchases.ts):
  //  - 'open': PD / CC-BY / BPH / pre-1930 → flows through the normal member/pay gate
  //  - 'nc-free': NC-licensed → free for any signed-in user, never charged
  //  - 'blocked': modern + unknown license + non-BPH → withheld entirely
  const imgLicense = (book as any).image_source?.license || 'unknown';
  const imgProvider = (book as any).image_source?.provider;
  const yearPublished = (book as unknown as { year_published?: number }).year_published;
  const isNcLicense = typeof imgLicense === 'string' && /\bnc\b/i.test(imgLicense);
  const imageAccess: 'open' | 'nc-free' | 'blocked' =
    imgProvider === 'bph' || (typeof yearPublished === 'number' && yearPublished < 1930)
      ? 'open'
      : isNcLicense
        ? 'nc-free'
        : (!imgLicense || imgLicense === 'unknown')
          ? 'blocked'
          : 'open';
  const imageRestricted = imageAccess === 'blocked';
  const bookSummaryObj = (book as unknown as { index?: { bookSummary?: { brief?: string; detailed?: string; abstract?: string } } }).index?.bookSummary;
  const indexBrief = bookSummaryObj?.brief;
  const readingSummary = (book as unknown as { reading_summary?: { overview?: string } }).reading_summary?.overview;
  const summaryText = indexBrief || readingSummary || (typeof book.summary === 'string' ? book.summary : book.summary?.data);
  const hasSummary = !!summaryText;
  const isComplete = ocrCount >= totalPages && translatedCount >= totalPages && hasSummary;
  const summaryEntities = buildEntityList((book as unknown as { index?: { people?: Array<{ term: string }>; places?: Array<{ term: string }>; concepts?: Array<{ term: string }> } }).index);

  return (
    <>
      <EmbedNavigationReporter book={book.slug || book.id} />
      {/* Schema.org JSON-LD for Google Scholar */}
      <SchemaOrgMetadata
        book={book}
        pageCount={totalPages}
        translatedCount={translatedCount}
        currentEdition={currentEdition}
      />
      {/* Dublin Core meta tags for library crawlers */}
      <DublinCoreMeta
        title={book.title}
        displayTitle={book.display_title}
        author={book.author}
        language={book.language}
        year={(book as unknown as { year_published?: number }).year_published}
        description={book.ai_metadata?.description as string | undefined}
        categories={book.categories}
        keywords={(book as unknown as { subject_keywords?: string[] }).subject_keywords}
        publisher={book.dublin_core?.dc_publisher || book.image_source?.provider_name}
        rights={book.dublin_core?.dc_rights}
        identifier={`https://sourcelibrary.org/book/${book.slug || book.id}`}
        source={book.image_source?.source_url}
        pageCount={totalPages}
        doi={book.doi}
        ustcSn={(book as unknown as { ustc_sn?: string }).ustc_sn}
      />

      {/* Cross-book citation_reference meta tags + related books stream in separately */}

      {/* Book Info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8">
            {/* Thumbnail - clickable to change */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <CoverImagePicker
                bookId={book.id}
                currentThumbnail={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'display') ?? undefined}
                currentThumbnailBlob={getBookThumbnailUrl(book as Parameters<typeof getBookThumbnailUrl>[0], 'thumb') ?? undefined}
                bookTitle={book.title}
                pages={pages}
              />
            </div>

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              {/* Bibliographic citation order (Paul Dijstelberge, BPH feedback):
                  author leads, then title, then impressum. The h1 stays on
                  title for SEO and visual hierarchy; author renders as the
                  eyebrow above it. See src/lib/byline.ts for "Unknown" rules. */}
              {(() => {
                const heroByline = getEffectiveByline(book);
                return (
                  <p className="text-base sm:text-lg text-stone-300 mb-1">
                    {heroByline.role === 'author' ? (
                      embedPolicy.enableBookCollectionNavigation && authorUrl(book.author) ? (
                        <Link href={authorUrl(book.author)!} className="hover:text-white transition-colors">
                          <AuthorName author={book.author} />
                        </Link>
                      ) : <AuthorName author={book.author} />
                    ) : heroByline.role === 'editor' ? (
                      <span>edited by <AuthorName author={heroByline.editor} /></span>
                    ) : <AuthorName author={book.author} />}
                    {heroByline.role === 'author' && heroByline.editor && (
                      <span className="text-stone-400 text-sm"> · edited by <AuthorName author={heroByline.editor} /></span>
                    )}
                  </p>
                );
              })()}
              {authorEntity && (
                <AuthorAuthority entity={authorEntity} bookAuthor={book.author} />
              )}
              <h1 className="text-2xl sm:text-3xl font-serif font-bold break-words">{book.display_title || book.title}</h1>
              {book.display_title && book.title !== book.display_title && (
                <p className="text-stone-400 mt-1 italic text-sm sm:text-base">{book.title}</p>
              )}
              {/* Impressum: "Place: Publisher, Year" — same library-card
                  format as BphCatalogBrowser.formatImpressum so the book page
                  and catalogue rows line up. */}
              {(() => {
                const place = book.place_published?.trim();
                const publisher = book.publisher?.trim();
                const year = book.published ? String(book.published).trim() : '';
                const placePub = [place, publisher].filter(Boolean).join(': ');
                const impressum = [placePub, year].filter(Boolean).join(', ');
                if (!impressum) return null;
                return (
                  <p className="text-stone-300 mt-2 text-sm sm:text-base">{impressum}</p>
                );
              })()}

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
                {(book as unknown as { subject_keywords?: string[] }).subject_keywords && (book as unknown as { subject_keywords?: string[] }).subject_keywords!.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(book as unknown as { subject_keywords?: string[] }).subject_keywords!.slice(0, 5).map((tag: string) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs bg-stone-700/50 text-stone-300 rounded-full"
                        title={tag}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {/* Calendar chip carries composition / translation dates that
                    enrich the plain print year shown in the impressum line above.
                    Skip the chip when there's no source_work_dates to add — the
                    print year alone is already in the impressum. */}
                {book.source_work_dates?.length ? (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
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
                    </span>
                  </div>
                ) : null}
                {/* "scans" rather than "pages": the count is of scanned
                    images (IIIF canvases — covers, blanks, endpapers
                    included). Bibliographic pagination ("[8] 240 [12] pp.")
                    will live in a separate field once curators capture it
                    per book. Paul Dijstelberge (BPH) flagged this — none
                    of the displayed page counts matched the real book. */}
                <div
                  className="flex items-center gap-2"
                  title="Scanned images, including covers and blanks. Bibliographic pagination may differ."
                >
                  <FileText className="w-4 h-4" />
                  {totalPages} scans
                </div>
                {embedPolicy.showGalleryImages && imageCount > 0 && (
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
                  <details className="group">
                    <summary className="inline-flex px-2.5 py-1 bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 text-xs font-medium rounded-full border border-accent-gold/30 transition-colors cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      {firstTranslationBadge(book.translation_verification?.disposition, book.language)}
                    </summary>
                    <div className="mt-2 p-3 bg-stone-800/50 rounded-lg border border-stone-700/50 text-xs space-y-2">
                      <p className="text-stone-300">
                        {firstTranslationDescription(book.translation_verification?.disposition)}
                      </p>
                      {book.translation_verification?.reasoning && (
                        <p className="text-stone-400">{book.translation_verification.reasoning}</p>
                      )}
                      {(book.translation_verification?.translations_found?.length ?? 0) > 0 && (
                        <div className="space-y-1">
                          <span className="text-stone-500">Related translations found:</span>
                          {book.translation_verification!.translations_found!.map((t, i: number) => (
                            <p key={i} className="text-stone-400 pl-2">
                              <span className="italic">{t.english_title}</span>
                              {t.translator && t.translator !== 'unknown' && `, trans. ${t.translator}`}
                              {t.pub_year && ` (${t.pub_year})`}
                              {t.completeness && t.completeness !== 'unknown' && <span className="text-stone-500"> [{t.completeness}]</span>}
                              {t.url && (
                                <>{' '}<a href={t.url} target="_blank" rel="noopener noreferrer" className="text-accent-gold hover:text-accent-gold/80 underline">source</a></>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                      {book.translation_verification?.tools_called && (
                        <p className="text-stone-600 text-[10px]">
                          Verified {book.translation_verification.verified_at ? new Date(book.translation_verification.verified_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''} via{' '}
                          {book.translation_verification.tools_called
                            .filter((t: string) => t !== 'make_determination')
                            .map((t: string) => t.replace('search_', '').replace(/_/g, ' '))
                            .join(', ')}
                          {embedPolicy.showExternalLinks && <>{' '}&middot;{' '}<a href="/blog/first-translation-methodology" className="underline hover:text-stone-500">methodology</a></>}
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              )}

              {/* Dedication */}
              <div className="mt-3">
                <BookDedication bookId={book.id} dedication={(book as any).dedication || null} />
              </div>

              {/* Read This Book — first chapter > endpaper-skip fallback */}
              {embedPolicy.showBookReadCta && (() => {
                if (pages.length === 0) return null;
                const bookSlug = book.slug || book.id;
                // Prefer first chapter page if available
                const firstChapterPageId = book.chapters?.length ? (book.chapters as { pageId?: string }[])[0]?.pageId : null;
                const firstChapterPage = firstChapterPageId ? pages.find(p => p.id === firstChapterPageId) : null;
                // Fallback: skip endpapers (2-4 blank pages before title page)
                const skipTo = totalPages >= 20 ? 4 : totalPages >= 10 ? 2 : 0;
                const readPage = firstChapterPage || pages[skipTo] || pages[0];
                return (
                  <div className="mt-5">
                    <Link
                      href={`/book/${bookSlug}/page/${readPage.id}`}
                      className="inline-flex items-center gap-2.5 px-6 py-3 bg-accent-rust hover:bg-accent-rust/90 text-white font-medium rounded-lg transition-colors text-base"
                    >
                      <BookOpen className="w-5 h-5" />
                      Read This Book
                    </Link>
                  </div>
                );
              })()}

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
                      bookId={book.slug || book.id}
                      title={book.title}
                      displayTitle={book.display_title}
                      author={book.author}
                      year={book.published}
                      publisher={book.publisher}
                      placePublished={book.place_published}
                      language={book.language}
                      doi={book.doi}
                      editionVersion={currentEdition?.version}
                      tenantSlug={tenantSlug || undefined}
                      className="text-stone-300 hover:text-white hover:bg-white/10"
                    />
                    <DownloadButton
                      bookId={book.id}
                      bookTitle={book.display_title || book.title}
                      hasTranslations={hasTranslations}
                      hasOcr={hasOcr}
                      hasImages={pages.length > 0}
                      imageRestricted={imageRestricted}
                      imageAccess={imageAccess}
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
                  </div>
                </div>

                {/* Search — separate line */}
                <SearchPanel bookId={book.id} />
              </div>

              {/* Bibliographic Info (includes related editions, attribution) */}
              <BibliographicInfo
                book={book}
                pagesCount={totalPages}
                hasTranslations={translatedCount > 0}
                showTranslationMethodologyLink={embedPolicy.showTranslationMethodologyLink}
                showExternalLinks={embedPolicy.showExternalLinks}
              >
                {embedPolicy.showRelatedEditions && (book as unknown as { work_id?: string }).work_id && (
                  <Suspense fallback={null}>
                    <RelatedEditions bookId={book.id} workId={(book as unknown as { work_id?: string }).work_id!} />
                  </Suspense>
                )}
              </BibliographicInfo>

              {/* BPH catalogue record — side-loaded from Supabase bph_works when
                  this book has a catalogue key. Two key formats:
                  - Printed books: numeric UBN in dublin_core.dc_identifier
                  - Allard Pierson IIIF manuscripts: PH-shelfmark in
                    image_source.shelfmark (e.g. "PH441") — backfilled into
                    bph_works.ubn by scripts/backfill-bph-allard-pierson.mjs */}
              {(() => {
                const dc = (book as { dublin_core?: { dc_identifier?: unknown } }).dublin_core?.dc_identifier;
                const numericUbn = typeof dc === 'string' && /^\d+$/.test(dc)
                  ? dc
                  : Array.isArray(dc) ? dc.find((v): v is string => typeof v === 'string' && /^\d+$/.test(v)) : null;
                const apShelfmark = (book as { image_source?: { shelfmark?: unknown } }).image_source?.shelfmark;
                const apKey = typeof apShelfmark === 'string' && /^PH/.test(apShelfmark.trim()) ? apShelfmark.trim() : null;
                const ubn = numericUbn || apKey;
                if (!ubn) return null;
                return (
                  <Suspense fallback={null}>
                    <BphCatalogueRecord ubn={ubn} />
                  </Suspense>
                );
              })()}

              {/* Cross-reference: artworks by this author (pre-computed).
                  Hidden in embed mode — the pre-computed data is not tenant-filtered,
                  so it can include artworks/books from other tenants. */}
              {embedPolicy.showAuthorCrossReference && (book as any).author_cross_ref && (
                <AuthorCrossReference
                  author={book.author}
                  crossRef={(book as any).author_cross_ref}
                  context="book"
                />
              )}
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
            {/* The whole "About This Book" card is hidden when the visitor
                has scholar mode on (see EmbedUserMenu). Categories are
                AI-assigned, the prose is generated, and the empty states
                are meta-commentary about the AI pipeline — none of it
                belongs on a stripped-down bibliographic page. */}
            <AISection className="card p-6">
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Book</h2>

              {/* Categories */}
              <div className="mb-4 pb-4 border-b border-stone-100">
                <CategoryPicker
                  bookId={book.id}
                  currentCategories={book.categories || []}
                />
              </div>
              {hasSummary ? (
                <>
                  <div className="prose-content max-w-none">
                    {summaryText!.split('\n\n').map((paragraph: string, i: number) => (
                      <p key={i} className="mb-4 last:mb-0">
                        {linkEntities(paragraph, summaryEntities)}
                      </p>
                    ))}
                  </div>
                  {hasTranslations && (
                    <AISection kind="reading-guide">
                      <ExpandableGuide embedPolicy={embedPolicy} bookId={book.id} detailedSummary={bookSummaryObj?.detailed || bookSummaryObj?.abstract} />
                    </AISection>
                  )}
                </>
              ) : hasTranslations ? (
                <p className="text-stone-500 text-sm">
                  No summary yet.{' '}
                  <FeedbackWidget
                    className="text-accent-rust hover:text-accent-gold-dark transition-colors underline underline-offset-2"
                    label="Request one"
                    initialMessage={`I'd like a summary generated for: ${book.display_title || book.title}`}
                  />
                </p>
              ) : (
                <p className="text-stone-500 text-sm">
                  No translation yet.{' '}
                  <FeedbackWidget
                    className="text-accent-rust hover:text-accent-gold-dark transition-colors underline underline-offset-2"
                    label="Request one"
                    initialMessage={`I'd like this book translated: ${book.display_title || book.title}`}
                  />
                </p>
              )}
            </AISection>

            {/* Chapters & Sections */}
            {book.chapters?.length ? (
              <ChaptersDropdown
                chapters={book.chapters as { title: string; titleEn?: string; pageNumber: number; level: number }[]}
                bookSlug={book.slug || book.id}
              />
            ) : null}

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
                  isEmbedded={!embedPolicy.enableBookIndexNavigation}
                />
              );
            })()}

            {/* Gallery Images Preview */}
            {embedPolicy.showGalleryImages && galleryImages.length > 0 && (
              <div className="card p-6 mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Illustrations
                    <span className="text-sm font-normal text-stone-400 ml-2">{imageCount}</span>
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
                    const pageId = img.id.match(/^(.+)[:\-]\d+$/)?.[1];
                    const href = pageId
                      ? `/book/${book.slug || book.id}/page/${pageId}`
                      : `/gallery/image/${img.id}`;
                    return (
                      <Link
                        key={img.id}
                        href={href}
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

            {/* Collections — removed pending redesign; see #1910 */}

            {/* Related Books — pre-computed, zero extra queries */}
            {embedPolicy.showBookRelatedBooks && book.related_books && (book.related_books.direct?.length > 0 || book.related_books.shared?.length > 0) && (
              <RelatedBooks relatedBooks={book.related_books} />
            )}
          </div>
        );
      })()}

      {/* Stats + Pages Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        {/* Overview link — Pages heading is rendered by PagesGrid */}
        {pages.length > 0 && (
          <div className="flex items-center justify-end">
            <Link
              href={`/book/${book.slug || book.id}/overview`}
              className="text-sm text-stone-400 hover:text-accent-gold transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-70">
                <rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="1" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="1" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="8" width="5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Overview
            </Link>
          </div>
        )}
        {(() => {
          const membersOnlyUntil = (book as unknown as { members_only_until?: string }).members_only_until;
          if (membersOnlyUntil && new Date(membersOnlyUntil) > new Date()) {
            return (
              <EarlyAccessGate membersOnlyUntil={membersOnlyUntil}>
                <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} totalPageCount={book.pages_count || pages.length} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />
              </EarlyAccessGate>
            );
          }
          return <BookPagesSection bookId={book.id} bookTitle={book.display_title || book.title} pages={pages} totalPageCount={book.pages_count || pages.length} displayBrightness={(book as unknown as { display_brightness?: number }).display_brightness} />;
        })()}
        <AuthCheck role="inner_circle">
          <BookHistory bookId={book.id} />
        </AuthCheck>
      </main>
    </>
  );
}

export default async function BookDetailPage({ params, isEmbedded = false }: PageProps) {
  const { id, tenant } = await params;
  const embedPolicy = getEmbedUiPolicy(isEmbedded);
  // Use cached tenant lookup instead of headers() to preserve ISR
  const tenantId = await getCachedTenantId(tenant);
  const tenantSlug = tenant;

  return (
    <div className={isEmbedded ? "" : "min-h-screen bg-cream"}>
      {!isEmbedded && <ConditionalSiteHeader variant="light" />}

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
        <BookInfo id={id} tenantId={tenantId} tenantSlug={tenantSlug} embedPolicy={embedPolicy} />
      </Suspense>
      {!isEmbedded && <SignUpCTA />}
    </div>
  );
}
