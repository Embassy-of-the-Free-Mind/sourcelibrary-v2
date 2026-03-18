import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const skip = Math.max(0, parseInt(searchParams.get('skip') || '0'));

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  if (query.length > 100) {
    return NextResponse.json({ error: 'Query too long (max 100 chars)' }, { status: 400 });
  }

  try {
    const db = await getDb();

    const [result] = await db.collection('books').aggregate([
      buildBookSearchStage(query),
      {
        $facet: {
          results: [
            { $skip: skip },
            { $limit: limit },
            { $project: { _id: 1, id: 1, title: 1, display_title: 1, author: 1 } },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ]).toArray();

    const books = result?.results ?? [];
    const total = result?.total[0]?.n ?? 0;

    return NextResponse.json({
      results: books.map((b: { id?: string; _id: { toString(): string }; title: string; display_title?: string; author?: string }) => ({
        id: b.id || b._id.toString(),
        _id: b._id.toString(),
        title: b.title,
        display_title: b.display_title,
        author: b.author,
      })),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + books.length < total,
      },
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
