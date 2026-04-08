import { NextRequest, NextResponse } from 'next/server';
import { getReadDb, forceReconnect, isConnectionError } from '@/lib/mongodb';
import { buildBookSearchStage } from '@/lib/atlas-search';
import { searchBookIds } from '@/lib/books-catalog';

export const dynamic = 'force-dynamic';

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
    let db = await withTimeout(getReadDb(), 8000, 'getReadDb');
    const projection = { _id: 1, id: 1, title: 1, display_title: 1, author: 1 };

    let books: Record<string, unknown>[];
    let total: number;

    try {
      // Atlas Search — no $facet (causes Atlas timeouts on large collections)
      books = await withTimeout(
        db.collection('books').aggregate([
          buildBookSearchStage(query),
          { $skip: skip },
          { $limit: limit },
          { $project: projection },
        ], { maxTimeMS: 5000 }).toArray(),
        8000,
        'Atlas Search',
      );
      total = -1; // Skip expensive count — hasMore uses result length instead
    } catch (searchErr) {
      // If connection is stale, force reconnect
      if (isConnectionError(searchErr)) {
        db = await withTimeout(forceReconnect(), 8000, 'forceReconnect');
      }

      // Fallback: Supabase trigram search (fast, indexed) instead of MongoDB regex
      const matchingIds = await withTimeout(
        searchBookIds(query, { limit: skip + limit }),
        8000,
        'Supabase fallback',
      );
      const pageIds = matchingIds.slice(skip, skip + limit);
      if (pageIds.length > 0) {
        books = await withTimeout(
          db.collection('books').find(
            { id: { $in: pageIds } },
            { projection },
          ).toArray(),
          8000,
          'Supabase ID lookup',
        );
      } else {
        books = [];
      }
      total = -1;
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
