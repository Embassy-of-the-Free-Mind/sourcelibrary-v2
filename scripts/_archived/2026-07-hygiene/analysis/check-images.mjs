import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const results = await db.collection('books').aggregate([
    { $match: {
      'pipeline_auto.status': 'archive_complete',
      pages_count: { $gt: 50, $lte: 300 },
      $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }, { pages_ocr: null }]
    }},
    { $sort: { pages_count: 1 } },
    { $limit: 100 },
    { $lookup: {
      from: 'pages',
      let: { bid: '$id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$book_id', '$$bid'] } } },
        { $limit: 1 },
        { $project: { archived_photo: 1, photo: 1 } }
      ],
      as: 'sample_page'
    }},
    { $unwind: { path: '$sample_page', preserveNullAndEmptyArrays: true } },
    { $project: { id: 1, title: 1, pages_count: 1, language: 1, archived: '$sample_page.archived_photo', photo: '$sample_page.photo' } }
  ]).toArray();

  const good = results.filter(b => {
    const a = b.archived || '';
    return a.startsWith('http') && !a.includes('failed');
  });

  const origOnly = results.filter(b => {
    const a = b.archived || '';
    const p = b.photo || '';
    const badArchive = !a.startsWith('http') || a.includes('failed');
    return badArchive && p.startsWith('http');
  });

  console.log('Total checked:', results.length);
  console.log('With good archived images:', good.length);
  console.log('With original URLs only:', origOnly.length);
  console.log('No usable images:', results.length - good.length - origOnly.length);
  console.log();

  if (good.length > 0) {
    console.log('Books with good archived images:');
    for (const b of good.slice(0, 15)) {
      console.log('  ' + (b.id || b._id).toString().slice(-8) + ' | ' + String(b.pages_count).padStart(4) + ' pp | ' + (b.language || '?').padEnd(10) + ' | ' + (b.title || '').slice(0, 55));
    }
    console.log();
    console.log('IDS:' + good.slice(0, 10).map(b => b.id || b._id).join(','));
  }

  if (origOnly.length > 0) {
    console.log();
    console.log('Books with original URLs only (might 404):');
    for (const b of origOnly.slice(0, 10)) {
      console.log('  ' + (b.id || b._id).toString().slice(-8) + ' | ' + String(b.pages_count).padStart(4) + ' pp | ' + (b.language || '?').padEnd(10) + ' | ' + (b.title || '').slice(0, 55));
    }
  }

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
