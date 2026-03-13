import { Suspense } from 'react';
import { getDb } from '@/lib/mongodb';
import GalleryClient from '@/components/gallery/GalleryClient';
import SignUpCTA from '@/components/auth/SignUpCTA';
import type { GalleryResponse } from '@/lib/api-client/types/gallery';

export const dynamic = 'force-dynamic';

/**
 * Gallery page — server component that fetches initial data from gallery_images
 * and passes it to the client component for instant rendering.
 */
export default async function GalleryPage() {
  const [initialData, initialCollections] = await Promise.all([
    fetchInitialGalleryData(),
    fetchFeaturedCollections(),
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <Suspense>
        <GalleryClient
          initialData={initialData}
          initialCollections={initialCollections}
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

    const [items, total, typesResult, subjectsResult, yearResult] = await Promise.all([
      db.collection('gallery_images').aggregate([
        { $match: filter },
        { $sample: { size: limit } },
        { $project: { _id: 0 } },
      ]).toArray(),
      db.collection('gallery_images').countDocuments(filter),
      db.collection('gallery_images').aggregate([
        { $group: { _id: '$type' } },
        { $match: { _id: { $ne: null } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('gallery_images').aggregate([
        { $unwind: '$metadata.subjects' },
        { $group: { _id: '$metadata.subjects' } },
        { $sort: { _id: 1 } },
        { $limit: 50 },
      ]).toArray(),
      db.collection('gallery_images').aggregate([
        { $group: { _id: null, minYear: { $min: '$book_year' }, maxYear: { $max: '$book_year' } } },
      ]).toArray(),
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
