import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export interface Entity {
  _id?: string;
  name: string;
  type: 'person' | 'place' | 'concept';
  aliases?: string[];
  description?: string;
  wikipedia_url?: string;
  books: Array<{
    book_id: string;
    book_title: string;
    book_author: string;
    pages: number[];
  }>;
  total_mentions: number;
  book_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * GET /api/entities
 *
 * Query entities across all books
 *
 * Query params:
 * - type: 'person' | 'place' | 'concept' (filter by type)
 * - q: search query (searches name and aliases)
 * - book_id: filter to entities appearing in this book
 * - min_books: minimum number of books entity appears in (default: 1)
 * - limit: max results (default: 50)
 * - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') as Entity['type'] | null;
    const query = searchParams.get('q');
    const bookId = searchParams.get('book_id');
    const minBooks = parseInt(searchParams.get('min_books') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDb();

    // Build query
    const filter: Record<string, unknown> = {};

    if (type) {
      filter.type = type;
    }

    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { aliases: { $regex: query, $options: 'i' } }
      ];
    }

    if (bookId) {
      filter['books.book_id'] = bookId;
    }

    if (minBooks > 1) {
      filter.book_count = { $gte: minBooks };
    }

    // Get total count
    const total = await db.collection('entities').countDocuments(filter);

    // Get entities sorted by book_count (most connected first)
    const entities = await db.collection('entities')
      .find(filter)
      .sort({ book_count: -1, total_mentions: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return NextResponse.json({
      entities,
      total,
      limit,
      offset,
      hasMore: offset + entities.length < total
    });
  } catch (error) {
    console.error('Error fetching entities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entities' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/entities/sync
 *
 * Sync entities from all books' index data.
 * This aggregates people/places/concepts from book indexes into the entities collection.
 */
export async function POST(request: NextRequest) {
  try {
    const db = await getDb();

    // Get all books with index data
    const books = await db.collection('books')
      .find({ 'index.people': { $exists: true } })
      .project({
        id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        'index.people': 1,
        'index.places': 1,
        'index.concepts': 1
      })
      .toArray();

    console.log(`Syncing entities from ${books.length} books...`);

    // Build entity map: name -> entity data
    const entityMap = new Map<string, {
      name: string;
      type: Entity['type'];
      books: Map<string, { book_id: string; book_title: string; book_author: string; pages: number[] }>;
    }>();

    for (const book of books) {
      const bookId = book.id;
      const bookTitle = book.display_title || book.title;
      const bookAuthor = book.author || 'Unknown';

      // Process people
      for (const person of (book.index?.people || [])) {
        const key = `person:${person.term.toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: person.term,
            type: 'person',
            books: new Map()
          });
        }
        const entity = entityMap.get(key)!;
        entity.books.set(bookId, {
          book_id: bookId,
          book_title: bookTitle,
          book_author: bookAuthor,
          pages: person.pages || []
        });
      }

      // Process places
      for (const place of (book.index?.places || [])) {
        const key = `place:${place.term.toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: place.term,
            type: 'place',
            books: new Map()
          });
        }
        const entity = entityMap.get(key)!;
        entity.books.set(bookId, {
          book_id: bookId,
          book_title: bookTitle,
          book_author: bookAuthor,
          pages: place.pages || []
        });
      }

      // Process concepts
      for (const concept of (book.index?.concepts || [])) {
        const key = `concept:${concept.term.toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            name: concept.term,
            type: 'concept',
            books: new Map()
          });
        }
        const entity = entityMap.get(key)!;
        entity.books.set(bookId, {
          book_id: bookId,
          book_title: bookTitle,
          book_author: bookAuthor,
          pages: concept.pages || []
        });
      }
    }

    // Upsert entities
    const now = new Date();
    let created = 0;
    let updated = 0;

    for (const [key, data] of entityMap) {
      const booksArray = Array.from(data.books.values());
      const totalMentions = booksArray.reduce((sum, b) => sum + b.pages.length, 0);

      const result = await db.collection('entities').updateOne(
        { name: data.name, type: data.type },
        {
          $set: {
            name: data.name,
            type: data.type,
            books: booksArray,
            total_mentions: totalMentions,
            book_count: booksArray.length,
            updated_at: now
          },
          $setOnInsert: {
            created_at: now
          }
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) created++;
      else if (result.modifiedCount > 0) updated++;
    }

    // Create indexes
    await db.collection('entities').createIndex({ name: 1, type: 1 }, { unique: true });
    await db.collection('entities').createIndex({ type: 1 });
    await db.collection('entities').createIndex({ book_count: -1 });
    await db.collection('entities').createIndex({ 'books.book_id': 1 });

    return NextResponse.json({
      success: true,
      booksProcessed: books.length,
      entitiesCreated: created,
      entitiesUpdated: updated,
      totalEntities: entityMap.size
    });
  } catch (error) {
    console.error('Error syncing entities:', error);
    return NextResponse.json(
      { error: 'Failed to sync entities' },
      { status: 500 }
    );
  }
}
