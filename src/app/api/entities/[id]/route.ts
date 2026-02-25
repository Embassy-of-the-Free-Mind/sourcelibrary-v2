import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { buildEntityJsonLd } from '@/lib/jsonld';

/**
 * GET /api/entities/[id]
 *
 * Get a single entity by ID or by name+type
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    let entity;

    // Try to find by ObjectId first
    if (ObjectId.isValid(id)) {
      entity = await db.collection('entities').findOne({ _id: new ObjectId(id) });
    }

    // If not found, try by URL-encoded name (for friendly URLs)
    if (!entity) {
      const decodedName = decodeURIComponent(id);
      entity = await db.collection('entities').findOne(
        { name: { $regex: `^${decodedName}$`, $options: 'i' } },
        { sort: { book_count: -1 } }
      );
    }

    if (!entity) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    // JSON-LD format
    const format = new URL(request.url).searchParams.get('format');
    if (format === 'jsonld') {
      const jsonLd = buildEntityJsonLd({
        name: entity.name,
        type: entity.type,
        aliases: entity.aliases,
        description: entity.description,
        wikipedia_url: entity.wikipedia_url,
        wikidata_id: entity.wikidata_id,
        wikidata_birth_date: entity.wikidata_birth_date,
        wikidata_death_date: entity.wikidata_death_date,
        wikidata_coordinates: entity.wikidata_coordinates,
        books: entity.books,
      });
      return new Response(JSON.stringify(jsonLd, null, 2), {
        headers: {
          'Content-Type': 'application/ld+json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Find related entities (entities that appear in the same books)
    const bookIds = entity.books.map((b: { book_id: string }) => b.book_id);
    const relatedEntities = await db.collection('entities')
      .find({
        _id: { $ne: entity._id },
        'books.book_id': { $in: bookIds }
      })
      .sort({ book_count: -1 })
      .limit(10)
      .project({ name: 1, type: 1, book_count: 1 })
      .toArray();

    return NextResponse.json({
      ...entity,
      related: relatedEntities
    });
  } catch (error) {
    console.error('Error fetching entity:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entity' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/entities/[id]
 *
 * Update entity metadata (description, aliases, wikipedia_url)
 */
export const PATCH = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const updates = await request.json();
    const db = await getDb();

    // Only allow certain fields to be updated
    const allowedFields = ['description', 'aliases', 'wikipedia_url', 'wikidata_id', 'wikidata_birth_date', 'wikidata_death_date', 'wikidata_coordinates'];
    const filteredUpdates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    filteredUpdates.updated_at = new Date();

    const result = await db.collection('entities').updateOne(
      { _id: new ObjectId(id) },
      { $set: filteredUpdates }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, updated: filteredUpdates });
  } catch (error) {
    console.error('Error updating entity:', error);
    return NextResponse.json(
      { error: 'Failed to update entity' },
      { status: 500 }
    );
  }
});
