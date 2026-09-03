#!/usr/bin/env node
/**
 * Report pages that hold a `<detected-images>` block in `ocr.data` but no
 * `detected_images` field — and, for each, which shape the block is in.
 *
 * ## Why this exists (#4456)
 *
 * Five pipeline scripts carried a `parseDetectedImages` that walked
 * `<image>…</image>` sub-tags. No OCR prompt in this repo has ever asked for that
 * shape — the prompt asks for a JSON array — so those parsers returned `[]` on
 * every page, and the `if (detectedImages.length > 0)` guard at each write site
 * turned the loss into silence. #4456 pointed all five at the canonical JSON
 * parser in `scripts/lib/ocr-result-parse.mjs`.
 *
 * This is the report that would have caught it, and the one that says whether a
 * backfill of the pages already lost is worth running. It answers three questions
 * that must not be conflated:
 *
 *   1. how many pages hold a block at all;
 *   2. how many of those are XML-shaped — i.e. whether an XML fallback would ever
 *      pay for itself (measured 2026-08-31: **0 of 31,210**, corpus-wide, so no);
 *   3. how many hold a block the canonical parser CAN read and still have no
 *      `detected_images` field. That is the repair set.
 *
 * Note (3) is not the same as "pages the collectors lost". `realtime-ocr.mjs` and
 * `realtime-reocr-efm.mjs` stamp `ocr.source: 'ai'`, the same label the canonical
 * Lambda path uses, so `ocr.source` cannot separate a script-side loss from a
 * page whose block simply failed to parse. Don't quote the `ai` bucket as if it
 * were all this defect.
 *
 * Usage:
 *   node --env-file=.env.local scripts/audit/detected-images-parse-gap.mjs [--sample N] [--full]
 *
 *   --sample N   estimate from a random sample of N pages (default 30000). Fast,
 *                but blocks are rare (~0.15% of pages), so a sample of 30k finds
 *                only ~45 of them — good enough for a shape check, useless for a
 *                count. Prints the scale factor so you can see the error bars.
 *   --full       exact count over every page holding a block. Unindexed regex
 *                scan of ~21M documents; measured at 76 minutes. Use for the
 *                number you intend to write down.
 *
 * Exits 2 if the database is unreachable — that is UNKNOWN, not clear.
 */
import { MongoClient } from 'mongodb';
import { parseDetectedImages } from '../lib/ocr-result-parse.mjs';

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const SAMPLE_SIZE = Number(args[args.indexOf('--sample') + 1]) || 30000;

// A block is "XML-shaped" if an <image> tag opens inside it. Bounded look-ahead so
// the regex cannot run away on a page whose closing tag the model dropped.
const XML_SHAPED = /<detected-images>[\s\S]{0,4000}?<image>/i;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(2);
}

let mc;
try {
  mc = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 3_600_000 });
  await mc.connect();
} catch (err) {
  console.error(`Cannot reach the database: ${err.message}`);
  process.exit(2);
}

const pages = mc.db('bookstore').collection('pages');
const t0 = Date.now();

/** Group counts by (ocr.source, has the field, is XML-shaped). */
const groupStage = {
  $group: {
    _id: {
      source: { $ifNull: ['$ocr.source', '(none)'] },
      hasField: { $gt: [{ $size: { $ifNull: ['$detected_images', []] } }, 0] },
      xml: { $regexMatch: { input: { $ifNull: ['$ocr.data', ''] }, regex: XML_SHAPED } },
    },
    n: { $sum: 1 },
    books: { $addToSet: '$book_id' },
  },
};
const projectStage = { $project: { n: 1, bookCount: { $size: '$books' } } };

const pipeline = FULL
  ? [{ $match: { 'ocr.data': /<detected-images>/i } }, groupStage, projectStage]
  : [
      { $sample: { size: SAMPLE_SIZE } },
      { $match: { 'ocr.data': /<detected-images>/i } },
      groupStage,
      projectStage,
    ];

const rows = await pages
  .aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 3_500_000 })
  .toArray();

const totalPages = await pages.estimatedDocumentCount();
const withBlock = rows.reduce((a, r) => a + r.n, 0);
const xmlShaped = rows.filter((r) => r._id.xml).reduce((a, r) => a + r.n, 0);
const missingField = rows.filter((r) => !r._id.hasField);
const missingTotal = missingField.reduce((a, r) => a + r.n, 0);

const scale = FULL ? 1 : totalPages / SAMPLE_SIZE;
const est = (n) => (FULL ? n.toLocaleString() : `~${Math.round(n * scale).toLocaleString()} est.`);

console.log(FULL ? 'MODE: full scan (exact)' : `MODE: sample of ${SAMPLE_SIZE.toLocaleString()} (scale ${scale.toFixed(0)}x — shape check only)`);
console.log(`pages in collection: ${totalPages.toLocaleString()}\n`);
console.log(`holding a <detected-images> block: ${est(withBlock)}${FULL ? '' : ` (${withBlock} sampled)`}`);
console.log(`  of those, XML <image>-shaped:    ${est(xmlShaped)}   <- an XML fallback is worth keeping only if this is non-zero`);
console.log(`  of those, no detected_images:    ${est(missingTotal)}   <- the repair set\n`);

console.log('breakdown by ocr.source (missing the field only):');
for (const r of missingField.sort((a, b) => b.n - a.n)) {
  const label = `${r._id.source}${r._id.xml ? ' [xml-shaped]' : ''}`;
  console.log(`  ${label.padEnd(24)} pages=${est(r.n).padStart(14)}  books=${r.bookCount}`);
}
if (!missingField.length) console.log('  (none)');

// Does the canonical parser actually recover anything from the repair set? A block
// the parser cannot read is not a loss this defect caused — it is malformed model
// output, and a backfill would leave it exactly as it is.
console.log('\nparse check on a sample of the repair set:');
const sample = await pages
  .aggregate(
    [
      {
        $match: {
          'ocr.data': /<detected-images>/i,
          $or: [{ detected_images: { $exists: false } }, { detected_images: { $size: 0 } }],
        },
      },
      { $limit: 200 },
      { $project: { id: 1, 'ocr.data': 1, 'ocr.source': 1 } },
    ],
    { allowDiskUse: true },
  )
  .toArray();

let recoverable = 0;
let unrecoverable = 0;
for (const p of sample) {
  if (parseDetectedImages(p.ocr?.data).length > 0) recoverable++;
  else unrecoverable++;
}
console.log(`  sampled ${sample.length}: ${recoverable} recoverable by the canonical parser, ${unrecoverable} not (malformed or description-less)`);

console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await mc.close();
