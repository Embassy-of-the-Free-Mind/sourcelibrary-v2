import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { getReadDb } from '@/lib/mongodb';
import { mergedGalleryBrowse } from '@/lib/gallery-merge';
import { headers } from 'next/headers';
import GalleryClient from '@/components/gallery/GalleryClient';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import type { GalleryResponse } from '@/lib/api-client/types/gallery';
import { BOOK_VIEW_PAGE_SIZE, bookViewHref, bookViewPageLinks, parseBookViewPage } from '@/lib/gallery-book-view';

// Per-tenant cached wrappers. The DB work runs at most once per revalidate
// window per (tenant, bookId, page) — warm requests skip Mongo entirely. tenantId
// is part of the cache key, so tenant isolation is preserved.
const getGalleryInitial = (tenantId: string | null, bookId?: string, page = 1) =>
  unstable_cache(
    () => fetchInitialGalleryData(tenantId, bookId, page),
    ['gallery-initial-v3', tenantId || 'main', bookId || 'all', String(page)],
    { revalidate: 3600 },
  )();

const getGalleryBookCollections = (tenantId: string | null) =>
  unstable_cache(
    () => fetchBookCollections(tenantId),
    ['gallery-bookcollections-v1', tenantId || 'main'],
    { revalidate: 3600 },
  )();

export const revalidate = 3600; // ISR: rebuild every hour (unfiltered landing only)

const GALLERY_TITLE = 'Image Gallery | Source Library';
const GALLERY_DESCRIPTION = 'Browse illustrations, engravings, woodcuts, alchemical emblems, and diagrams extracted from rare historical texts, searchable by subject, technique, and period.';

const metadata: Metadata = {
  title: GALLERY_TITLE,
  description: GALLERY_DESCRIPTION,
  alternates: {
    canonical: '/gallery',
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image-gallery.jpg', width: 1600, height: 840, alt: 'Illustrations from rare books in the Source Library gallery' }],
    title: GALLERY_TITLE,
    description: GALLERY_DESCRIPTION,
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/gallery',
  },
  twitter: {
    card: 'summary_large_image',
    images: ['https://sourcelibrary.org/og-image-gallery.jpg'],
    title: GALLERY_TITLE,
    description: GALLERY_DESCRIPTION,
  },
};

interface GalleryPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** The one book a request is for, and which page of its pictures. */
function bookViewFrom(params: Record<string, string | string[] | undefined>) {
  const raw = params.bookId ?? params.book;
  const bookId = typeof raw === 'string' && raw ? raw : undefined;
  return { bookId, page: bookId ? parseBookViewPage(params.page) : 1 };
}

/**
 * One book's pictures are their own page, and a crawler's way to them: declaring
 * /gallery as canonical called this a duplicate of a page with none of its links.
 * An id with no pictures keeps the plain metadata.
 */
export async function generateMetadata({ searchParams }: GalleryPageProps): Promise<Metadata> {
  const { bookId, page } = bookViewFrom((await searchParams) ?? {});
  if (!bookId) return metadata;
  const data = await getGalleryInitial((await headers()).get('x-tenant-id'), bookId, page);
  if (!data.bookInfo || data.items.length === 0) return metadata;
  const title = `Illustrations from ${data.bookInfo.title}${page > 1 ? `, page ${page}` : ''} | Source Library`;
  return {
    ...metadata,
    title,
    alternates: { canonical: bookViewHref(bookId, page) },
    openGraph: { ...metadata.openGraph, title, url: bookViewHref(bookId, page) },
    twitter: { ...metadata.twitter, title },
  };
}

/**
 * Gallery page — server component that fetches initial data from gallery_images
 * and passes it to the client component for instant rendering.
 *
 * When `?bookId=` is present we pre-filter on the server so the user sees the
 * right images on first paint — otherwise the client used to render 24 generic
 * thumbnails, hydrate, then refetch with the filter (visible flash + wasted
 * image loads). Accessing searchParams marks the page dynamic for filtered
 * requests; the unfiltered landing stays ISR-cached.
 */
export default function GalleryPage({ searchParams }: GalleryPageProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      {/* Header renders instantly; the data-heavy grid streams in below. */}
      <ConditionalSiteHeader variant="dark" />
      <div className="max-w-[var(--container-wide)] mx-auto px-4 sm:px-6 md:px-12 pt-6 md:pt-11 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl md:text-4xl font-display text-primary">The Gallery</h1>
        {/* The curated image collections have their own page, as the book collections do. */}
        <Link href="/gallery/collections" className="text-[13px] sm:text-sm text-secondary underline decoration-border-medium underline-offset-[3px] hover:text-primary whitespace-nowrap">
          Image collections
        </Link>
      </div>
      <Suspense fallback={<GalleryShell />}>
        <GalleryData searchParams={searchParams} />
      </Suspense>
      <SignUpCTA />

    </div>
  );
}

