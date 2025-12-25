const { MongoClient } = require('mongodb');
const fs = require('fs');

// Load env file
const envFile = fs.readFileSync('.env.local', 'utf8');
const mongoMatch = envFile.match(/MONGODB_URI=(.+)/);
const MONGODB_URI = mongoMatch ? mongoMatch[1].trim() : process.env.MONGODB_URI;

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db();

  // Get results from both conditions
  const results = await db.collection('pipeline_experiment_results')
    .find({ experiment_id: '8dca8b5f-372e-4752-b4be-915828a8f8fa' })
    .toArray();

  // Group by page_id
  const byPage = {};
  results.forEach(r => {
    if (!byPage[r.page_id]) byPage[r.page_id] = {};
    byPage[r.page_id][r.condition_id] = r;
  });

  // Get judgments
  const judgments = await db.collection('pipeline_judgments')
    .find({ experiment_id: '8dca8b5f-372e-4752-b4be-915828a8f8fa' })
    .toArray();

  // Find pages where two_flash won decisively
  const twoPassWins = judgments.filter(j =>
    (j.winner === 'a' && j.condition_a === 'two_flash') ||
    (j.winner === 'b' && j.condition_b === 'two_flash')
  );

  // Show 3 examples
  let count = 0;
  const seen = new Set();

  for (const j of twoPassWins) {
    if (count >= 3) break;
    if (seen.has(j.page_id)) continue;
    seen.add(j.page_id);

    const pageResults = byPage[j.page_id];
    if (!pageResults || !pageResults.single_flash || !pageResults.two_flash) continue;

    console.log('\n================================================================================');
    console.log('PAGE:', j.page_id);
    console.log('================================================================================');

    console.log('\n--- SINGLE-PASS (Loser) ---');
    const singleTrans = pageResults.single_flash.translation || 'N/A';
    console.log(singleTrans.substring(0, 1000));
    if (singleTrans.length > 1000) console.log('...[truncated]');

    console.log('\n--- TWO-PASS (Winner) ---');
    const twoTrans = pageResults.two_flash.translation || 'N/A';
    console.log(twoTrans.substring(0, 1000));
    if (twoTrans.length > 1000) console.log('...[truncated]');

    console.log('\n--- TWO-PASS OCR (Latin) ---');
    const ocr = pageResults.two_flash.ocr || 'N/A';
    console.log(ocr.substring(0, 500));
    if (ocr.length > 500) console.log('...[truncated]');

    count++;
  }

  await client.close();
}

main().catch(console.error);
