import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get ALL visible EFM books with enough detail
  const books = await db.collection('books').find({
    'image_source.provider': 'efm',
    hidden: { $ne: true }
  }).project({
    _id: 1, id: 1, title: 1, author: 1, created_at: 1, pages_count: 1,
    pages_translated: 1, pages_ocr: 1
  }).toArray();

  console.log('Total visible EFM books:', books.length);

  // For each book, check the first page's image source
  const results = [];
  for (const b of books) {
    const bookId = b.id || String(b._id);
    const page = await db.collection('pages').findOne(
      { book_id: bookId },
      { projection: { photo_original: 1, photo: 1, archived_photo: 1 } }
    );

    const url = page?.photo_original || page?.photo || '';
    let source = 'unknown';
    if (url.includes('book-translation-data.s3')) source = 's3-btd';
    else if (url.includes('public.blob.vercel-storage.com')) source = 'vercel-blob';
    else if (url.includes('archive.org')) source = 'internet-archive';
    else if (url.includes('iiif.embassyofthefreemind') || url.includes('bfrfrk')) source = 'efm-iiif';
    else if (!url) source = 'no-image';
    else source = 'other: ' + url.substring(0, 60);

    const created = b.created_at ? new Date(b.created_at).toISOString().slice(0, 10) : 'null';
    results.push({ ...b, bookId, source, created, url: url.substring(0, 80) });
  }

  // Real EFM books should come from vercel-blob (the BPH S3 proxy)
  // Non-EFM: s3-btd (old manual uploads), internet-archive, no-image (manual shell entries)
  const nonEfm = results.filter(r =>
    r.source !== 'vercel-blob' && r.source !== 'efm-iiif'
  );

  console.log('\nNon-EFM sourced books tagged as EFM:', nonEfm.length);
  console.log('\nBy source:');
  const bySource = {};
  for (const r of nonEfm) {
    if (!bySource[r.source]) bySource[r.source] = [];
    bySource[r.source].push(r);
  }
  for (const [src, items] of Object.entries(bySource)) {
    console.log('  ' + src + ': ' + items.length);
  }

  console.log('\nAll non-EFM sourced books:');
  for (const r of nonEfm.sort((a, b) => a.created.localeCompare(b.created))) {
    const trPct = r.pages_count > 0 ? Math.round((r.pages_translated || 0) / r.pages_count * 100) : 0;
    console.log(
      '  ' + r.created.padEnd(12) +
      r.source.padEnd(20) +
      String(r.pages_count || 0).padStart(5) + 'p ' +
      String(trPct).padStart(3) + '%t ' +
      (r.author || '').substring(0, 20).padEnd(22) +
      (r.title || '').substring(0, 55)
    );
  }

  // Also check: are there vercel-blob books from before 2025-11 that might be non-EFM?
  const earlyVercel = results.filter(r =>
    r.source === 'vercel-blob' && r.created < '2025-11'
  );
  if (earlyVercel.length > 0) {
    console.log('\nEarly vercel-blob (before 2025-11):', earlyVercel.length);
    for (const r of earlyVercel) {
      console.log('  ' + r.created + ' ' + (r.title || '?').substring(0, 60));
    }
  }

  // Real EFM breakdown
  const realEfm = results.filter(r =>
    r.source === 'vercel-blob' || r.source === 'efm-iiif'
  );
  console.log('\nReal EFM books:', realEfm.length);

  if (process.argv.includes('--execute')) {
    const ids = nonEfm.map(r => r._id);
    const result = await db.collection('books').updateMany(
      { _id: { $in: ids } },
      { $set: { hidden: true } }
    );
    console.log('\nHidden ' + result.modifiedCount + ' non-EFM books');
    const newVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
    console.log('New visible count: ' + newVisible);
  } else {
    console.log('\nDry run. Use --execute to hide.');
  }

  await client.close();
}
main();
