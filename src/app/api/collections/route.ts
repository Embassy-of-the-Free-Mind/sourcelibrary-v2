import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const maxDuration = 30;

/**
 * GET /api/collections
 *
 * List all book collections from MongoDB, ordered by display order.
 */
export async function GET() {
  try {
    const db = await getDb();
    const collections = await db
      .collection('collections')
      .find({})
      .sort({ order: 1 })
      .toArray();

    const cleaned = collections.map(({ _id, ...rest }) => rest);

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
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, ...updates } = body;

    if (!slug) {
      return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    const db = await getDb();
    const result = await db.collection('collections').findOneAndUpdate(
      { slug },
      { $set: { ...updates, updated_at: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: `Collection "${slug}" not found` }, { status: 404 });
    }

    return NextResponse.json({ success: true, collection: result });
  } catch (error) {
    console.error('Collection update error:', error);
    return NextResponse.json(
      { error: 'Failed to update collection' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, name, subtitle, description, color, order, bookIds } = body;

    if (!slug || !name) {
      return NextResponse.json({ error: 'slug and name are required' }, { status: 400 });
    }

    const db = await getDb();

    // Check if collection already exists
    const existing = await db.collection('collections').findOne({ slug });
    if (existing) {
      return NextResponse.json({ error: `Collection "${slug}" already exists` }, { status: 409 });
    }

    // Find books by ObjectId or string id
    const bookObjectIds = (bookIds || []).map((id: string) => {
      try { return new ObjectId(id); } catch { return null; }
    }).filter(Boolean);

    const books = await db.collection('books').find({
      $or: [
        { _id: { $in: bookObjectIds } },
        { id: { $in: bookIds || [] } },
      ],
    }, { projection: { _id: 1, id: 1, title: 1, language: 1 } }).toArray();

    // Tag books with collection slug
    const bookMongoIds = books.map(b => b._id);
    if (bookMongoIds.length > 0) {
      await db.collection('books').updateMany(
        { _id: { $in: bookMongoIds } },
        { $addToSet: { collections: slug } }
      );
    }

    // Compute language breakdown
    const langCounts: Record<string, number> = {};
    for (const b of books) {
      const lang = b.language || 'Unknown';
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    const languages = Object.entries(langCounts)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);

    // Create collection record
    const now = new Date();
    const collectionDoc = {
      slug,
      name,
      subtitle: subtitle || '',
      description: description || '',
      color: color || 'gold',
      order: order ?? 99,
      book_count: books.length,
      languages,
      featured_images: [],
      created_at: now,
      updated_at: now,
    };

    await db.collection('collections').insertOne(collectionDoc);

    return NextResponse.json({
      success: true,
      collection: collectionDoc,
      books_tagged: books.length,
      books_found: books.map(b => ({ id: b.id, title: b.title })),
    });
  } catch (error) {
    console.error('Collection create error:', error);
    return NextResponse.json(
      { error: 'Failed to create collection' },
      { status: 500 }
    );
  }
}
