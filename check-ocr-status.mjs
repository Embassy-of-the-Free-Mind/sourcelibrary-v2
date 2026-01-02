import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const booksNeedingOCR = await db.collection('books').countDocuments({
    'ocr_status': { $in: [null, 'pending', 'queued'] }
  });

  const booksWithOCR = await db.collection('books').countDocuments({
    'ocr_status': 'completed'
  });

  const pendingJobs = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['queued', 'processing'] }
  });

  const succeededJobs = await db.collection('batch_jobs').countDocuments({
    status: 'succeeded'
  });

  console.log('Books needing OCR:', booksNeedingOCR);
  console.log('Books with OCR:', booksWithOCR);
  console.log('Pending batch jobs:', pendingJobs);
  console.log('Succeeded batch jobs:', succeededJobs);

} finally {
  await client.close();
}
