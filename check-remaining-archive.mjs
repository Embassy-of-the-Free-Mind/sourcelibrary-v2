import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // Total pages with OCR data
  const totalWithOcr = await db.collection('pages').countDocuments({
    'ocr.data': { $exists: true, $ne: null, $ne: '' }
  });

  // Pages already archived
  const archived = await db.collection('pages').countDocuments({
    'ocr.data': { $exists: true, $ne: null, $ne: '' },
    archived_photo: { $exists: true, $ne: null }
  });

  // Pages still needing archiving
  const remaining = totalWithOcr - archived;

  console.log('Archive Status:');
  console.log('Total pages with OCR: ' + totalWithOcr);
  console.log('Already archived: ' + archived);
  console.log('Still need archiving: ' + remaining);
  console.log('Progress: ' + Math.round(archived / totalWithOcr * 100) + '%');

} finally {
  await client.close();
}
