import { Suspense } from 'react';
import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import { getReadDb } from '@/lib/mongodb';
import { mergedGalleryBrowse } from '@/lib/gallery-merge';
import { headers } from 'next/headers';
import GalleryClient from '@/components/gallery/GalleryClient';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import SignUpCTA from '@/components/auth/SignUpCTA';
import type { GalleryResponse } from '@/lib/api-client/types/gallery';

// Per-tenant cached wrappers. The DB work runs at most once per revalidate
// window per (tenant, bookId) — warm requests skip Mongo entirely. tenantId is
// part of the cache key, so tenant isolation is preserved.
const getGalleryInitial = (tenantId: string | null, bookId?: string) =>
  unstable_cache(
    () => fetchInitialGalleryData(tenantId, bookId),
    ['gallery-initial-v1', tenantId || 'main', bookId || 'all'],
    { revalidate: 3600 },
  )();

const getGalleryFeatured = (tenantId: string | null) =>
  unstable_cache(
    () => fetchFeaturedCollections(tenantId),
    ['gallery-featured-v2', tenantId || 'main'],
    { revalidate: 3600 },
  )();

const getGalleryBookCollections = (tenantId: string | null) =>
  unstable_cache(
    () => fetchBookCollections(tenantId),
    ['gallery-bookcollections-v1', tenantId || 'main'],
    { revalidate: 3600 },
  )();

export const revalidate = 3600; // ISR: rebuild every hour (unfiltered landing only)

const GALLERY_TITLE = 'Image Gallery — Source Library';
const GALLERY_DESCRIPTION = 'Browse illustrations, engravings, woodcuts, alchemical emblems, and diagrams extracted from rare historical texts — searchable by subject, technique, and period.';

export const metadata: Metadata = {
  title: GALLERY_TITLE,
  description: GALLERY_DESCRIPTION,
  alternates: {
    canonical: '/gallery',
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: GALLERY_TITLE,
    description: GALLERY_DESCRIPTION,
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/gallery',
  },
  twitter: {
    card: 'summary_large_image',
    title: GALLERY_TITLE,
    description: GALLERY_DESCRIPTION,
  },
};

interface GalleryPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
      <ConditionalSiteHeader variant="light" />
      <h1 className="sr-only">Image Gallery — Illustrations from Rare Historical Texts</h1>
      <Suspense fallback={<GalleryShell />}>
        <GalleryData searchParams={searchParams} />
      </Suspense>
      <SignUpCTA />

      {/* Classification credits */}
      <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pb-12">
        <p className="text-xs text-stone-400 text-center">
          Image subjects classified using{' '}
          <a href="https://iconclass.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-600">Iconclass</a>
          {' '}and the{' '}
          <a href="https://chineseiconography.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-stone-600">Chinese Iconography Thesaurus</a>
        </p>
      </div>
    </div>
  );
}

async function GalleryData({ searchParams }: GalleryPageProps) {
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  const params = (await searchParams) ?? {};
  const bookIdParam = params.bookId ?? params.book;
  const bookId = typeof bookIdParam === 'string' ? bookIdParam : undefined;

  const [initialData, initialCollections, bookCollections] = await Promise.all([
    getGalleryInitial(tenantId, bookId),
    getGalleryFeatured(tenantId),
    getGalleryBookCollections(tenantId),
  ]);

  return (
    <GalleryClient
      initialData={initialData}
      initialCollections={initialCollections}
      bookCollections={bookCollections}
      initialBookId={bookId}
    />
  );
}

function GalleryShell() {
  return (
    <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-6">
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 mb-6">
        <div className="flex-1 min-w-0 sm:min-w-[200px] max-w-md h-9 bg-stone-200/70 rounded-lg animate-pulse" />
        <div className="min-w-0 sm:min-w-[200px] max-w-sm flex-1 h-9 bg-stone-200/70 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-stone-200/70 rounded-lg animate-pulse" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="aspect-square bg-stone-200/70 rounded-lg animate-pulse" />
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
async function fetchInitialGalleryData(tenantId: string | null, bookId?: string): Promise<GalleryResponse> {
  try {
    const db = await getReadDb();
    const limit = 48;
    const minQuality = 0.7;
    const maxPerBook = 3;

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
    if (!bookId) {
      filter.book_rank = { $lte: maxPerBook };
    } else {
      filter.book_id = bookId;
    }
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
        .sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 })
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
      galleryQuality: doc.gallery_quality as number | undefined,
      confidence: doc.confidence as number | undefined,
      museumDescription: doc.museum_description as string | undefined,
      metadata: doc.metadata,
    }));

    return {
      items: mappedItems,
      total,
      limit,
      offset: 0,
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

/**
 * Fetch all collections for SSR (shown on gallery landing page).
 */
async function fetchFeaturedCollections(tenantId: string | null) {
  try {
    const db = await getReadDb();
    const query: Record<string, unknown> = {};
    if (tenantId) {
      query.tenantId = tenantId;
    }

    const collections = await db.collection('gallery_collections')
      .find(query)
      .sort({ featured: -1, sort_order: 1 })
      .toArray();

    if (collections.length === 0) return undefined;

    // Resolve cover images from gallery_images. Fetch the explicit cover plus a
    // few of each collection's own images, so collections without a (resolvable)
    // cover_image_id fall back to their first available image instead of showing
    // an empty placeholder.
    const FALLBACK_DEPTH = 4;
    const idsToFetch = new Set<string>();
    for (const c of collections) {
      if (c.cover_image_id) idsToFetch.add(c.cover_image_id as string);
      for (const imgId of ((c.image_ids as string[]) || []).slice(0, FALLBACK_DEPTH)) {
        if (imgId) idsToFetch.add(imgId);
      }
    }
    const galleryDocs = idsToFetch.size > 0
      ? await db.collection('gallery_images')
        .find({ id: { $in: [...idsToFetch] } }, { projection: { id: 1, extracted_url: 1, thumbnail_url: 1, description: 1 } })
        .toArray()
      : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const galleryMap = new Map(galleryDocs.map((d: any) => [d.id, d]));
    const coverFrom = (id: string | undefined, fallbackTitle: string) => {
      if (!id) return null;
      const gImg = galleryMap.get(id) as { thumbnail_url?: string; extracted_url?: string; description?: string } | undefined;
      if (!gImg) return null;
      const url = gImg.thumbnail_url || gImg.extracted_url;
      if (!url) return null;
      return { url, description: gImg.description || fallbackTitle };
    };

    const result = await Promise.all(
      collections.map(async (col) => {
        const title = col.title as string;
        // Prefer the explicit cover; otherwise use the collection's own images.
        let coverImage = coverFrom(col.cover_image_id as string | undefined, title);
        if (!coverImage) {
          for (const imgId of ((col.image_ids as string[]) || []).slice(0, FALLBACK_DEPTH)) {
            coverImage = coverFrom(imgId, title);
            if (coverImage) break;
          }
        }
        return {
          id: col.id as string,
          slug: col.slug as string,
          title: col.title as string,
          description: (col.description || '') as string,
          imageCount: (col.image_ids as string[])?.length || 0,
          featured: col.featured as boolean,
          coverImage,
        };
      })
    );

    return result;
  } catch (error) {
    console.error('Failed to fetch featured collections:', error);
    return undefined;
  }
}
