import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { randomUUID } from 'crypto';

export const preferredRegion = 'fra1';

/**
 * GET /api/gallery/collections
 *
 * List all collections, optionally filtered to featured only.
 * ?featured=true — only featured collections
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get('featured') === 'true';
    const type = searchParams.get('type'); // 'visual' | 'thematic'

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (featured) filter.featured = true;
    if (type === 'visual' || type === 'thematic') filter.type = type;

    const collections = await db
      .collection('gallery_collections')
      .find(filter)
      .sort({ sort_order: 1, created_at: -1 })
      .toArray();

    // Resolve cover images
    const coverIds = collections
      .map((c) => c.cover_image_id as string)
      .filter(Boolean);

    const coverPages = await resolveCoverImages(db, coverIds);

    const items = collections.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: c.title,
      description: c.description,
      imageCount: (c.image_ids as string[])?.length || 0,
      featured: c.featured,
      type: c.type || 'visual',
      book_collection_slug: c.book_collection_slug || undefined,
      coverImage: coverPages.get(c.cover_image_id as string) || null,
    }));

    return NextResponse.json({ collections: items, total: items.length }, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (error) {
    console.error('List collections error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list collections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gallery/collections
 *
 * Create a new collection.
 * Body: { title, description, slug?, image_ids, cover_image_id?, featured?, sort_order? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, image_ids, cover_image_id, featured, sort_order, type, book_collection_slug } = body;

    if (!title || !description) {
      return NextResponse.json({ error: 'title and description required' }, { status: 400 });
    }

    const slug =
      body.slug ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    const db = await getDb();

    // Check slug uniqueness
    const existing = await db.collection('gallery_collections').findOne({ slug });
    if (existing) {
      return NextResponse.json({ error: `Collection with slug "${slug}" already exists` }, { status: 409 });
    }

    const doc: Record<string, unknown> = {
      id: randomUUID(),
      slug,
      title,
      description,
      cover_image_id: cover_image_id || (image_ids?.[0] ?? ''),
      image_ids: image_ids || [],
      featured: featured ?? false,
      sort_order: sort_order ?? 0,
      type: type || 'visual',
      created_at: new Date(),
      updated_at: new Date(),
    };
    if (book_collection_slug) doc.book_collection_slug = book_collection_slug;

    await db.collection('gallery_collections').insertOne(doc);

    return NextResponse.json({ success: true, collection: doc });
  } catch (error) {
    console.error('Create collection error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create collection' },
      { status: 500 }
    );
  }
}

/**
 * Resolve cover image IDs to thumbnail URLs.
 */
async function resolveCoverImages(db: any, imageIds: string[]) {
  if (imageIds.length === 0) return new Map<string, { url: string; description: string }>();

  // Parse IDs to get page IDs
  const parsed = imageIds.map((id) => {
    const parts = id.split('-');
    const idx = parseInt(parts.pop()!);
    return { id, pageId: parts.join('-'), detIdx: idx };
  });

  const pageIds = [...new Set(parsed.map((p) => p.pageId))];
  const pages = await db
    .collection('pages')
    .find({ id: { $in: pageIds } }, { projection: { id: 1, detected_images: 1, archived_photo: 1, cropped_photo: 1, photo: 1 } })
    .toArray();

  const pageMap = new Map<string, any>(pages.map((p: any) => [p.id, p]));
  const result = new Map<string, { url: string; description: string }>();

  for (const { id, pageId, detIdx } of parsed) {
    const page = pageMap.get(pageId);
    if (!page) continue;
    const det = page.detected_images?.[detIdx];
    if (!det) continue;

    // Build crop URL when no pre-generated image exists
    let cropUrl: string | null = null;
    if (det.bbox) {
      const baseUrl = page.archived_photo || page.cropped_photo || page.photo;
      if (baseUrl) {
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
    }

    result.set(id, {
      url: det.thumbnail_url || det.extracted_url || cropUrl || page.cropped_photo || page.photo || '',
      description: det.description || '',
    });
  }

  return result;
}
