import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Approach: query books collection (small), then spot-check pages

  // 1. Pipeline status breakdown
  const pipeline = await db.collection('books').aggregate([
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 }, pages: { $sum: '$pages_count' } } },
    { $sort: { count: -1 } }
  ], { maxTimeMS: 30000 }).toArray();

  console.log('=== Pipeline Status ===');
  for (const p of pipeline) {
    console.log(`  ${p._id || 'null'}: ${p.count} books, ${p.pages} pages`);
  }

  // 2. Provider breakdown
  const providers = await db.collection('books').aggregate([
    { $match: { pages_count: { $gt: 0 } } },
    { $group: { _id: '$image_source.provider', count: { $sum: 1 }, pages: { $sum: '$pages_count' } } },
    { $sort: { pages: -1 } }
  ], { maxTimeMS: 30000 }).toArray();

  console.log('\n=== By Provider ===');
  for (const p of providers) {
    console.log(`  ${p._id || 'null'}: ${p.count} books, ${p.pages} pages`);
  }

  // 3. Books not yet in pipeline (no pipeline_auto.status, or stuck early)
  const notInPipeline = await db.collection('books').find({
    pages_count: { $gt: 0 },
    $or: [
      { 'pipeline_auto.status': { $exists: false } },
      { 'pipeline_auto.status': null }
    ]
  }).project({ id: 1, title: 1, 'image_source.provider': 1, pages_count: 1, _id: 0 })
    .sort({ pages_count: -1 })
    .limit(30)
    .toArray();

  const notInPipelineCount = await db.collection('books').countDocuments({
    pages_count: { $gt: 0 },
    $or: [
      { 'pipeline_auto.status': { $exists: false } },
      { 'pipeline_auto.status': null }
    ]
  });

  console.log(`\n=== Not in Pipeline (${notInPipelineCount} books) ===`);
  console.log('Top 30 by page count:');
  for (const b of notInPipeline) {
    console.log(`  ${b.pages_count} pages | ${b.image_source?.provider || '?'} | ${(b.title || '').substring(0, 60)}`);
  }

  // 4. Books stuck in early pipeline stages (queued or archiving)
  const earlyStage = await db.collection('books').find({
    'pipeline_auto.status': { $in: ['queued', 'archiving'] }
  }).project({ id: 1, title: 1, 'pipeline_auto': 1, pages_count: 1, 'image_source.provider': 1, _id: 0 })
    .sort({ 'pipeline_auto.queued_at': 1 })
    .limit(20)
    .toArray();

  console.log(`\n=== Stuck in Early Stages (queued/archiving) ===`);
  for (const b of earlyStage) {
    const age = b.pipeline_auto?.queued_at
      ? Math.round((Date.now() - new Date(b.pipeline_auto.queued_at).getTime()) / 86400000) + 'd ago'
      : '?';
    console.log(`  ${b.pipeline_auto?.status} | ${b.pages_count} pages | ${age} | ${b.image_source?.provider || '?'} | ${(b.title || '').substring(0, 50)}`);
  }

  // 5. Spot-check: for books with provider=ia, how many pages have archived_photo?
  // Pick 10 random IA books that are "complete" in pipeline
  const iaComplete = await db.collection('books').find({
    'image_source.provider': 'ia',
    'pipeline_auto.status': 'complete',
    pages_count: { $gt: 0 }
  }).project({ id: 1, title: 1, pages_count: 1, _id: 0 }).limit(5).toArray();

  console.log('\n=== Spot Check: IA "complete" books ===');
  for (const b of iaComplete) {
    const archivedCount = await db.collection('pages').countDocuments({
      book_id: b.id,
      archived_photo: { $exists: true, $ne: null, $ne: '' }
    });
    console.log(`  ${archivedCount}/${b.pages_count} archived | ${(b.title || '').substring(0, 60)}`);
  }

  // 6. Check the 74 books from the broken thumbnail fix that had NO replacement
  // These are likely IA books without archived pages
  const noThumbBooks = await db.collection('books').find({
    thumbnail: { $regex: /archive\.org\/download/ },
    pages_count: { $gt: 0 }
  }).project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.status': 1, 'image_source.provider': 1, _id: 0 })
    .limit(20)
    .toArray();

  console.log('\n=== Books still using broken IA thumbnails ===');
  for (const b of noThumbBooks) {
    const hasArchived = await db.collection('pages').countDocuments({
      book_id: b.id,
      $or: [
        { archived_photo: { $exists: true, $ne: null, $ne: '' } },
        { thumbnail_blob: { $exists: true, $ne: null, $ne: '' } },
        { cropped_photo: { $exists: true, $ne: null, $ne: '' } }
      ]
    });
    console.log(`  ${hasArchived}/${b.pages_count} have local images | ${b.pipeline_auto?.status || '-'} | ${(b.title || '').substring(0, 50)}`);
  }

  await client.close();
}

main();
