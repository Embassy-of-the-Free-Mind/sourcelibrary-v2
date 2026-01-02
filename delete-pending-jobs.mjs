import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // Delete pending OCR jobs
  const result = await db.collection('batch_jobs').deleteMany({
    type: 'ocr',
    status: 'pending'
  });

  console.log('Deleted pending OCR jobs: ' + result.deletedCount);

  // Get books with completed jobs
  const completedBookIds = await db.collection('batch_jobs').distinct('book_id', {
    type: 'ocr',
    status: 'saved'
  });

  console.log('Books with completed jobs: ' + completedBookIds.length);

  // Get total books
  const totalBooks = await db.collection('books').countDocuments();
  console.log('Total books in library: ' + totalBooks);
  console.log('Books still needing OCR: ' + (totalBooks - completedBookIds.length));

} finally {
  await client.close();
}
