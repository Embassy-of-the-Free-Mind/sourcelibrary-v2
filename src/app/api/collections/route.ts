import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { createCollection } from '@/lib/create-collection';
import { tagBooksIntoCollection } from '@/lib/collection-tagging';

export const maxDuration = 30;

/**
 * GET /api/collections
 *
 * List all book collections from MongoDB, ordered by display order.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'category' | 'curated' | null (all)
    const slug = searchParams.get('slug'); // exact-match lookup by slug
    const includeUnpublished = searchParams.get('unpublished') === 'true';
    const includeChildren = searchParams.get('includeChildren') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '500', 10), 1000);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    // Read tenant context resolved by proxy.ts
    const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(request);
    if (tenantSlug && !tenantId) {
      return NextResponse.json({ collections: [] });
    }

    const db = await getDb();
    const filter: Record<string, unknown> = {
      collection_type: { $ne: 'visual_art' },
    };
    if (tenantId) filter.tenantId = tenantId;
    if (!includeChildren) {
      filter.parent = { $exists: false };
    }

    if (type) {
      filter.type = type;
    }
    if (slug) {
      filter.slug = slug;
    }

    // Curated collections have a published flag — hide unpublished by default
    if (!includeUnpublished) {
      filter.$or = [
        { type: { $ne: 'curated' } },
        { type: 'curated', published: true },
      ];
    }

    const collections = await db
      .collection('collections')
      .find(filter)
      .sort({ order: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const cleaned = collections.map(({ _id, ...rest }: any) => ({
      ...rest,
    }));

    return NextResponse.json({ collections: cleaned });
  } catch (error) {
    console.error('Collections list error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/collections
 *
 * Create a new collection and tag books with its slug.
 * Body: { slug, name, subtitle, description, color, order, bookIds: string[] }
 * bookIds can be ObjectId strings or book `id` fields.
 */
/**
 * PATCH /api/collections
 *
 * Update a collection by slug.
 * Body: { slug, ...fields to update }
 */
export const PATCH = withAuth(async (request) => {
  try {
    const body = await request.json();
    const { slug, addBookIds, ...updates } = body;

    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const db = await getDb();

    // Tag new books with this collection slug
    let booksTagged = 0;
    if (addBookIds?.length) {
      const bookObjectIds = addBookIds.map((id: string) => {
        try { return new ObjectId(id); } catch { return null; }
      }).filter(Boolean);

      const tagResult = await tagBooksIntoCollection(db, slug, {
        $or: [{ _id: { $in: bookObjectIds } }, { id: { $in: addBookIds } }],
      });
      booksTagged = tagResult.changedCount;

      // Update book_count on collection (same filter as detail page)
      const bookCount = await db.collection('books').countDocuments({
        collections: slug,
        visible: true,
        pages_count: { $gt: 0 },
      });
      updates.book_count = bookCount;
    }

    const result = await db.collection('collections').findOneAndUpdate(
      { slug },
      { $set: { ...updates, updated_at: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: `Collection "${slug}" not found` }, { status: 404 });
    }

    return NextResponse.json({ success: true, collection: result, books_tagged: booksTagged });
  } catch (error) {
    console.error('Collection update error:', error);
    return NextResponse.json(
      { error: 'Failed to update collection' },
      { status: 500 }
    );
  }
});

export const POST = withAuth(async (request) => {
  try {
    const body = await request.json();
    const { slug, name, subtitle, description, color, order, bookIds } = body;

    const result = await createCollection({ slug, name, subtitle, description, color, order, bookIds });

    return NextResponse.json({
      success: true,
      collection: result.collection,
      books_tagged: result.booksTagged,
      books_found: result.booksFound,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'invalid') {
      return NextResponse.json({ error: 'slug and name are required' }, { status: 400 });
    }
    if (code === 'exists') {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    }
    console.error('Collection create error:', error);
    return NextResponse.json(
      { error: 'Failed to create collection' },
      { status: 500 }
    );
  }
});
