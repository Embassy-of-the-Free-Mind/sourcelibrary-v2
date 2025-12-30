/**
 * Check OCR progress across the library
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.local' });

async function checkStatus() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // Count pages with OCR
  const totalPages = await db.collection('pages').countDocuments({});
  const pagesWithOcr = await db.collection('pages').countDocuments({
    'ocr.data': { $exists: true, $ne: null, $ne: '' }
  });
  const pagesWithTranslation = await db.collection('pages').countDocuments({
    'translation.data': { $exists: true, $ne: null, $ne: '' }
  });

  // Count batch jobs by status
  const batchJobs = await db.collection('batch_jobs').aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]).toArray();

  // Count books
  const totalBooks = await db.collection('books').countDocuments({});

  console.log('=== Source Library OCR Status ===\n');
  console.log(`Total books: ${totalBooks}`);
  console.log(`Total pages: ${totalPages}`);
  console.log(`Pages with OCR: ${pagesWithOcr} (${(pagesWithOcr/totalPages*100).toFixed(1)}%)`);
  console.log(`Pages with translation: ${pagesWithTranslation} (${(pagesWithTranslation/totalPages*100).toFixed(1)}%)`);
  console.log(`\nPages needing OCR: ${totalPages - pagesWithOcr}`);
  console.log(`Pages needing translation: ${pagesWithOcr - pagesWithTranslation}`);

  console.log('\nBatch job status:');
  for (const job of batchJobs) {
    console.log(`  ${job._id}: ${job.count}`);
  }

  await client.close();
}

checkStatus().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
