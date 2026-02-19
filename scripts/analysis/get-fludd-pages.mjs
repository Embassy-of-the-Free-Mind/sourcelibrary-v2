import { MongoClient } from 'mongodb';

const bookId = '6952dac677f38f6761bc683a';
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

// Get a few key pages with translation text for the demo
const pageNums = [13, 29, 37];
for (const num of pageNums) {
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: num },
    { projection: { id: 1, page_number: 1, 'translation.data': 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }
  );
  const img = page?.cropped_photo || page?.archived_photo || page?.photo;
  console.log(`=== Page ${num} ===`);
  console.log('Image:', img);
  console.log('Translation:');
  console.log(page?.translation?.data || 'NO TRANSLATION');
  console.log();
}

// Also get real stats
const bookCount = await db.collection('books').countDocuments({});
const pageCount = await db.collection('pages').countDocuments({});
const ocrCount = await db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: '' } });
const translatedCount = await db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: '' } });
const languages = await db.collection('books').distinct('language');
const galleryCount = await db.collection('gallery_images').countDocuments({});

console.log('=== STATS ===');
console.log('Books:', bookCount);
console.log('Pages:', pageCount);
console.log('OCR:', ocrCount);
console.log('Translated:', translatedCount);
console.log('Languages:', languages.length);
console.log('Gallery:', galleryCount);

await client.close();
