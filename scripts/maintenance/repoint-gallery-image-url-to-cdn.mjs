/**
 * Repoint gallery_images.image_url to extracted_url for entries where image_url
 * is still upstream and a CDN extracted_url exists.
 *
 * Root cause is in scripts/workers/sync-worker.mjs:247 — image_url is sourced
 * from pages.cropped_photo || archived_photo || photo_original || photo, so
 * pages without cropped/archived versions fall through to the upstream IIIF
 * URL. This script fixes the materialized rows; the next gallery-sync for
 * the same books will undo the fix unless sync-worker.mjs is updated to
 * prefer detected_images.extracted_url. Flagged in the run report.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/repoint-gallery-image-url-to-cdn.mjs --dry-run
 *   node scripts/maintenance/repoint-gallery-image-url-to-cdn.mjs
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const R2_PREFIX = 'https://images.sourcelibrary.org';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

const filter = {
  image_url: { $regex: '^https?://(?!images\\.sourcelibrary\\.org)(?!3kwioilsplnmnkv8\\.public\\.blob)' },
  extracted_url: { $regex: `^${R2_PREFIX.replace(/\./g, '\\.')}/` },
};

const total = await db.collection('gallery_images').countDocuments(filter);
console.log(`Eligible (external image_url + CDN extracted_url): ${total}`);

if (DRY_RUN) {
  const sample = await db.collection('gallery_images').find(filter, {
    projection: { image_url: 1, extracted_url: 1, book_id: 1 },
    limit: 3,
  }).toArray();
  for (const s of sample) {
    console.log(`  ${s._id}`);
    console.log(`    image_url:     ${s.image_url}`);
    console.log(`    extracted_url: ${s.extracted_url}`);
  }
} else {
  const result = await db.collection('gallery_images').updateMany(
    filter,
    [{ $set: { image_url: '$extracted_url', image_url_repointed: true, updated_at: new Date() } }]
  );
  console.log(`Updated: ${result.modifiedCount}`);
}

// Stragglers: external image_url without a CDN extracted_url (rare)
const stragglers = await db.collection('gallery_images').countDocuments({
  image_url: { $regex: '^https?://(?!images\\.sourcelibrary\\.org)(?!3kwioilsplnmnkv8\\.public\\.blob)' },
});
console.log(`Remaining external image_url (no CDN extracted_url): ${stragglers}`);

await client.close();
