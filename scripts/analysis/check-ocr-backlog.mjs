import { MongoClient } from 'mongodb';
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const needOcr = await db.collection('books').find({
    hidden: { $ne: true },
    'pipeline_auto.status': 'archive_complete'
  }).project({ id: 1, title: 1, pages_count: 1, pages_ocr: 1, 'image_source.provider': 1 }).toArray();

  let totalPages = 0, totalOcr = 0;
  const byProvider = {};
  for (const b of needOcr) {
    const p = b.image_source?.provider || '?';
    if (!byProvider[p]) byProvider[p] = { books: 0, pages: 0, ocr: 0 };
    byProvider[p].books++;
    byProvider[p].pages += b.pages_count || 0;
    byProvider[p].ocr += b.pages_ocr || 0;
    totalPages += b.pages_count || 0;
    totalOcr += b.pages_ocr || 0;
  }

  console.log('Archive_complete books needing OCR:', needOcr.length);
  console.log('Total pages:', totalPages.toLocaleString());
  console.log('Already OCRd:', totalOcr.toLocaleString(), '(' + Math.round(totalOcr / totalPages * 100) + '%)');
  console.log('Remaining:', (totalPages - totalOcr).toLocaleString());
  console.log('\nBy provider:');
  for (const [p, d] of Object.entries(byProvider).sort((a, b) => b[1].pages - a[1].pages)) {
    console.log('  ' + p.padEnd(20) + d.books + ' books, ' + d.pages.toLocaleString() + ' pages, ' + d.ocr.toLocaleString() + ' ocr (' + Math.round(d.ocr / d.pages * 100) + '%)');
  }

  await client.close();
}
main();
