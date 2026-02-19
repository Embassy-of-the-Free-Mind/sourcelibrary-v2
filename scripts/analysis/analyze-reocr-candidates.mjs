import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

async function run() {
  const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // 1. Find books opened at least once
  const openedBooks = await db.collection('books').find(
    { read_count: { $gte: 1 }, deleted: { $ne: true } },
    { projection: { _id: 1, title: 1, display_title: 1, author: 1, read_count: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, language: 1, original_language: 1 } }
  ).sort({ read_count: -1 }).toArray();

  console.log(`\n=== Books opened at least once: ${openedBooks.length} ===\n`);

  // 2. For each book, check how many pages have gemini-3-flash-preview OCR vs older models
  const results = [];

  for (const book of openedBooks) {
    const bookId = book._id.toString();

    // Count pages by OCR model
    const modelCounts = await db.collection('pages').aggregate([
      { $match: { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } } },
      { $group: {
        _id: '$ocr.model',
        count: { $sum: 1 }
      }},
      { $sort: { count: -1 } }
    ]).toArray();

    const totalOcr = modelCounts.reduce((sum, m) => sum + m.count, 0);
    const gemini3Count = modelCounts
      .filter(m => m._id && m._id.includes('gemini-3'))
      .reduce((sum, m) => sum + m.count, 0);
    const oldModelCount = totalOcr - gemini3Count;

    // Count total pages
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });

    const models = modelCounts.map(m => `${m._id || 'unknown'}: ${m.count}`).join(', ');

    results.push({
      id: bookId,
      title: (book.display_title || book.title || '').substring(0, 60),
      author: (book.author || '').substring(0, 30),
      language: book.original_language || book.language || '?',
      reads: book.read_count,
      totalPages,
      totalOcr,
      gemini3Count,
      oldModelCount,
      needsReocr: oldModelCount > 0,
      models
    });
  }

  // Sort: books needing re-OCR first, then by reads
  const needReocr = results.filter(r => r.needsReocr);
  const alreadyDone = results.filter(r => !r.needsReocr && r.totalOcr > 0);
  const noOcr = results.filter(r => r.totalOcr === 0);

  console.log(`\n=== SUMMARY ===`);
  console.log(`Books opened ≥1 time: ${results.length}`);
  console.log(`  Need re-OCR (have old model pages): ${needReocr.length}`);
  console.log(`  Already on gemini-3 (or no OCR model recorded): ${alreadyDone.length}`);
  console.log(`  No OCR at all: ${noOcr.length}`);

  const totalPagesToReocr = needReocr.reduce((sum, r) => sum + r.oldModelCount, 0);
  const totalPagesAll = needReocr.reduce((sum, r) => sum + r.totalPages, 0);
  console.log(`\nTotal pages needing re-OCR: ${totalPagesToReocr.toLocaleString()}`);
  console.log(`Total pages in those books: ${totalPagesAll.toLocaleString()}`);
  console.log(`Est. batch cost @ $0.001/page: $${(totalPagesToReocr * 0.001).toFixed(2)}`);
  console.log(`Est. batch cost @ $0.002/page: $${(totalPagesToReocr * 0.002).toFixed(2)}`);
  console.log(`Est. time @ 1000 pages/hr: ${(totalPagesToReocr / 1000).toFixed(1)} hours`);

  // Print table of books needing re-OCR
  console.log(`\n=== BOOKS NEEDING RE-OCR (sorted by reads) ===\n`);
  console.log('Reads | Pages | OldOCR | Lang | Title');
  console.log('------|-------|--------|------|------');
  for (const r of needReocr.sort((a, b) => b.reads - a.reads)) {
    console.log(`${String(r.reads).padStart(5)} | ${String(r.totalPages).padStart(5)} | ${String(r.oldModelCount).padStart(6)} | ${r.language.substring(0, 4).padEnd(4)} | ${r.title}`);
  }

  // Print model distribution across all target books
  const allModels = {};
  for (const r of needReocr) {
    for (const part of r.models.split(', ')) {
      const [model, count] = part.split(': ');
      allModels[model] = (allModels[model] || 0) + parseInt(count);
    }
  }
  console.log(`\n=== MODEL DISTRIBUTION (across re-OCR candidates) ===\n`);
  for (const [model, count] of Object.entries(allModels).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${model}: ${count.toLocaleString()} pages`);
  }

  // Also list books with no OCR but have been read
  if (noOcr.length > 0) {
    console.log(`\n=== OPENED BUT NO OCR (${noOcr.length} books) ===\n`);
    for (const r of noOcr.sort((a, b) => b.reads - a.reads).slice(0, 20)) {
      console.log(`  ${r.reads} reads | ${r.totalPages} pages | ${r.language} | ${r.title}`);
    }
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
