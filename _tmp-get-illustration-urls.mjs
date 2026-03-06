import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const queries = [
  { slug: 'the-game-of-chess-gustavus-selenus', page: 248 },
  { slug: 'the-game-of-chess-gustavus-selenus', page: 498 },
  { slug: 'the-game-of-chess-gustavus-selenus', page: 499 },
  { slug: 'le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere', page: 14 },
];

for (const q of queries) {
  const book = await db.collection('books').findOne({ slug: q.slug }, { projection: { _id: 1, id: 1 } });
  if (!book) { console.log('Book not found:', q.slug); continue; }
  const bookId = book.id || book._id.toString();
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: q.page },
    { projection: { archived_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, thumbnail_blob: 1 } }
  );
  console.log(`${q.slug.split('-').pop()} p.${q.page}:`);
  console.log('  archived:', page?.archived_photo || 'none');
  console.log('  photo:', page?.photo || 'none');
  console.log('  cropped:', page?.cropped_photo || 'none');
  console.log('  thumb:', page?.thumbnail_blob || 'none');
  console.log();
}

await client.close();
