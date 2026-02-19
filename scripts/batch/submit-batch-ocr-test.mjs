/**
 * Submit batch OCR for books with no OCR and working archived images.
 * Submits full books (up to 500 pages) — the route handles child-batch splitting.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/submit-batch-ocr-test.mjs [--count=3] [--max-pages=200]
 */
import { MongoClient } from 'mongodb';

const BASE_URL = 'https://sourcelibrary.org';

const args = process.argv.slice(2);
const getArg = (name) => {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split('=')[1] : null;
};
const BOOK_COUNT = parseInt(getArg('count') || '3', 10);
const MAX_PAGES = parseInt(getArg('max-pages') || '200', 10);

async function submitBatchOcr(bookId, cronSecret) {
  const url = `${BASE_URL}/api/books/${bookId}/batch-ocr-async`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cronSecret}`
    },
    body: JSON.stringify({ limit: 500, model: 'gemini-3-flash-preview' })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
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

  // Find books with no OCR and good archived images
  const candidates = await db.collection('books').aggregate([
    { $match: {
      'pipeline_auto.status': 'archive_complete',
      pages_count: { $gt: 50, $lte: MAX_PAGES },
      $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }, { pages_ocr: null }]
    }},
    { $sort: { pages_count: 1 } },
    { $limit: 200 },
    { $lookup: {
      from: 'pages',
      let: { bid: '$id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$book_id', '$$bid'] } } },
        { $limit: 1 },
        { $project: { archived_photo: 1 } }
      ],
      as: 'sample'
    }},
    { $unwind: '$sample' },
    { $match: { 'sample.archived_photo': { $regex: '^https://' } } },
    { $project: { id: 1, title: 1, pages_count: 1, language: 1 } }
  ]).toArray();

  console.log(`Found ${candidates.length} books with archived images and no OCR (≤${MAX_PAGES}pp)`);

  // Pick books: prefer variety of languages
  const picked = [];
  const langSeen = {};
  for (const b of candidates) {
    const lang = b.language || 'Unknown';
    if (!langSeen[lang]) {
      picked.push(b);
      langSeen[lang] = true;
      if (picked.length >= BOOK_COUNT) break;
    }
  }
  if (picked.length < BOOK_COUNT) {
    const pickedIds = new Set(picked.map(b => String(b.id || b._id)));
    for (const b of candidates) {
      if (!pickedIds.has(String(b.id || b._id))) {
        picked.push(b);
        if (picked.length >= BOOK_COUNT) break;
      }
    }
  }

  const totalPages = picked.reduce((s, b) => s + (b.pages_count || 0), 0);
  console.log(`Selected ${picked.length} books, ${totalPages} pages`);
  console.log(`Estimated cost: $${(totalPages * 0.00175).toFixed(2)} (batch pricing)`);
  console.log();

  let submitted = 0;
  let failed = 0;

  for (const book of picked) {
    const id = book.id || String(book._id);
    const label = `${(book.language || '?').padEnd(10)} | ${String(book.pages_count).padStart(4)} pp | ${(book.title || '').slice(0, 50)}`;

    console.log(`Submitting: ${label}`);
    const result = await submitBatchOcr(id, cronSecret);

    if (result.status === 200) {
      const d = result.data;
      const pages = d.pagesSubmitted || '?';
      const batches = d.batchCount || 1;
      console.log(`  OK  → ${pages} pages in ${batches} batch${batches > 1 ? 'es' : ''}`);
      if (d.jobNames?.length > 1) {
        console.log(`        Parent: ${d.parentJobId}, children: ${d.jobNames.length}`);
      } else {
        console.log(`        Job: ${String(d.jobName || '').slice(-40)}`);
      }
      submitted++;
    } else {
      const msg = result.data?.message || result.data?.error || JSON.stringify(result.data).slice(0, 150);
      console.log(`  ${result.status} → ${msg}`);
      if (result.status === 500 && JSON.stringify(result.data).includes('RESOURCE_EXHAUSTED')) {
        console.log('\nQuota exhausted — stopping.');
        break;
      }
      failed++;
    }

    // 3s delay between submissions (route now downloads images which takes time)
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log();
  console.log(`Done: ${submitted} submitted, ${failed} failed`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
