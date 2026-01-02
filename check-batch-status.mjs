import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const jobs = await db.collection('batch_jobs').find({ type: 'ocr' }).toArray();
  
  console.log(`\nTotal OCR batch jobs: ${jobs.length}`);
  
  const byStatus = {};
  jobs.forEach(j => {
    byStatus[j.status] = (byStatus[j.status] || 0) + 1;
  });
  
  console.log('\nJobs by status:');
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  const succeeded = jobs.filter(j => j.status === 'succeeded');
  console.log(`\nSucceeded jobs: ${succeeded.length}`);

} finally {
  await client.close();
}
