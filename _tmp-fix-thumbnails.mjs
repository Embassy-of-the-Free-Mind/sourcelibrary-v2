import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const broken = await db.collection('books').find({
    $or: [
      { thumbnail: { $exists: false } },
      { thumbnail: null },
      { thumbnail: '' }
    ]
  }).project({ id: 1, title: 1, _id: 0 }).toArray();

  console.log('Fixing', broken.length, 'books...');
  let fixed = 0, noPages = 0;

  for (const book of broken) {
    let best = await db.collection('pages').findOne(
      { book_id: book.id, page_type: 'title-page' },
      { projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } }
    );
    if (!best) {
      best = await db.collection('pages').findOne(
        { book_id: book.id, page_type: 'frontispiece' },
        { projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } }
      );
    }
    if (!best) {
      best = await db.collection('pages').findOne(
        { book_id: book.id },
        { sort: { page_number: 1 }, skip: 1, projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1, photo: 1 } }
      );
    }

    if (!best) { noPages++; console.log('  SKIP (no pages):', book.title); continue; }

    const url = best.thumbnail_blob || best.cropped_photo || best.archived_photo || best.photo;
    if (!url) { noPages++; console.log('  SKIP (no image):', book.title); continue; }

    await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail: url } });
    fixed++;
  }

  console.log('\nFixed:', fixed);
  console.log('No pages/images:', noPages);

  await client.close();
}

main();
