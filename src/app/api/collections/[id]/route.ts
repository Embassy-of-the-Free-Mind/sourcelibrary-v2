import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 15;

/**
 * GET /api/collections/[id]
 *
 * Get collection metadata and its books with pagination/sorting.
 *
 * Query params:
 *   - sort: 'year_asc' (default), 'year_desc', 'title', 'recent'
 *   - language: filter by language
 *   - limit: max results (default 60, max 200)
 *   - offset: pagination offset
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const sort = searchParams.get('sort') || 'year_asc';
    const language = searchParams.get('language');
    const limit = Math.min(parseInt(searchParams.get('limit') || '60'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    // Get collection metadata (slug stored as "slug" field)
    const collection = await db.collection('collections').findOne({ slug: id });
    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // Build book filter — exclude empty shells (0 pages) from failed imports
    const filter: Record<string, unknown> = {
      collections: id,
      status: { $ne: 'deleted' },
      hidden: { $ne: true },
      pages_count: { $gt: 0 },
    };
    if (language) filter.language = language;

    // Sort
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      year_asc: { year: 1, title: 1 },
      year_desc: { year: -1, title: 1 },
      title: { title: 1 },
      recent: { created_at: -1 },
      popular: { read_count: -1, title: 1 },
    };
    const sortObj = sortMap[sort] || sortMap.year_asc;

    const projection = {
      _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1,
      language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
      photo: 1, categories: 1, thumbnail: 1, thumbnail_blob: 1, published: 1, read_count: 1,
    };

    const highlightProjection = {
      ...projection,
      reading_summary: 1,
      read_count: 1,
      quality_score: 1,
    };

    const [books, total, highlights] = await Promise.all([
      db.collection('books')
        .find(filter, { projection })
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('books').countDocuments(filter),
      // Top 5 books: prefer translated books with summaries, ranked by quality/reads
      db.collection('books')
        .find(
          { collections: id, status: { $ne: 'deleted' }, hidden: { $ne: true }, pages_translated: { $gt: 0 } },
          { projection: highlightProjection },
        )
        .sort({ quality_score: -1, read_count: -1, pages_translated: -1 })
        .limit(5)
        .toArray(),
    ]);

    const { _id, ...collectionClean } = collection;

    return NextResponse.json({
      collection: collectionClean,
      books,
      highlights,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Collection detail error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch collection' },
      { status: 500 }
    );
  }
}
