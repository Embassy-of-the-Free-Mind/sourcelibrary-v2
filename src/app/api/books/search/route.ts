import { NextRequest, NextResponse } from 'next/server';
import { getDb, forceReconnect, isConnectionError } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';

export const dynamic = 'force-dynamic';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Race a promise against a timeout. Returns the result or throws on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
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
    let db = await withTimeout(getDb(), 8000, 'getDb');
    const projection = { _id: 1, id: 1, title: 1, display_title: 1, author: 1 };

    let books: Record<string, unknown>[];
    let total: number;

    try {
      // Atlas Search with tight timeout
      const [result] = await withTimeout(
        db.collection('books').aggregate([
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
        ], { maxTimeMS: 5000 }).toArray(),
        8000,
        'Atlas Search',
      );

      books = result?.results ?? [];
      total = result?.total[0]?.n ?? 0;
    } catch (searchErr) {
      // If connection is stale, force reconnect and try regex fallback
      if (isConnectionError(searchErr)) {
        db = await withTimeout(forceReconnect(), 8000, 'forceReconnect');
      }

      // Fallback: regex search (skip countDocuments — it's a full collection scan)
      const queryRegex = new RegExp(escapeRegex(query), 'i');
      const filter = {
        visible: true,
        pages_count: { $gt: 0 },
        $or: [
          { title: queryRegex },
          { display_title: queryRegex },
          { author: queryRegex },
        ],
      };
      const fallbackBooks = await withTimeout(
        db.collection('books').find(filter, { projection }).limit(limit).skip(skip).toArray(),
        8000,
        'regex fallback',
      );
      books = fallbackBooks;
      total = -1; // Unknown — avoid expensive countDocuments
    }

    const response = NextResponse.json({
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
        hasMore: total === -1 ? books.length === limit : skip + books.length < total,
      },
    });

    // Cache successful responses at the edge for 60s
    response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return response;
  } catch (error) {
    console.error('Search error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
