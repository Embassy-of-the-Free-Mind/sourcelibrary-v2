#!/usr/bin/env node
/**
 * Downvote printer marks, publisher devices, headpieces, tailpieces, and
 * similar non-content ornamental images to 0.65 quality (below the 0.7
 * threshold used by collections/libraries pages).
 *
 * These are historically interesting but shouldn't dominate collection views.
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_QUALITY = 0.65;

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const gi = db.collection('gallery_images');
  const pages = db.collection('pages');

  const filter = {
    gallery_quality: { $gte: 0.7 },
    $or: [
      // Printer's marks and devices
      { description: { $regex: "printer.?s?.*(mark|device)", $options: 'i' } },
      { description: { $regex: "publisher.?s?.*(mark|device|seal|logo|emblem)", $options: 'i' } },
      { description: { $regex: "colophon.*(device|mark|woodcut)", $options: 'i' } },
      // Headpieces, tailpieces, fleurons
      { description: { $regex: "\\btailpiece\\b", $options: 'i' } },
      { description: { $regex: "\\bheadpiece\\b", $options: 'i' } },
      { description: { $regex: "\\bfleuron\\b", $options: 'i' } },
      // Type-based
      { type: 'printers_mark' },
    ],
  };

  const count = await gi.countDocuments(filter);
  console.log(`Non-content ornamental images found (>=0.7): ${count}`);

  if (DRY_RUN) {
    // Type breakdown
    const typeBreakdown = {};
    const samples = await gi.find(filter)
      .project({ id: 1, type: 1, gallery_quality: 1, description: 1 })
      .sort({ gallery_quality: -1 })
      .toArray();
    for (const s of samples) {
      typeBreakdown[s.type] = (typeBreakdown[s.type] || 0) + 1;
    }
    console.log('\nType breakdown:');
    for (const [type, n] of Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${n}`);
    }
    console.log('\nSamples (first 25):');
    for (const s of samples.slice(0, 25)) {
      console.log(`  [${s.gallery_quality}] ${s.type} | ${s.description?.substring(0, 100)}`);
    }
    await client.close();
    return;
  }

  // Get affected images for page sync
  const affected = await gi.find(filter)
    .project({ page_id: 1, detection_index: 1 })
    .toArray();

  // Update gallery_images
  const result = await gi.updateMany(filter, { $set: { gallery_quality: TARGET_QUALITY } });
  console.log(`Updated gallery_images: ${result.modifiedCount}`);

  // Sync page detections
  let pageUpdates = 0;
  let pageErrors = 0;
  for (const img of affected) {
    if (img.page_id && img.detection_index !== undefined) {
      try {
        await pages.updateOne(
          { id: img.page_id },
          { $set: { [`detected_images.${img.detection_index}.gallery_quality`]: TARGET_QUALITY } }
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
