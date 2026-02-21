import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find({
    'image_source.provider': 'efm',
    hidden: { $ne: true }
  }).project({
    id: 1, title: 1, author: 1, created_at: 1, pages_count: 1
  }).toArray();

  // Group by month client-side
  const byMonth = {};
  for (const b of books) {
    const d = b.created_at ? new Date(b.created_at) : null;
    const key = d ? d.toISOString().slice(0, 7) : 'null';
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(b);
  }

  console.log('EFM books by creation month (' + books.length + ' total):');
  for (const [month, group] of Object.entries(byMonth).sort()) {
    const samples = group.slice(0, 3).map(b => (b.title || '?').substring(0, 40)).join(' | ');
    console.log('  ' + month.padEnd(10) + String(group.length).padStart(5) + '   e.g. ' + samples);
  }

  // Now check page image URLs for a sample from each batch
  console.log('\nSample page image URLs by batch:');
  for (const [month, group] of Object.entries(byMonth).sort()) {
    const sample = group[0];
    const page = await db.collection('pages').findOne(
      { book_id: sample.id || String(sample._id) },
      { projection: { photo: 1, photo_original: 1 } }
    );
    const url = page?.photo_original || page?.photo || 'none';
    console.log('  ' + month + ': ' + url.substring(0, 100));
  }

  // The two flagged books were created 2024-11 and 2025-06
  // Check if there's a distinct image source pattern
  // Real EFM books likely have embassyofthefreemind or bfrfrk or similar in their URLs
  // Let's check a broader sample
  console.log('\nImage URL patterns across all EFM books:');
  const urlPatterns = {};
  for (const b of books.slice(0, 200)) {
    const page = await db.collection('pages').findOne(
      { book_id: b.id || String(b._id) },
      { projection: { photo_original: 1 } }
    );
    const url = page?.photo_original || '';
    let pattern = 'none';
    if (url.includes('book-translation-data.s3')) pattern = 's3-book-translation-data';
    else if (url.includes('embassyofthefreemind') || url.includes('bfrfrk')) pattern = 'efm-iiif';
    else if (url.includes('iiif.io') || url.includes('iiif')) pattern = 'iiif-other';
    else if (url.includes('archive.org')) pattern = 'internet-archive';
    else if (url.includes('blob.vercel')) pattern = 'vercel-blob';
    else if (url) pattern = 'other: ' + new URL(url).hostname;

    if (!urlPatterns[pattern]) urlPatterns[pattern] = { count: 0, sample: url.substring(0, 100), created: [] };
    urlPatterns[pattern].count++;
    const d = b.created_at ? new Date(b.created_at).toISOString().slice(0, 7) : 'null';
    if (!urlPatterns[pattern].created.includes(d)) urlPatterns[pattern].created.push(d);
  }

  for (const [pat, data] of Object.entries(urlPatterns).sort((a, b) => b[1].count - a[1].count)) {
    console.log('  ' + pat.padEnd(30) + String(data.count).padStart(5) + '   months: ' + data.created.sort().join(', '));
    console.log('    sample: ' + data.sample);
  }

  await client.close();
}
main();
