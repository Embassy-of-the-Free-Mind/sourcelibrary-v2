import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const pages = db.collection('pages');

  const projection = {
    title: 1, id: 1, _id: 1, thumbnail: 1, thumbnail_source: 1,
    pipeline_status: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
    hidden: 1, status: 1, ia_identifier: 1, slug: 1, author: 1, year: 1,
    cover_page: 1, image_source: 1, published: 1,
  };

  // More: Utopia — broad search
  console.log('=== SEARCHING FOR UTOPIA / MORE / BURNET ===\n');
  const moreResults = await books.find(
    { $or: [
      { title: /utopia/i },
      { title: /thomas more/i },
      { author: /thomas more/i },
    ]},
    { projection }
  ).limit(10).toArray();

  for (const book of moreResults) {
    console.log(`Title: ${book.title}`);
    console.log(`  Author: ${book.author}`);
    console.log(`  id: ${book.id} | hidden: ${book.hidden ?? '(absent)'} | status: ${book.status ?? '(absent)'}`);
    console.log(`  thumbnail: ${book.thumbnail}`);
    console.log(`  pages_count: ${book.pages_count} | pages_ocr: ${book.pages_ocr}`);
    console.log('');
  }

  // Now check pages for Sergius (id: 6955da57646474023271beb0) — what is page 6?
  console.log('=== PAGES FOR SERGIUS (6955da57646474023271beb0) — pages 1-10 ===\n');
  const sergiusPages = await pages.find(
    { book_id: '6955da57646474023271beb0' },
    { projection: { page_number: 1, image_url: 1, ocr: 1, thumbnail: 1, _id: 0 } }
  ).sort({ page_number: 1 }).limit(15).toArray();
  for (const p of sergiusPages) {
    const ocrPreview = p.ocr?.data ? p.ocr.data.substring(0, 60).replace(/\n/g, ' ') : '(none)';
    console.log(`  page ${p.page_number}: ${p.image_url || p.thumbnail || '(no img)'} | ocr: ${ocrPreview}`);
  }

  // And check pages for Llull (id: 695592c47bd6d2cd1d61b10b) — what is page 9?
  console.log('\n=== PAGES FOR LLULL ARS INVENTIUA (695592c47bd6d2cd1d61b10b) — pages 1-15 ===\n');
  const llullPages = await pages.find(
    { book_id: '695592c47bd6d2cd1d61b10b' },
    { projection: { page_number: 1, image_url: 1, ocr: 1, thumbnail: 1, _id: 0 } }
  ).sort({ page_number: 1 }).limit(15).toArray();
  for (const p of llullPages) {
    const ocrPreview = p.ocr?.data ? p.ocr.data.substring(0, 80).replace(/\n/g, ' ') : '(none)';
    console.log(`  page ${p.page_number}: ${p.image_url || p.thumbnail || '(no img)'} | ocr: ${ocrPreview}`);
  }

  // Check how cover page selection works — what picks page 6 vs page 1?
  console.log('\n=== STATUS field breakdown ===');
  const statusGroups = await books.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();
  for (const g of statusGroups) {
    console.log(`  status="${g._id}": ${g.count}`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
