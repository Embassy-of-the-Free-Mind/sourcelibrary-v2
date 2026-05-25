#!/usr/bin/env node
/**
 * Backfill `erara_doi` (and `erara_id` when missing) for e-rara books that
 * are missing the persistent identifier. The e-rara title page OCR contains
 * a `Persistent Link: https://doi.org/10.3931/e-rara-XXXXX` marker; we extract
 * the trailing numeric ID and reconstruct the canonical DOI form, tolerating
 * common OCR errors in the prefix (e.g. "10.103931" instead of "10.3931").
 *
 * Usage:
 *   node scripts/maintenance/backfill-erara-doi.mjs           # dry-run
 *   node scripts/maintenance/backfill-erara-doi.mjs --apply
 *   node scripts/maintenance/backfill-erara-doi.mjs --limit 20
 */
import { MongoClient, ObjectId } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();
const PAGES_PER_BOOK = 5;

// Match either the clean prefix or common OCR variants. The trailing
// numeric e-rara id is what we care about — reconstruct the DOI canonically.
const DOI_RX = /10\.\d{4,6}\/e-rara-(\d{3,7})/i;
// Fallback: a Persistent Link line that might have OCR damage but still
// contains the bare e-rara id.
const PLAIN_ID_RX = /e-rara[- ](\d{3,7})/i;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const cursor = db.collection('books').find(
  {
    'image_source.provider': 'e-rara',
    $or: [{ erara_doi: { $exists: false } }, { erara_doi: null }],
  },
  { projection: { _id: 1, title: 1, erara_id: 1 } }
);

let scanned = 0, noOcr = 0, noMatch = 0, wouldWrite = 0, written = 0;
const samples = [];

for await (const book of cursor) {
  if (scanned >= LIMIT) break;
  scanned++;

  const bookId = String(book._id);
  const pages = await db.collection('pages').find(
    { book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } },
    { projection: { page_number: 1, 'ocr.data': 1 } }
  ).sort({ page_number: 1 }).limit(PAGES_PER_BOOK).toArray();

  if (pages.length === 0) { noOcr++; continue; }

  // Look first for the strict DOI pattern across sampled pages
  let eraraId = null, matchedPage = null, source = null;
  for (const p of pages) {
    const m = (p.ocr?.data || '').match(DOI_RX);
    if (m) { eraraId = m[1]; matchedPage = p.page_number; source = 'doi'; break; }
  }
  // Fallback: scan only near a "Persistent Link" hint to reduce false positives
  if (!eraraId) {
    for (const p of pages) {
      const data = p.ocr?.data || '';
      const hint = data.match(/Persistent Link[^]*?(?=<|$)/i);
      if (hint) {
        const m = hint[0].match(PLAIN_ID_RX);
        if (m) { eraraId = m[1]; matchedPage = p.page_number; source = 'persistent_link'; break; }
      }
    }
  }

  if (!eraraId) { noMatch++; continue; }

  const doi = `10.3931/e-rara-${eraraId}`;
  wouldWrite++;
  if (samples.length < 15) samples.push({
    id: bookId.slice(-8),
    title: book.title?.slice(0, 55),
    extracted_id: eraraId,
    canonical_doi: doi,
    matched_page: matchedPage,
    source,
    existing_erara_id: book.erara_id || null,
  });

  if (APPLY) {
    const set = {
      erara_doi: doi,
      'image_source.doi': doi,
      'image_source.source_url': `https://www.e-rara.ch/doi/${doi}`,
      _erara_doi_backfill: {
        at: new Date(),
        source,
        matched_page: matchedPage,
      },
    };
    if (!book.erara_id) set.erara_id = eraraId;
    const res = await db.collection('books').updateOne({ _id: book._id }, { $set: set });
    if (res.modifiedCount > 0) written++;
  }
}

console.log(`Scanned: ${scanned}`);
console.log(`  no OCR pages: ${noOcr}`);
console.log(`  OCR but no DOI / e-rara id found: ${noMatch}`);
console.log(`  ${APPLY ? 'wrote' : 'would write'}: ${APPLY ? written : wouldWrite}`);

console.log('\nSample (first 15):');
for (const s of samples) {
  console.log(`  ${s.id} p${s.matched_page} (${s.source}) "${s.title}"`);
  console.log(`    → ${s.canonical_doi}  erara_id: ${s.existing_erara_id ? `(keep ${s.existing_erara_id})` : `(set ${s.extracted_id})`}`);
}

if (!APPLY) console.log('\nDRY RUN — re-run with --apply to commit.');

await client.close();
