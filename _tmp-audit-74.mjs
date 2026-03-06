import { MongoClient } from 'mongodb';

async function checkUrl(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'follow' });
    return resp.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find broken IA/Harvard thumbnail books with no local page images
  const books = await db.collection('books').find({
    $or: [
      { thumbnail: { $regex: /archive\.org\/download/ } },
      { thumbnail: { $regex: /ids\.lib\.harvard\.edu/ } },
    ],
    pages_count: { $gt: 0 },
  }).project({
    title: 1, thumbnail: 1, id: 1, pages_count: 1, _id: 0,
    author: 1, published: 1, language: 1, original_language: 1,
    pages_ocr: 1, pages_translated: 1,
    'reading_summary.overview': 1,
    'pipeline_auto.status': 1,
    collections: 1, categories: 1,
    'image_source.provider': 1,
    'image_source.identifier': 1,
  }).toArray();

  // Check which are broken
  const brokenBooks = [];
  const BATCH = 30;
  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(b => checkUrl(b.thumbnail)));
    for (let j = 0; j < batch.length; j++) {
      if (!results[j]) brokenBooks.push(batch[j]);
    }
  }

  // Filter to only those without local page images
  const noLocal = [];
  for (const book of brokenBooks) {
    const hasLocal = await db.collection('pages').findOne(
      { book_id: book.id, $or: [
        { thumbnail_blob: { $exists: true, $ne: null, $ne: '' } },
        { cropped_photo: { $exists: true, $ne: null, $ne: '' } },
        { archived_photo: { $exists: true, $ne: null, $ne: '' } },
      ]},
      { projection: { _id: 1 } }
    );
    if (!hasLocal) noLocal.push(book);
  }

  console.log(`=== Audit of ${noLocal.length} IA-Blocked Books ===\n`);

  // For each, check what content exists
  let totalOcr = 0, totalTranslated = 0, totalPages = 0;
  let hasCollections = 0;

  for (const book of noLocal) {
    // Count pages with OCR and translation
    const pagesWithOcr = await db.collection('pages').countDocuments({
      book_id: book.id, 'ocr.data': { $exists: true, $ne: '' }
    });
    const pagesWithTranslation = await db.collection('pages').countDocuments({
      book_id: book.id, 'translation.data': { $exists: true, $ne: '' }
    });

    totalOcr += pagesWithOcr;
    totalTranslated += pagesWithTranslation;
    totalPages += book.pages_count;
    if (book.collections?.length > 0) hasCollections++;

    const iaId = book.image_source?.identifier || book.thumbnail?.match(/download\/([^/]+)/)?.[1] || '?';
    const ocrPct = book.pages_count > 0 ? ((pagesWithOcr / book.pages_count) * 100).toFixed(0) : '0';
    const transPct = book.pages_count > 0 ? ((pagesWithTranslation / book.pages_count) * 100).toFixed(0) : '0';

    console.log(`${book.title}`);
    console.log(`  ${book.author || '?'} | ${book.published || '?'} | ${book.original_language || book.language || '?'}`);
    console.log(`  ${book.pages_count} pages | OCR: ${pagesWithOcr} (${ocrPct}%) | Trans: ${pagesWithTranslation} (${transPct}%)`);
    console.log(`  Pipeline: ${book.pipeline_auto?.status || '-'} | Collections: ${book.collections?.join(', ') || 'none'}`);
    console.log(`  IA: ${iaId}`);
    console.log(`  Summary: ${book.reading_summary?.overview ? 'YES (' + book.reading_summary.overview.length + ' chars)' : 'NO'}`);
    console.log('');
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total books: ${noLocal.length}`);
  console.log(`Total pages: ${totalPages}`);
  console.log(`Total OCR'd pages: ${totalOcr}`);
  console.log(`Total translated pages: ${totalTranslated}`);
  console.log(`Books in collections: ${hasCollections}`);
  console.log(`Books with summaries: ${noLocal.filter(b => b.reading_summary?.overview).length}`);

  await client.close();
}

main();
