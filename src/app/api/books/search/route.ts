import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    const projection = { _id: 1, id: 1, title: 1, display_title: 1, author: 1 };

    let books: Record<string, unknown>[];
    let total: number;

    try {
      // Atlas Search with timeout
      const [result] = await db.collection('books').aggregate([
        buildBookSearchStage(query),
        {
          $facet: {
            results: [
              { $skip: skip },
              { $limit: limit },
              { $project: projection },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ], { maxTimeMS: 5000 }).toArray();

      books = result?.results ?? [];
      total = result?.total[0]?.n ?? 0;
    } catch {
      // Fallback: regex search when Atlas Search is unavailable
      const queryRegex = new RegExp(escapeRegex(query), 'i');
      const filter = {
        hidden: { $ne: true },
        $or: [
          { title: queryRegex },
          { display_title: queryRegex },
          { author: queryRegex },
        ],
      };
      const [fallbackBooks, fallbackTotal] = await Promise.all([
        db.collection('books').find(filter, { projection }).skip(skip).limit(limit).toArray(),
        db.collection('books').countDocuments(filter),
      ]);
      books = fallbackBooks;
      total = fallbackTotal;
    }

    return NextResponse.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results: books.map((b: any) => ({
        id: b.id || b._id?.toString(),
        _id: b._id?.toString(),
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
