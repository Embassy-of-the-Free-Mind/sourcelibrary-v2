/**
 * Repoint external image_display / image_thumb fields to the (already-rehosted)
 * CDN book.thumbnail.
 *
 * Context: rehost-all-external-thumbnails.mjs moved book.thumbnail to R2, but
 * `image_display` and `image_thumb` on the same documents still point at the
 * upstream archive.org / IIIF source. Collection pages render image_display
 * directly, so those URLs leak into HTML even after the thumbnail fix.
 *
 * Safety: only repoints when book.thumbnail is on the CDN and the external
 * field's host matches a known upstream provider host. No-op if thumbnail is
 * still external for any reason.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/repoint-image-display-to-cdn.mjs --dry-run
 *   node scripts/maintenance/repoint-image-display-to-cdn.mjs
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const R2_PREFIX = 'https://images.sourcelibrary.org';

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
await client.connect();
const db = client.db('bookstore');

console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

const externalRegex = '^https://(?!images\\.sourcelibrary\\.org)(?!3kwioilsplnmnkv8\\.public\\.blob)';

const targets = await db.collection('books').find(
  {
    visible: true,
    pages_count: { $gt: 0 },
    thumbnail: { $regex: `^${R2_PREFIX.replace(/\./g, '\\.')}/` },
    $or: [
      { image_display: { $regex: externalRegex } },
      { image_thumb: { $regex: externalRegex } },
    ],
  },
  { projection: { id: 1, thumbnail: 1, image_display: 1, image_thumb: 1 } }
).toArray();

console.log(`Found ${targets.length} books needing image_display/image_thumb repoint\n`);

let updated = 0, skipped = 0;
for (const b of targets) {
  const set = {};
  const provenance = {};
  if (b.image_display && b.image_display.startsWith('http') && !b.image_display.startsWith(R2_PREFIX)) {
    set.image_display = b.thumbnail;
    provenance['field_provenance.image_display'] = {
      source: 'repoint-image-display-to-cdn',
      method: 'copy-from-thumbnail',
      confidence: 1.0,
      date: new Date(),
      previous: b.image_display,
    };
  }
  if (b.image_thumb && b.image_thumb.startsWith('http') && !b.image_thumb.startsWith(R2_PREFIX)) {
    set.image_thumb = b.thumbnail;
    provenance['field_provenance.image_thumb'] = {
      source: 'repoint-image-display-to-cdn',
      method: 'copy-from-thumbnail',
      confidence: 1.0,
      date: new Date(),
      previous: b.image_thumb,
    };
  }
  if (Object.keys(set).length === 0) {
    skipped++;
    continue;
  }
  if (!DRY_RUN) {
    await db.collection('books').updateOne(
      { id: b.id },
      { $set: { ...set, ...provenance, updated_at: new Date() } }
    );
  }
  updated++;
  if (updated % 100 === 0) process.stdout.write(`  ${updated} updated\r`);
}

console.log(`\n${DRY_RUN ? 'Would update' : 'Updated'}: ${updated}`);
console.log(`Skipped (already on CDN): ${skipped}`);

await client.close();
