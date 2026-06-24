/**
 * Audit OCR-source drift (#2297 → unblocks #2298).
 *
 * Lists pages whose recorded OCR provenance (`ocr.source_url`, stamped by the
 * worker per #2297) does NOT match what the canonical resolver `getPageSource`
 * would pick today — i.e. the page was OCR'd from the wrong image (the
 * spread-instead-of-half bug class fixed forward in #2288/#2294).
 *
 * This is the precise, enumerable corrupted set the re-OCR repair (#2298)
 * re-queues — no aspect-ratio estimate needed once source_url is populated.
 *
 * Pages with no `ocr.source_url` are "pre-provenance" (OCR'd before #2297);
 * they are reported separately and fall back to the AR-sweep heuristic in #2298.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/audit-ocr-source-drift.mjs [--limit N] [--json]
 */
import { MongoClient } from 'mongodb';
import { getPageSource } from '../lib/page-image-url.mjs';

const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : 0;
})();
const AS_JSON = process.argv.includes('--json');

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const pages = client.db('bookstore').collection('pages');

// Only pages that actually have OCR + the provenance field. New-writes-only:
// pages OCR'd before #2297 won't have ocr.source_url and are excluded here
// (counted separately as the pre-provenance backlog).
const PROJ = {
  _id: 0, id: 1, book_id: 1, page_number: 1,
  'ocr.source_url': 1,
  cropped_photo: 1, photo: 1, archived_photo: 1, photo_original: 1,
  crop: 1, split_from_spread: 1,
};

const withProvenance = await pages.countDocuments({ 'ocr.source_url': { $exists: true, $ne: null } });
const ocrTotal = await pages.countDocuments({ 'ocr.data': { $exists: true, $ne: '' } });

const cursor = pages.find(
  { 'ocr.source_url': { $exists: true, $ne: null } },
  { projection: PROJ }
);

const drifted = [];
let scanned = 0;
for await (const p of cursor) {
  scanned++;
  const expected = getPageSource(p);
  if (expected && p.ocr.source_url !== expected) {
    drifted.push({ id: p.id, book_id: p.book_id, page_number: p.page_number, was: p.ocr.source_url, should_be: expected });
    if (LIMIT && drifted.length >= LIMIT) break;
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ ocrTotal, withProvenance, scanned, drifted: drifted.length, items: drifted }, null, 2));
} else {
  console.log(`OCR pages total:            ${ocrTotal}`);
  console.log(`  with source_url (#2297):  ${withProvenance}  (${ocrTotal ? (100 * withProvenance / ocrTotal).toFixed(1) : 0}%)`);
  console.log(`  pre-provenance backlog:   ${ocrTotal - withProvenance}  (use #2298 AR-sweep for these)`);
  console.log(`Scanned with provenance:    ${scanned}`);
  console.log(`DRIFTED (source ≠ resolver): ${drifted.length}  ← re-queue set for #2298`);
  for (const d of drifted.slice(0, 20)) {
    console.log(`  - ${d.book_id}/${d.page_number} (${d.id})`);
    console.log(`      was:       ${d.was}`);
    console.log(`      should_be: ${d.should_be}`);
  }
  if (drifted.length > 20) console.log(`  … and ${drifted.length - 20} more (use --json for full list)`);
}

await client.close();
