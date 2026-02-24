#!/usr/bin/env node
/**
 * Downvote non-content gallery images: pelican bookplates, marbled paper,
 * book bindings, endpapers, ex libris stamps. Sets quality to 0.3.
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const gi = db.collection('gallery_images');
  const pages = db.collection('pages');

  const PAGES_ONLY = process.argv.includes('--pages-only');

  const descOr = [
    { description: { $regex: 'pelican.*(piety|hermet)|hermetic.*pelican', $options: 'i' } },
    { description: { $regex: 'marbled.*(paper|endpaper)', $options: 'i' } },
    { description: { $regex: 'book.?binding|book.?cover|leather.?binding|half-leather|front cover|back cover', $options: 'i' } },
    { description: { $regex: 'endpaper', $options: 'i' } },
    { description: { $regex: 'ex.libris|bookplate|library.stamp|ownership.stamp', $options: 'i' } },
  ];

  const nonContentFilter = {
    gallery_quality: PAGES_ONLY ? 0.3 : { $gte: 0.5 },
    $or: descOr,
  };

  const count = await gi.countDocuments(nonContentFilter);
  console.log(`Non-content images found: ${count}`);

  if (DRY_RUN) {
    const samples = await gi.find(nonContentFilter)
      .project({ id: 1, type: 1, gallery_quality: 1, description: 1 })
      .limit(20).toArray();
    for (const s of samples) {
      console.log(`  [${s.gallery_quality}] ${s.type} | ${s.description?.substring(0, 70)}`);
    }
    await client.close();
    return;
  }

  // Get affected images (need page_id + detection_index for page sync)
  const affected = await gi.find(nonContentFilter)
    .project({ page_id: 1, detection_index: 1 })
    .toArray();

  // Update gallery_images
  if (!PAGES_ONLY) {
    const result = await gi.updateMany(nonContentFilter, { $set: { gallery_quality: 0.3 } });
    console.log(`Updated gallery_images: ${result.modifiedCount}`);
  } else {
    console.log('Skipping gallery_images update (--pages-only)');
  }

  // Update source page detections (continue on errors)
  let pageUpdates = 0;
  let pageErrors = 0;
  for (const img of affected) {
    if (img.page_id && img.detection_index !== undefined) {
      try {
        await pages.updateOne(
          { id: img.page_id },
          { $set: { [`detected_images.${img.detection_index}.gallery_quality`]: 0.3 } }
        );
        pageUpdates++;
      } catch (err) {
        pageErrors++;
      }
    }
  }
  console.log(`Updated page detections: ${pageUpdates} (${pageErrors} errors)`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
