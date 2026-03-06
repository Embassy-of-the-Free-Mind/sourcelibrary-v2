import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookId = '6984e84db96022f6fa69b4c8';

// Find a good title page with a cropped photo
const titlePage = await db.collection('pages').findOne({
  book_id: bookId,
  cropped_photo: { $exists: true, $ne: '' },
  'ocr.data': /title-page/
}, { sort: { page_number: 1 } });

if (titlePage) {
  console.log(`Found title page: pg ${titlePage.page_number}`);
  console.log(`  cropped_photo: ${titlePage.cropped_photo}`);

  await db.collection('books').updateOne(
    { id: bookId },
    { $set: { thumbnail: titlePage.cropped_photo } }
  );
  console.log('Updated book thumbnail to cropped title page');
} else {
  console.log('No title page with cropped_photo found');
}

await client.close();
