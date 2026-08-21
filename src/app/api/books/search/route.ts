import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { searchBookIds } from '@/lib/books-catalog';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const skip = Math.max(0, parseInt(searchParams.get('skip') || '0'));
  const tenantContext = getTenantContextFromRequest(request.headers);

  if (tenantContext.slug && !tenantContext.id) {
    return NextResponse.json({
      results: [],
      pagination: {
        total: 0,
        limit,
        skip,
        hasMore: false,
      },
    });
  }

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  if (query.length > 100) {
    return NextResponse.json({ error: 'Query too long (max 100 chars)' }, { status: 400 });
  }

  try {
    // Supabase trigram search (fast, always warm — no cold-start penalty)
    const matchingIds = await searchBookIds(query, { limit: skip + limit });
    const pageIds = matchingIds.slice(skip, skip + limit);

    let books: Record<string, unknown>[] = [];
    if (pageIds.length > 0) {
      const db = await getReadDb();
      // Re-apply visible:true at the Mongo fetch as a defensive gate. searchBookIds
      // already filters visible:true in Supabase, but the catalog lags Mongo — a
      // book hidden in Mongo but still visible in the stale catalog would otherwise
      // surface here and then 404 in the reader (the "search returns a hidden book"
      // class — e.g. the imageless Toltec artwork stub, 2026-06-21).
      const filter: Record<string, unknown> = { id: { $in: pageIds }, visible: true };
      if (tenantContext.id) filter.tenantId = tenantContext.id;
      books = await db.collection('books').find(
        filter,
        { projection: { _id: 1, id: 1, title: 1, display_title: 1, author: 1 } },
      ).maxTimeMS(5000).toArray();
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
        total: -1,
        limit,
        skip,
        hasMore: books.length === limit,
      },
    });

    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return response;
  } catch (error) {
    console.error('Search error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
