import { MongoClient } from 'mongodb';
import { config } from 'dotenv';

// Load .env.local
config({ path: '.env.local' });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_DB) {
  console.error('MONGODB_DB environment variable not set');
  process.exit(1);
}

async function bulkSaveResults() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  console.log(`Connected to database: ${MONGODB_DB}`);

  const listUrl = `https://generativelanguage.googleapis.com/v1beta/batches?key=${GEMINI_API_KEY}&pageSize=100`;
  const listResp = await fetch(listUrl);
  const listData = await listResp.json();

  const succeeded = (listData.operations || []).filter(op => op.metadata?.state === 'BATCH_STATE_SUCCEEDED');
  console.log(`Processing ${succeeded.length} succeeded batches...`);

  let totalUpdates = 0;

  for (const op of succeeded) {
    const jobUrl = `https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${GEMINI_API_KEY}`;
    const jobResp = await fetch(jobUrl);
    const jobData = await jobResp.json();

    const model = jobData.metadata?.model?.replace('models/', '') || 'gemini-3-flash-preview';
    const responses = jobData.metadata?.output?.inlinedResponses?.inlinedResponses || [];

    const bulkOps = [];
    const now = new Date();

    for (const resp of responses) {
      const pageId = resp.metadata?.key;
      const text = resp.response?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (pageId && text) {
        bulkOps.push({
          updateOne: {
            filter: { id: pageId },
            update: {
              $set: {
                ocr: {
                  data: text,
                  model: model,
                  language: 'Latin',
                  created_at: now,
                  source: 'batch_api'
                },
                updated_at: now
              }
            }
          }
        });
      }
    }

    if (bulkOps.length > 0) {
      const result = await db.collection('pages').bulkWrite(bulkOps);
      totalUpdates += result.modifiedCount;
      process.stdout.write(`[${result.modifiedCount}]`);
    } else {
      process.stdout.write('.');
    }
  }

  await client.close();
  console.log(`\n\nTotal pages updated: ${totalUpdates}`);
}

bulkSaveResults().catch(console.error);
