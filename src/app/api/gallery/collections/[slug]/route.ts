import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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
      imageCount: imageIds.length,
      items,
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
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const db = await getDb();

    const allowedFields = ['title', 'description', 'image_ids', 'cover_image_id', 'featured', 'sort_order'];
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
}

/**
 * POST /api/gallery/collections/[slug] with ?action=delete
 *
 * Delete a collection (POST because DELETE is globally blocked).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
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
}

/**
 * Resolve gallery image IDs to full item data.
 */
async function resolveImages(db: any, imageIds: string[]) {
  if (imageIds.length === 0) return [];

  const parsed = imageIds.map((id) => {
    const parts = id.split('-');
    const idx = parseInt(parts.pop()!);
    return { id, pageId: parts.join('-'), detIdx: idx };
  });

  const pageIds = [...new Set(parsed.map((p) => p.pageId))];

  const pages = await db
    .collection('pages')
    .aggregate([
      { $match: { id: { $in: pageIds } } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book',
        },
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    ])
    .toArray();

  const pageMap = new Map<string, any>(pages.map((p: any) => [p.id, p]));

  // Return in order of image_ids
  return parsed
    .map(({ id, pageId, detIdx }) => {
      const page = pageMap.get(pageId);
      if (!page) return null;
      const det = page.detected_images?.[detIdx];
      if (!det) return null;

      // Build on-the-fly crop URL when no pre-generated image exists
      const baseUrl = page.archived_photo || page.cropped_photo || page.photo;
      let cropUrl: string | null = null;
      if (det.bbox && baseUrl) {
        const params = new URLSearchParams({
          url: baseUrl,
          x: det.bbox.x.toString(),
          y: det.bbox.y.toString(),
          w: det.bbox.width.toString(),
          h: det.bbox.height.toString(),
        });
        if (det.rotation) params.set('rotation', det.rotation.toString());
        cropUrl = `/api/crop-image?${params}`;
      }

      return {
        id,
        pageId,
        bookId: page.book_id,
        pageNumber: page.page_number,
        detectionIndex: detIdx,
        imageUrl: det.extracted_url || det.thumbnail_url || cropUrl || page.cropped_photo || page.photo,
        bookTitle: page.book?.display_title || page.book?.title || 'Unknown',
        author: page.book?.author,
        year: page.book?.year,
        description: det.description || '',
        type: det.type,
        bbox: det.bbox,
        rotation: det.rotation ?? 0,
        thumbnailUrl: det.thumbnail_url,
        extractedUrl: det.extracted_url,
        galleryQuality: det.gallery_quality,
        museumDescription: det.museum_description,
      };
    })
    .filter(Boolean);
}
