import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDb();

    // Get all books with page counts
    const books = await db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          localField: 'id',
          foreignField: 'book_id',
          as: 'pages_array'
        }
      },
      {
        $addFields: {
          pages_count: { $size: '$pages_array' }
        }
      },
      {
        $project: {
          pages_array: 0
        }
      },
      {
        $sort: { created_at: -1 }
      }
    ]).toArray();

    return NextResponse.json(books);
  } catch (error) {
    console.error('Error fetching books:', error);
    return NextResponse.json({ error: 'Failed to fetch books' }, { status: 500 });
  }
}
