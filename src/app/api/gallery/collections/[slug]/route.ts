import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

export const preferredRegion = 'fra1';

/**
 * GET /api/gallery/collections/[slug]
 *
 * Get a single collection with resolved image data.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = await getDb();

    const collection = await db.collection('gallery_collections').findOne({ slug });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // Resolve all image IDs to gallery items
    const imageIds = (collection.image_ids as string[]) || [];
    const items = await resolveImages(db, imageIds);

    return NextResponse.json({
      id: collection.id,
      slug: collection.slug,
      title: collection.title,
      description: collection.description,
      featured: collection.featured,
      type: collection.type || 'visual',
      book_collection_slug: collection.book_collection_slug || undefined,
      // Count what we actually deliver — image_ids can dangle after
      // gallery_images deletions, and claiming 200 while items is [] misleads
      // API consumers (issue #4486: musical-scores did exactly that).
      imageCount: items.length,
      items,
    }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('Get collection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get collection' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/gallery/collections/[slug]
 *
 * Update collection fields.
 */
export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { slug } = await context.params;
    const body = await request.json();
    const db = await getDb();

    const allowedFields = ['title', 'description', 'image_ids', 'cover_image_id', 'featured', 'sort_order', 'type', 'book_collection_slug'];
    const update: Record<string, unknown> = { updated_at: new Date() };

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        update[field] = body[field];
      }
    }

    const result = await db.collection('gallery_collections').updateOne(
      { slug },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update collection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update collection' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/gallery/collections/[slug] with ?action=delete
 *
 * Delete a collection (POST because DELETE is globally blocked).
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { slug } = await context.params;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action !== 'delete') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const db = await getDb();
    const result = await db.collection('gallery_collections').deleteOne({ slug });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete collection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete collection' },
      { status: 500 }
    );
  }
});

/**
 * Resolve gallery image IDs to full item data.
 * Reads from the flat gallery_images collection (materialized, fast)
 * instead of pages+books $lookup (slow, can be out of sync).
 */
async function resolveImages(db: any, imageIds: string[]) {
  if (imageIds.length === 0) return [];

  const docs = await db
    .collection('gallery_images')
    .find({ id: { $in: imageIds } })
    .toArray();

  const docMap = new Map<string, any>(docs.map((d: any) => [d.id, d]));

  // Return in order of image_ids, skip any that weren't found
  return imageIds
    .map((id) => {
      const doc = docMap.get(id);
      if (!doc) return null;

      return {
        id: doc.id,
        pageId: doc.page_id,
        bookId: doc.book_id,
        pageNumber: doc.page_number,
        detectionIndex: doc.detection_index,
        imageUrl: doc.extracted_url || doc.thumbnail_url || doc.image_url,
        bookTitle: doc.book_title || 'Unknown',
        author: doc.book_author,
        year: doc.book_year,
        description: doc.description || '',
        type: doc.type,
        bbox: doc.bbox,
        rotation: doc.rotation ?? 0,
        thumbnailUrl: doc.thumbnail_url,
        extractedUrl: doc.extracted_url,
        galleryQuality: doc.gallery_quality,
        museumDescription: doc.museum_description,
      };
    })
    .filter(Boolean);
}
