/**
 * Local bulk OCR submission — bypasses the pipeline cron entirely.
 * Finds books at archive_complete with no OCR, submits via batch-ocr-async route.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/submit-batch-ocr.mjs [--count=20] [--max-pages=500] [--delay=5] [--dry-run] [--key=1]
 *
 * The route handles image download, prompt selection, and child-batch splitting.
 * This script just picks books and calls the route.
 *
 * API key rotation:
 *   --key=0  GEMINI_API_KEY_TIER3 (default)
 *   --key=1  GEMINI_API_KEY_2
 *   --key=2  GEMINI_API_KEY
 *   --key=auto  Round-robin across all keys
 */
import { MongoClient } from 'mongodb';

const BASE_URL = 'https://sourcelibrary.org';

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_COUNT = parseInt(getArg('count') || '20', 10);
const MAX_PAGES = parseInt(getArg('max-pages') || '500', 10);
const DELAY_SEC = parseInt(getArg('delay') || '5', 10);
const DRY_RUN = hasFlag('dry-run');
const KEY_ARG = getArg('key'); // 0, 1, 2, or 'auto'

// Count unique keys available
const uniqueKeys = [...new Set([
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY,
].filter(Boolean))];
const NUM_KEYS = uniqueKeys.length;

function getKeyIndex(bookIndex) {
  if (KEY_ARG === 'auto') return bookIndex % NUM_KEYS;
  if (KEY_ARG !== null && KEY_ARG !== undefined) return parseInt(KEY_ARG, 10);
  return undefined; // use route default
}

async function submitBatchOcr(bookId, cronSecret, apiKeyIndex) {
  const url = `${BASE_URL}/api/books/${bookId}/batch-ocr-async`;
  const body = { limit: 500, model: 'gemini-3-flash-preview' };
  if (apiKeyIndex !== undefined) body.apiKeyIndex = apiKeyIndex;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not set');
    process.exit(1);
  }

  console.log(`API keys available: ${NUM_KEYS}`);
  if (KEY_ARG === 'auto') console.log(`Key rotation: auto (round-robin across ${NUM_KEYS} keys)`);
  else if (KEY_ARG !== null) console.log(`Key rotation: fixed key index ${KEY_ARG}`);
  else console.log(`Key rotation: default (TIER3)`);

  // Find books ready for OCR with archived images
  const candidates = await db.collection('books').aggregate([
    { $match: {
      'pipeline_auto.status': 'archive_complete',
      pages_count: { $gt: 0, $lte: MAX_PAGES },
    }},
    // Verify at least one page has a working archived image
    { $lookup: {
      from: 'pages',
      let: { bid: '$id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$book_id', '$$bid'] } } },
        { $match: { archived_photo: { $regex: '^https://' } } },
        { $limit: 1 },
        { $project: { _id: 1 } },
      ],
      as: 'sample',
    }},
    { $match: { 'sample.0': { $exists: true } } },
    { $sort: { pages_count: 1 } },  // smallest first — fast wins
    { $limit: BOOK_COUNT },
    { $project: { id: 1, title: 1, pages_count: 1, language: 1 } },
  ]).toArray();

  console.log(`Found ${candidates.length} books at archive_complete with archived images (≤${MAX_PAGES}pp)`);

  if (candidates.length === 0) {
    console.log('Nothing to submit.');
    await client.close();
    return;
  }

  const totalPages = candidates.reduce((s, b) => s + (b.pages_count || 0), 0);
  console.log(`Will submit ${candidates.length} books, ~${totalPages} pages`);
  console.log(`Estimated cost: ~$${(totalPages * 0.0011).toFixed(2)} (batch pricing)`);
  console.log();

  if (DRY_RUN) {
    for (const b of candidates) {
      console.log(`  [dry-run] ${(b.language || '?').padEnd(10)} | ${String(b.pages_count).padStart(4)}pp | ${(b.title || '').slice(0, 60)}`);
    }
    console.log(`\nDry run — ${candidates.length} books would be submitted.`);
    await client.close();
    return;
  }

  let submitted = 0;
  let failed = 0;
  let pagesSubmitted = 0;
  let quotaExhaustedKey = null;

  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];
    const id = book.id || String(book._id);
    const keyIndex = getKeyIndex(i);
    const keyLabel = keyIndex !== undefined ? ` [key${keyIndex}]` : '';
    const label = `${(book.language || '?').padEnd(10)} | ${String(book.pages_count).padStart(4)}pp | ${(book.title || '').slice(0, 50)}`;

    process.stdout.write(`[${submitted + failed + 1}/${candidates.length}]${keyLabel} ${label} ... `);

    const result = await submitBatchOcr(id, cronSecret, keyIndex);

    if (result.status === 200) {
      const d = result.data;
      const pages = d.pagesSubmitted || d.totalPages || '?';
      const batches = d.batchCount || 1;
      console.log(`OK (${pages}pp, ${batches} batch${batches > 1 ? 'es' : ''})`);
      submitted++;
      pagesSubmitted += (typeof pages === 'number' ? pages : book.pages_count || 0);

      // Advance pipeline status so we don't re-submit this book
      await db.collection('books').updateOne(
        { id },
        { $set: {
          'pipeline_auto.status': 'ocr_submitted',
          'pipeline_auto.last_updated': new Date(),
          'pipeline_auto.ocr_job_name': d.jobName || d.parentJobId || null,
        }},
      );
    } else {
      const msg = result.data?.message || result.data?.error || JSON.stringify(result.data).slice(0, 150);

      if (result.status === 500 && JSON.stringify(result.data).includes('RESOURCE_EXHAUSTED')) {
        if (KEY_ARG === 'auto') {
          // In auto mode, mark this key as exhausted but try others
          if (quotaExhaustedKey === null) quotaExhaustedKey = keyIndex;
          console.log(`QUOTA EXHAUSTED (key${keyIndex})`);

          // If all keys are exhausted, stop
          if (quotaExhaustedKey !== null && keyIndex !== quotaExhaustedKey) {
            // We've seen exhaustion on a different key now — all keys hit
            console.log(`\nAll keys exhausted. Stopping after ${submitted} books, ${pagesSubmitted} pages.`);
            break;
          }
          failed++;
          continue;
        }
        console.log(`QUOTA EXHAUSTED`);
        console.log(`\nStopping — Gemini quota hit after ${submitted} books, ${pagesSubmitted} pages.`);
        break;
      }

      console.log(`FAIL ${result.status}: ${msg}`);
      failed++;
    }

    // Delay between submissions to let the route finish processing
    if (submitted + failed < candidates.length) {
      await new Promise(r => setTimeout(r, DELAY_SEC * 1000));
    }
  }

  console.log();
  console.log(`Done: ${submitted} submitted (${pagesSubmitted} pages), ${failed} failed`);
  console.log(`Estimated cost: ~$${(pagesSubmitted * 0.0011).toFixed(2)}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
