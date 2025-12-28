import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const skip = Math.max(0, parseInt(searchParams.get('skip') || '0'));

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  // Prevent regex DoS with very long queries
  if (query.length > 100) {
    return NextResponse.json({ error: 'Query too long (max 100 chars)' }, { status: 400 });
  }

  try {
    const db = await getDb();

    const filter = {
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { display_title: { $regex: query, $options: 'i' } },
        { author: { $regex: query, $options: 'i' } }
      ]
    };

    const [books, total] = await Promise.all([
      db.collection('books').find(filter).skip(skip).limit(limit).toArray(),
      db.collection('books').countDocuments(filter)
    ]);

    return NextResponse.json({
      results: books.map(b => ({
        id: b.id || b._id.toString(),
        _id: b._id.toString(),
        title: b.title,
        display_title: b.display_title,
        author: b.author
      })),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + books.length < total
      }
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