async function GalleryData({ searchParams }: GalleryPageProps) {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const params = (await searchParams) ?? {};
  const { bookId, page } = bookViewFrom(params);

  const [initialData, bookCollections] = await Promise.all([
    getGalleryInitial(tenantId, bookId, page),
    getGalleryBookCollections(tenantId),
  ]);
  const pageLinks = bookId ? bookViewPageLinks(initialData.total ?? 0, page) : [];

  return (
    <>
      <GalleryClient
        initialData={initialData}
        bookCollections={bookCollections}
        initialBookId={bookId}
      />
      {/* The pagination on screen is buttons, which a crawler cannot follow. Same device
          as the citation line on reader pages: for machines, and no second control. */}
      {pageLinks.length > 0 && (
        <nav aria-label="All pages of this book's pictures" className="sr-only">
          {pageLinks.map(n => (
            <a key={n} href={bookViewHref(bookId as string, n)} aria-current={n === page ? 'page' : undefined}>
              Pictures, page {n}
            </a>
          ))}
        </nav>
      )}
    </>
  );
}

function GalleryShell() {
  // The controls' shape (two bars, a numbers line, the tools row) so nothing jumps when they arrive.
  return (
    <div className="max-w-[var(--container-wide)] mx-auto px-4 sm:px-6 md:px-12 pt-4 md:pt-[26px] pb-6" aria-hidden>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-7">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="h-3.5 w-32 bg-stone-200/70 mb-2" />
            <div className="h-10 sm:h-[52px] bg-white border border-border-light" />
            <div className="h-3 w-56 bg-stone-200/60 mt-2.5" />
          </div>
        ))}
      </div>
      <div className="h-4 w-64 bg-stone-200/60 mt-6" />
      <div className="h-9 w-40 bg-white border border-border-light mt-4" />
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-4 mt-8">
        {Array.from({ length: 15 }).map((_, i) => (
          <div key={i} className="bg-stone-200/70 animate-pulse" style={{ aspectRatio: i % 3 === 0 ? '3 / 4' : i % 3 === 1 ? '1 / 1' : '4 / 5' }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Fetch first page of gallery data directly from MongoDB (no API roundtrip).
 * When `bookId` is provided we drop the per-book rank cap so all of that
 * book's images show up immediately, and we resolve bookInfo for the header.
 */
async function fetchInitialGalleryData(tenantId: string | null, bookId?: string, page = 1): Promise<GalleryResponse> {
  try {
    const db = await getReadDb();
    const limit = bookId ? BOOK_VIEW_PAGE_SIZE : 48;
    const offset = (page - 1) * limit;
    const minQuality = 0.7;
    const maxPerBook = 1000; // uncapped: variety comes from the book_rank sort

    // Check if materialized collection exists
    const galleryCount = await db.collection('gallery_images').estimatedDocumentCount();

    if (galleryCount === 0) {
      // Return empty result — client will fetch from API with legacy fallback
      return {
        items: [],
        total: 0,
        limit,
        offset: 0,
        bookInfo: null,
        filters: { types: [], subjects: [], yearRange: { minYear: null, maxYear: null } },
      };
    }

    const filter: Record<string, unknown> = {
      gallery_quality: { $gte: minQuality },
      book_visible: true,
      extracted_url: { $ne: null },
      image_url: { $ne: null },
    };
    if (bookId) filter.book_id = bookId;
    if (tenantId) {
      filter.tenantId = tenantId;
    }

    // Read pre-computed filters from system_config (subjects/year aggs take 20-40s on Atlas)
    let typesResult: { _id: string }[] = [];
    let subjectsResult: { _id: string }[] = [];
    let yearResult: { minYear: number | null; maxYear: number | null }[] = [];

    const cachedFiltersDoc = await db.collection('system_config').findOne({ _id: 'gallery_filters' } as any);
    if (cachedFiltersDoc?.data) {
      typesResult = (cachedFiltersDoc.data.types || []).map((t: string) => ({ _id: t }));
      subjectsResult = (cachedFiltersDoc.data.subjects || []).map((s: string) => ({ _id: s }));
      yearResult = [cachedFiltersDoc.data.yearRange || { minYear: 1400, maxYear: 1900 }];
    } else {
      typesResult = await db.collection('gallery_images').aggregate([
        { $group: { _id: '$type' } },
        { $match: { _id: { $ne: null } } },
        { $sort: { _id: 1 } },
      ], { maxTimeMS: 10000 }).toArray() as { _id: string }[];
      yearResult = [{ minYear: 1400, maxYear: 1900 }];
    }

    const sharedFilters = {
      types: typesResult.map(t => t._id as string).filter(Boolean),
      subjects: subjectsResult.map(s => s._id as string).filter(Boolean),
      yearRange: (yearResult[0] as { minYear: number | null; maxYear: number | null }) || { minYear: null, maxYear: null },
    };

    // Plain gallery (no single book): first paint is the MERGED feed (plates +
    // standalone artworks), matching the client's default 'all' source.
    if (!bookId) {
      const merged = await mergedGalleryBrowse(db, { tenantId, source: 'all', limit, offset: 0, minQuality, maxPerBook });
      return {
        items: merged.items, total: merged.total, hasMore: merged.hasMore, limit, offset: 0, bookInfo: null,
        filters: { ...sharedFilters, sources: ['illustration', 'artwork'] },
      };
    }

    const [items, total, bookInfo] = await Promise.all([
      db.collection('gallery_images')
        .find(filter, { projection: { _id: 0 } })
        .sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1, detection_index: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('gallery_images').countDocuments(filter),
      bookId ? fetchBookInfoForGallery(db, bookId, tenantId) : Promise.resolve(null),
    ]);

    const mappedItems = items.map(doc => ({
      pageId: doc.page_id as string,
      bookId: doc.book_id as string,
      pageNumber: doc.page_number as number,
      detectionIndex: doc.detection_index as number,
      imageUrl: doc.image_url as string,
      bookTitle: doc.book_title as string,
      author: doc.book_author as string | undefined,
      year: doc.book_year as number | undefined,
      description: (doc.description || '') as string,
      type: doc.type as string | undefined,
      bbox: doc.bbox,
      rotation: doc.rotation,
      extractedUrl: doc.extracted_url as string | undefined,
      thumbnailUrl: doc.thumbnail_url as string | undefined,
      cardUrl: (doc.card_url || undefined) as string | undefined,
      galleryQuality: doc.gallery_quality as number | undefined,
      confidence: doc.confidence as number | undefined,
      museumDescription: doc.museum_description as string | undefined,
      metadata: doc.metadata,
    }));

    return {
      items: mappedItems,
      total,
      limit,
      offset,
      bookInfo,
      filters: {
        types: typesResult.map(t => t._id as string).filter(Boolean),
        subjects: subjectsResult.map(s => s._id as string).filter(Boolean),
        yearRange: (yearResult[0] as { minYear: number | null; maxYear: number | null }) || { minYear: null, maxYear: null },
      },
    };
  } catch (error) {
    console.error('Failed to fetch initial gallery data:', error);
    return {
      items: [],
      total: 0,
      limit: 24,
      offset: 0,
      bookInfo: null,
      filters: { types: [], subjects: [], yearRange: { minYear: null, maxYear: null } },
    };
  }
}

/**
 * Resolve the bookInfo header shown when the gallery is filtered to one book.
 * Mirrors the API's getBookInfo so the SSR payload matches the client refetch.
 */
async function fetchBookInfoForGallery(
  db: Awaited<ReturnType<typeof getReadDb>>,
  bookId: string,
  tenantId: string | null,
) {
  try {
    const scope = tenantId ? { tenantId } : {};
    const book = await db.collection('books').findOne(
      { id: bookId, ...scope },
      { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, pages_count: 1 }, maxTimeMS: 5000 },
    );
    if (!book) return null;

    const [hasOcr, hasImages] = await Promise.all([
      db.collection('pages').countDocuments({
        ...scope,
        book_id: bookId,
        'ocr.data': { $exists: true, $ne: '' },
      }, { maxTimeMS: 5000 }),
      db.collection('pages').countDocuments({
        ...scope,
        book_id: bookId,
        'detected_images.0': { $exists: true },
      }, { maxTimeMS: 5000 }),
    ]);

    return {
      id: book.id as string,
      slug: book.slug as string | undefined,
      title: (book.display_title || book.title) as string,
      author: book.author as string | undefined,
      year: book.year as number | undefined,
      pagesCount: book.pages_count as number | undefined,
      hasOcr: hasOcr > 0,
      ocrPageCount: hasOcr,
      hasImages: hasImages > 0,
      imagesPageCount: hasImages,
    };
  } catch (error) {
    console.error('Failed to fetch gallery bookInfo:', error);
    return null;
  }
}

/**
 * Fetch book collections for the collection filter dropdown.
 */
async function fetchBookCollections(tenantId: string | null) {
  try {
    const db = await getReadDb();
    const query: Record<string, unknown> = { book_count: { $gte: 1 } };
    if (tenantId) {
      query.tenantId = tenantId;
    }

    const collections = await db.collection('collections')
      .find(query)
      .sort({ parent: 1, order: 1, name: 1 })
      .project({ _id: 0, slug: 1, name: 1, book_count: 1, parent: 1 })
      .toArray();
    return collections as Array<{ slug: string; name: string; book_count: number; parent?: string }>;
  } catch (error) {
    console.error('Failed to fetch book collections:', error);
    return [];
  }
}
