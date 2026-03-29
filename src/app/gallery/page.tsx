import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import GalleryClient from '@/components/gallery/GalleryClient';
import SignUpCTA from '@/components/auth/SignUpCTA';
import type { GalleryResponse } from '@/lib/api-client/types/gallery';

export const revalidate = 3600; // ISR: rebuild every hour

/**
 * Gallery page — server component that fetches initial data from gallery_images
 * and passes it to the client component for instant rendering.
 */
export default async function GalleryPage() {
  const [initialData, initialCollections, bookCollections] = await Promise.all([
    fetchInitialGalleryData(),
    fetchFeaturedCollections(),
    fetchBookCollections(),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <Suspense>
        <GalleryClient
          initialData={initialData}
          initialCollections={initialCollections}
          bookCollections={bookCollections}
        />
      </Suspense>
      <SignUpCTA />
    </div>
  );
}

/**
 * Fetch first page of gallery data directly from MongoDB (no API roundtrip).
 */
async function fetchInitialGalleryData(): Promise<GalleryResponse> {
  try {
    const db = await getDb();
    const limit = 24;
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

    const filter = {
      gallery_quality: { $gte: minQuality },
      book_rank: { $lte: maxPerBook },
      book_hidden: { $ne: true },
    };

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
      ]).toArray() as { _id: string }[];
      yearResult = [{ minYear: 1400, maxYear: 1900 }];
    }

    const [items, total] = await Promise.all([
      db.collection('gallery_images')
        .find(filter, { projection: { _id: 0 } })
        .sort({ gallery_quality: -1, book_year: 1, book_id: 1, page_number: 1 })
        .limit(limit)
        .toArray(),
      db.collection('gallery_images').estimatedDocumentCount(),
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
      bookInfo: null,
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
 * Fetch book collections for the collection filter dropdown.
 */
async function fetchBookCollections() {
  try {
    const db = await getDb();
    const collections = await db.collection('collections')
      .find({ book_count: { $gte: 1 } })
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
async function fetchFeaturedCollections() {
  try {
    const db = await getDb();
    const collections = await db.collection('gallery_collections')
      .find({})
      .sort({ featured: -1, sort_order: 1 })
      .toArray();

    if (collections.length === 0) return undefined;

    // Resolve cover images — use gallery_images (always populated) with pages fallback
    const coverImageIds = collections
      .map((c) => c.cover_image_id as string)
      .filter(Boolean);
    const galleryDocs = coverImageIds.length > 0
      ? await db.collection('gallery_images')
          .find({ id: { $in: coverImageIds } }, { projection: { id: 1, extracted_url: 1, thumbnail_url: 1, description: 1 } })
          .toArray()
      : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const galleryMap = new Map(galleryDocs.map((d: any) => [d.id, d]));

    const result = await Promise.all(
      collections.map(async (col) => {
        let coverImage: { url: string; description: string } | null = null;
        if (col.cover_image_id) {
          const gImg = galleryMap.get(col.cover_image_id as string);
          if (gImg) {
            coverImage = {
              url: (gImg as { extracted_url?: string; thumbnail_url?: string }).extracted_url
                || (gImg as { thumbnail_url?: string }).thumbnail_url || '',
              description: (gImg as { description?: string }).description || col.title as string,
            };
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
