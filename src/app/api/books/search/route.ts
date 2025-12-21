import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
  }

  try {
    const db = await getDb();

    const books = await db.collection('books').find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { display_title: { $regex: query, $options: 'i' } },
        { author: { $regex: query, $options: 'i' } }
      ]
    }).toArray();

    return NextResponse.json({
      results: books.map(b => ({
        id: b.id || b._id.toString(),
        _id: b._id.toString(),
        title: b.title,
        display_title: b.display_title,
        author: b.author
      }))
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
