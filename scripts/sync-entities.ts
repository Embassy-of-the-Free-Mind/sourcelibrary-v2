import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

// Load .env.local
config({ path: '.env.local' });

async function syncEntities() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Get books with index
  const books = await db.collection('books')
    .find({ 'index.people': { $exists: true } })
    .project({ id: 1, title: 1, display_title: 1, author: 1, 'index.people': 1, 'index.places': 1, 'index.concepts': 1 })
    .toArray();

  console.log('Books with index:', books.length);

  // Build entity map
  const entityMap = new Map<string, {
    name: string;
    type: 'person' | 'place' | 'concept';
    books: Map<string, { book_id: string; book_title: string; book_author: string; pages: number[] }>;
  }>();

  for (const book of books) {
    const bookId = book.id;
    const bookTitle = book.display_title || book.title;
    const bookAuthor = book.author || 'Unknown';

    for (const person of (book.index?.people || [])) {
      const key = `person:${person.term.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, { name: person.term, type: 'person', books: new Map() });
      }
      entityMap.get(key)!.books.set(bookId, { book_id: bookId, book_title: bookTitle, book_author: bookAuthor, pages: person.pages || [] });
    }

    for (const place of (book.index?.places || [])) {
      const key = `place:${place.term.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, { name: place.term, type: 'place', books: new Map() });
      }
      entityMap.get(key)!.books.set(bookId, { book_id: bookId, book_title: bookTitle, book_author: bookAuthor, pages: place.pages || [] });
    }

    for (const concept of (book.index?.concepts || [])) {
      const key = `concept:${concept.term.toLowerCase()}`;
      if (!entityMap.has(key)) {
        entityMap.set(key, { name: concept.term, type: 'concept', books: new Map() });
      }
      entityMap.get(key)!.books.set(bookId, { book_id: bookId, book_title: bookTitle, book_author: bookAuthor, pages: concept.pages || [] });
    }
  }

  console.log('Total entities:', entityMap.size);

  // Upsert entities using bulkWrite for performance
  const now = new Date();
  const bulkOps = [];

  for (const [, data] of entityMap) {
    const booksArray = Array.from(data.books.values());
    const totalMentions = booksArray.reduce((sum, b) => sum + b.pages.length, 0);

    bulkOps.push({
      updateOne: {
        filter: { name: data.name, type: data.type },
        update: {
          $set: { name: data.name, type: data.type, books: booksArray, total_mentions: totalMentions, book_count: booksArray.length, updated_at: now },
          $setOnInsert: { created_at: now }
        },
        upsert: true
      }
    });
  }

  console.log('Running bulk upsert for', bulkOps.length, 'entities...');
  const result = await db.collection('entities').bulkWrite(bulkOps);
  const created = result.upsertedCount;
  const updated = result.modifiedCount;

  // Create indexes
  await db.collection('entities').createIndex({ name: 1, type: 1 }, { unique: true });
  await db.collection('entities').createIndex({ type: 1 });
  await db.collection('entities').createIndex({ book_count: -1 });
  await db.collection('entities').createIndex({ 'books.book_id': 1 });

  console.log('Created:', created, 'Updated:', updated);
  await client.close();
}

syncEntities().catch(console.error);
