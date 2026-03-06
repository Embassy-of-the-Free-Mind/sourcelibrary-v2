import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Search for Hero, Pneumatica, Archimedes, Hermetica
  const terms = ['Hero', 'Pneumatica', 'Automata', 'Archimedes', 'Hermetica', 'Hermes Trismegistus', 'Ctesibius', 'Spiritalia'];
  for (const term of terms) {
    const books = await db.collection('books').find(
      { $or: [
        { title: { $regex: term, $options: 'i' } },
        { author: { $regex: term, $options: 'i' } },
        { display_title: { $regex: term, $options: 'i' } }
      ]},
      { projection: { _id: 1, id: 1, title: 1, author: 1, published: 1, year: 1, language: 1, pages_count: 1, pages_translated: 1, thumbnail: 1 } }
    ).limit(10).toArray();
    if (books.length > 0) {
      console.log('\n=== ' + term + ' (' + books.length + ' results) ===');
      for (const b of books) {
        console.log('  ' + b._id + ' | ' + (b.title || '').slice(0, 100) + ' | ' + b.author + ' | ' + b.published + ' | ' + b.language + ' | pages:' + b.pages_count + ' trans:' + b.pages_translated);
        console.log('    uuid: ' + b.id + ' | thumb: ' + (b.thumbnail || 'none'));
      }
    } else {
      console.log('\n=== ' + term + ' (0 results) ===');
    }
  }

  // Also check the specific Archimedes+Hero volume
  const archHero = await db.collection('books').findOne(
    { _id: new ObjectId('699389570f04c37dcfa60b32') },
    { projection: { title: 1, author: 1, published: 1, id: 1, pages_count: 1, pages_translated: 1, thumbnail: 1, 'reading_summary.overview': 1 } }
  );
  console.log('\n=== Archimedes+Hero volume (by ObjectId) ===');
  console.log(JSON.stringify(archHero, null, 2));

  // Get sample pages from Hero-related volumes
  const heroIds = ['695aa9a4be4023bd34bd6b7d', '699389570f04c37dcfa60b32'];
  for (const hexId of heroIds) {
    const book = await db.collection('books').findOne({ _id: new ObjectId(hexId) }, { projection: { id: 1, title: 1 } });
    if (!book) {
      console.log('\n=== No book found for ObjectId ' + hexId + ' ===');
      continue;
    }
    const uuid = book.id;
    const samplePages = await db.collection('pages').find(
      { book_id: uuid, 'translation.data': { $exists: true, $ne: '' } },
      { projection: { page_number: 1, 'translation.data': 1 } }
    ).sort({ page_number: 1 }).limit(5).toArray();
    console.log('\n=== Sample pages from ' + book.title?.slice(0, 60) + ' (uuid: ' + uuid + ') ===');
    if (samplePages.length === 0) {
      console.log('  (no translated pages yet)');
      // Try OCR instead
      const ocrPages = await db.collection('pages').find(
        { book_id: uuid, 'ocr.data': { $exists: true, $ne: '' } },
        { projection: { page_number: 1, 'ocr.data': 1 } }
      ).sort({ page_number: 1 }).limit(3).toArray();
      if (ocrPages.length > 0) {
        console.log('  (showing OCR instead):');
        for (const p of ocrPages) {
          console.log('  p.' + p.page_number + ' [OCR]: ' + (p.ocr?.data || '').replace(/<[^>]+>/g, '').slice(0, 300));
        }
      }
    } else {
      for (const p of samplePages) {
        console.log('  p.' + p.page_number + ': ' + (p.translation?.data || '').slice(0, 300));
      }
    }
  }

  // Also search more broadly for "mechanic" in titles/descriptions
  const mechBooks = await db.collection('books').find(
    { $or: [
      { title: { $regex: 'mechani', $options: 'i' } },
      { display_title: { $regex: 'mechani', $options: 'i' } },
      { 'reading_summary.overview': { $regex: 'Hero of Alexandria', $options: 'i' } }
    ]},
    { projection: { _id: 1, id: 1, title: 1, author: 1, published: 1, language: 1, pages_count: 1 } }
  ).limit(10).toArray();
  console.log('\n=== "mechani*" in title or "Hero of Alexandria" in summary (' + mechBooks.length + ' results) ===');
  for (const b of mechBooks) {
    console.log('  ' + b._id + ' | ' + (b.title || '').slice(0, 100) + ' | ' + b.author + ' | ' + b.published + ' | ' + b.language);
  }

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
