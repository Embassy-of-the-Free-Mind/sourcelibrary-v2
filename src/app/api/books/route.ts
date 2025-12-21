import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

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

// Create a new book
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      display_title,
      author,
      language,
      published,
      publisher,
      place_of_publication,
      printer,
      ia_identifier
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const db = await getDb();
    const bookId = new ObjectId().toHexString();

    const book = {
      id: bookId,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author: author || 'Unknown',
      language: language || 'Unknown',
      published: published || 'Unknown',
      publisher: publisher || null,
      place_of_publication: place_of_publication || null,
      printer: printer || null,
      ia_identifier: ia_identifier || null,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('books').insertOne(book);

    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    console.error('Error creating book:', error);
    return NextResponse.json({ error: 'Failed to create book' }, { status: 500 });
  }
}
