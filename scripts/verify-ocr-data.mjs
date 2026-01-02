import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URI || !MONGODB_DB) {
  console.error('MONGODB_URI or MONGODB_DB not set');
  process.exit(1);
}

async function verifyOCRData() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  console.log(`Connected to database: ${MONGODB_DB}\n`);

  // Get some completed batch jobs
  const completedJobs = await db.collection('batch_jobs')
    .find({ status: 'completed', type: 'ocr' })
    .limit(5)
    .toArray();

  console.log(`Found ${completedJobs.length} completed OCR jobs\n`);

  for (const job of completedJobs) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Book: ${job.book_title}`);
    console.log(`Book ID: ${job.book_id}`);
    console.log(`Job ID: ${job.id}`);
    console.log(`Job Status: ${job.status} (Gemini: ${job.gemini_state})`);
    console.log(`Total Pages in Job: ${job.total_pages}`);

    // Count pages with OCR for this book
    const pagesWithOCR = await db.collection('pages')
      .countDocuments({
        book_id: job.book_id,
        'ocr.data': { $exists: true, $ne: '', $ne: null }
      });

    console.log(`Pages with OCR in DB: ${pagesWithOCR}`);

    // Get a sample page with OCR
    const samplePage = await db.collection('pages')
      .findOne({
        book_id: job.book_id,
        'ocr.data': { $exists: true, $ne: '', $ne: null }
      });

    if (samplePage) {
      const ocrText = samplePage.ocr?.data || '';
      const ocrLength = ocrText.length;
      const ocrSample = ocrText.substring(0, 200);

      console.log(`\nSample OCR (Page ${samplePage.page_number}):`);
      console.log(`  Model: ${samplePage.ocr?.model || 'Unknown'}`);
      console.log(`  Length: ${ocrLength} characters`);
      console.log(`  Text: "${ocrSample}${ocrLength > 200 ? '...' : ''}"`);
    } else {
      console.log('\n  NO OCR DATA FOUND IN DATABASE');
    }
  }

  // Overall stats
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('OVERALL DATABASE STATS');
  console.log(`${'='.repeat(70)}`);

  const totalPages = await db.collection('pages').countDocuments({});
  const pagesWithOCR = await db.collection('pages').countDocuments({
    'ocr.data': { $exists: true, $ne: '', $ne: null }
  });
  const pagesWithTranslation = await db.collection('pages').countDocuments({
    'translation.data': { $exists: true, $ne: '', $ne: null }
  });

  console.log(`Total pages: ${totalPages}`);
  console.log(`Pages with OCR: ${pagesWithOCR} (${((pagesWithOCR/totalPages)*100).toFixed(1)}%)`);
  console.log(`Pages with translation: ${pagesWithTranslation} (${((pagesWithTranslation/totalPages)*100).toFixed(1)}%)`);

  await client.close();
}

verifyOCRData().catch(console.error);
