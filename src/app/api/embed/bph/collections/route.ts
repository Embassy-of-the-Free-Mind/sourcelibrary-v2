import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/embed/bph/collections
 *
 * List BPH collection areas with item counts.
 * These are the subject categories that BPH books are tagged with.
 *
 * Query params:
 *   slug - get a single collection area with its books
 *   limit - books per collection when slug is provided (default 24, max 100)
 *   offset - pagination offset for books
 *
 * Returns: { collections: [{ slug, name, description, item_count, image }] }
 * Or with ?slug=X: { collection: { slug, name, description, item_count, books: [...] } }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');

    const db = await getReadDb();

    if (slug) {
      // Single collection detail with paginated books
      const limit = Math.min(parseInt(searchParams.get('limit') || '24'), 100);
      const offset = parseInt(searchParams.get('offset') || '0');
      const sort = searchParams.get('sort') || 'title';

      const collection = await db.collection('collections').findOne({ slug });
      if (!collection) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404, headers: CORS_HEADERS });
      }

      const bookFilter = {
        held_by: 'bph',
        visible: true,
        pages_count: { $gt: 0 },
        categories: slug,
      };

      let sortSpec: Record<string, 1 | -1> = { title: 1 };
      switch (sort) {
        case 'date_asc': sortSpec = { year: 1 }; break;
        case 'date_desc': sortSpec = { year: -1 }; break;
        default: sortSpec = { title: 1 };
      }

      const [books, total] = await Promise.all([
        db.collection('books')
          .find(bookFilter)
          .project({
            _id: 0, id: 1, slug: 1, title: 1, display_title: 1,
            author: 1, language: 1, published: 1, year: 1,
            pages_count: 1, pages_translated: 1,
            thumbnail: 1, thumbnail_blob: 1, image_display: 1, image_thumb: 1,
          })
          .sort(sortSpec)
          .skip(offset)
          .limit(limit)
          .maxTimeMS(8000)
          .toArray(),
        db.collection('books').countDocuments(bookFilter),
      ]);

      const cleanedBooks = books.map(b => ({
        id: b.id,
        slug: b.slug || b.id,
        title: b.title,
        display_title: b.display_title,
        author: b.author,
        language: b.language,
        published: b.published,
        year: b.year,
        pages_count: b.pages_count,
        pages_translated: b.pages_translated || 0,
        thumbnail: b.image_thumb || b.image_display || b.thumbnail_blob || b.thumbnail,
        url: `/book/${b.slug || b.id}`,
      }));

      return NextResponse.json({
        collection: {
          slug: collection.slug,
          name: collection.name,
          description: collection.description || null,
          subtitle: collection.subtitle || null,
          image: collection.featured_images?.[0] || null,
          item_count: total,
          books: cleanedBooks,
          total,
          limit,
          offset,
        },
      }, { headers: CORS_HEADERS });
    }

    // List all collection areas that have BPH books
    const collections = await db.collection('collections')
      .find({ collection_type: { $ne: 'visual_art' } })
      .sort({ order: 1 })
      .toArray();

    // Count BPH books in each collection
    const bphBooks = db.collection('books');
    const collectionsWithCounts: Array<{ slug: string; name: string; description?: string; subtitle?: string; featured_images?: unknown[]; bph_count: number }> = [];
    for (const col of collections) {
      const count = await bphBooks.countDocuments({
        held_by: 'bph',
        visible: true,
        pages_count: { $gt: 0 },
        categories: col.slug,
      });
      if (count > 0) {
        collectionsWithCounts.push({
          slug: col.slug as string,
          name: col.name as string,
          description: col.description as string | undefined,
          subtitle: col.subtitle as string | undefined,
          featured_images: col.featured_images as unknown[] | undefined,
          bph_count: count,
        });
      }
    }

    const filtered = collectionsWithCounts.map(c => ({
      slug: c.slug,
      name: c.name,
      description: c.description || null,
      subtitle: c.subtitle || null,
      image: c.featured_images?.[0] || null,
      item_count: c.bph_count,
    }));

    return NextResponse.json({ collections: filtered }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('BPH collections error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collections' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
