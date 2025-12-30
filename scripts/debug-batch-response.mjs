/**
 * Debug: Check what Gemini returns for a completed batch job
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.local' });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function debug() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // Get one completed job
  const job = await db.collection('batch_jobs').findOne({
    gemini_state: 'BATCH_STATE_SUCCEEDED',
    status: { $ne: 'saved' }
  });

  if (!job) {
    console.log('No completed jobs found');
    await client.close();
    return;
  }

  console.log('Job:', job.book_title);
  console.log('Gemini job name:', job.gemini_job_name);

  // Get job details
  const res = await fetch(`${API_BASE}/${job.gemini_job_name}?key=${API_KEY}`);
  const data = await res.json();

  console.log('\n=== Full API Response ===');
  console.log(JSON.stringify(data, null, 2));

  await client.close();
}

debug().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
