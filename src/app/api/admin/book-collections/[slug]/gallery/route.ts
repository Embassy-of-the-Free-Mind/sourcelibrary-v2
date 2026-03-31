import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/admin/book-collections/[slug]/gallery
 *
 * Returns top gallery images from books in this collection,
 * marking which ones are already in curated_gallery.
 */
export const GET = withAuth(async (req: NextRequest, _session: Session, context?: any) => {
  try {
    const { slug } = await context.params;
    const db = await getDb();

    const collection = await db.collection('collections').findOne({ slug });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // Get all book IDs in this collection
    const books = await db.collection('books').find(
      { collections: slug, visible: true },
      { projection: { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1 } }
    ).toArray();

    const bookIds = books.map(b => b.id);
    const bookSlugMap = new Map(books.map(b => [b.id, b.slug]));

    if (bookIds.length === 0) {
      return NextResponse.json({ candidates: [], curated: [] });
    }

    // Fetch top gallery images sorted by quality
    const images = await db.collection('gallery_images')
      .find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.7 },
        $or: [
          { extracted_url: { $type: 'string', $gt: '' } },
          { thumbnail_url: { $type: 'string', $gt: '' } },
        ],
      })
      .sort({ gallery_quality: -1 })
      .limit(200)
      .toArray();

    // Current curated set (IDs)
    const curatedSet = new Set(
      (collection.curated_gallery || []).map((img: { id: string }) => img.id)
    );

    const candidates = images.map(img => ({
      id: `${img.page_id}-${img.detection_index}`,
      image_url: img.extracted_url || img.thumbnail_url,
      type: img.type || '',
      museum_description: img.museum_description || img.description || '',
      book_title: img.book_title || '',
      book_id: img.book_id,
      book_slug: bookSlugMap.get(img.book_id) || '',
      gallery_quality: img.gallery_quality,
      curated: curatedSet.has(`${img.page_id}-${img.detection_index}`),
    }));

    return NextResponse.json({
      collection: {
        slug: collection.slug,
        name: collection.name,
        book_count: collection.book_count || 0,
        curated_count: curatedSet.size,
      },
      candidates,
    });
  } catch (error) {
    console.error('Book collection gallery error:', error);
    return NextResponse.json({ error: 'Failed to fetch gallery' }, { status: 500 });
  }
});

/**
 * POST /api/admin/book-collections/[slug]/gallery
 *
 * Save curated_gallery selection for a book collection.
 * Body: { curated_ids: string[] } — IDs to include in the curated pool.
 */
export const POST = withAuth(async (req: NextRequest, _session: Session, context?: any) => {
  try {
    const { slug } = await context.params;
    const { curated_ids } = await req.json();

    if (!Array.isArray(curated_ids)) {
      return NextResponse.json({ error: 'curated_ids must be an array' }, { status: 400 });
    }

    const db = await getDb();
    const collection = await db.collection('collections').findOne({ slug });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // Get all book IDs in this collection
    const books = await db.collection('books').find(
      { collections: slug, visible: true },
      { projection: { _id: 0, id: { $ifNull: ['$id', { $toString: '$_id' }] }, slug: 1 } }
    ).toArray();
    const bookIds = books.map(b => b.id);
    const bookSlugMap = new Map(books.map(b => [b.id, b.slug]));

    // Resolve image IDs to full data
    // Image IDs are in format "pageId-detectionIndex"
    const pageIds = curated_ids.map(id => id.split('-').slice(0, -1).join('-'));
    const images = await db.collection('gallery_images')
      .find({
        page_id: { $in: pageIds },
        book_id: { $in: bookIds },
      })
      .toArray();

    // Build curated gallery entries
    const imageMap = new Map(
      images.map(img => [`${img.page_id}-${img.detection_index}`, img])
    );

    const curatedGallery = curated_ids
      .map(id => imageMap.get(id))
      .filter(Boolean)
      .map(img => ({
        id: `${img!.page_id}-${img!.detection_index}`,
        image_url: img!.extracted_url || img!.thumbnail_url,
        type: img!.type || '',
        museum_description: img!.museum_description || img!.description || '',
        book_title: img!.book_title || '',
        book_id: img!.book_id,
        book_slug: bookSlugMap.get(img!.book_id) || '',
        gallery_quality: img!.gallery_quality,
      }));

    await db.collection('collections').updateOne(
      { slug },
      { $set: { curated_gallery: curatedGallery, curated_gallery_updated: new Date() } }
    );

    return NextResponse.json({
      saved: curatedGallery.length,
      message: `Saved ${curatedGallery.length} curated images for ${collection.name}`,
    });
  } catch (error) {
    console.error('Save curated gallery error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
});
