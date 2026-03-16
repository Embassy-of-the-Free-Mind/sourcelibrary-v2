#!/usr/bin/env node
/**
 * Regenerate gallery images for split pages.
 *
 * Problem: Gallery backfill ran before page splitting, so bboxes (computed against
 * cropped_photo) were applied to archived_photo (full spread), producing wrong crops.
 *
 * Fix: Clear extracted_url/thumbnail_url on split pages' gallery_images (and their
 * detected_images subdocs), then re-run the backfill which will correctly use cropped_photo.
 *
 * Usage:
 *   node scripts/maintenance/regen-split-gallery-images.mjs --dry-run
 *   node scripts/maintenance/regen-split-gallery-images.mjs --clear
 *   node scripts/maintenance/regen-split-gallery-images.mjs --regenerate [--base-url URL]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const clear = args.includes('--clear');
const regenerate = args.includes('--regenerate');
const baseUrl = args.find(a => a.startsWith('--base-url='))?.split('=')[1]
  || args[args.indexOf('--base-url') + 1]
  || 'https://sourcelibrary.org';

async function getClient() {
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 300000,
    maxPoolSize: 5,
    retryReads: true,
    retryWrites: true,
  });
  await client.connect();
  return client;
}

// Collect split page IDs in batches via streaming cursor
async function collectSplitPageIds(db) {
  console.log('Streaming split page IDs...');
  const ids = [];
  const cursor = db.collection('pages')
    .find({ split_from: { $exists: true } })
    .project({ id: 1, _id: 0 })
    .batchSize(2000);

  for await (const doc of cursor) {
    ids.push(doc.id);
    if (ids.length % 20000 === 0) {
      process.stdout.write(`\r  Collected ${ids.length} split page IDs...`);
    }
  }
  console.log(`\r  Collected ${ids.length} split page IDs total`);
  return ids;
}

async function main() {
  const client = await getClient();
  const db = client.db('bookstore');

  try {
    const splitPageIds = await collectSplitPageIds(db);

    if (dryRun) {
      // Count gallery_images on split pages that have extracted_url
      console.log('Counting gallery_images on split pages with extracted_url...');
      let total = 0;
      for (let i = 0; i < splitPageIds.length; i += 1000) {
        const chunk = splitPageIds.slice(i, i + 1000);
        const count = await db.collection('gallery_images').countDocuments({
          page_id: { $in: chunk },
          extracted_url: { $exists: true }
        });
        total += count;
        if (i % 10000 === 0 && i > 0) {
          process.stdout.write(`\r  Checked ${i}/${splitPageIds.length} pages (${total} gallery images so far)...`);
        }
      }
      console.log(`\nFound ${total} gallery_images on split pages to regenerate`);

      const sample = await db.collection('gallery_images')
        .find({ page_id: { $in: splitPageIds.slice(0, 200) }, extracted_url: { $exists: true } })
        .project({ page_id: 1, book_id: 1, extracted_url: 1 })
        .limit(5)
        .toArray();
      for (const g of sample) {
        console.log(`  page=${g.page_id} book=${g.book_id} url=${(g.extracted_url || '').slice(0, 60)}...`);
      }
      return;
    }

    if (clear) {
      // 1. Clear gallery_images
      console.log('\nClearing gallery_images extracted_url/thumbnail_url...');
      let galCleared = 0;
      for (let i = 0; i < splitPageIds.length; i += 500) {
        const chunk = splitPageIds.slice(i, i + 500);
        try {
          const result = await db.collection('gallery_images').updateMany(
            { page_id: { $in: chunk }, extracted_url: { $exists: true } },
            { $unset: { extracted_url: '', thumbnail_url: '' } }
          );
          galCleared += result.modifiedCount;
        } catch (err) {
          console.error(`\n  Batch ${i} failed: ${err.message}, retrying...`);
          await new Promise(r => setTimeout(r, 3000));
          const result = await db.collection('gallery_images').updateMany(
            { page_id: { $in: chunk }, extracted_url: { $exists: true } },
            { $unset: { extracted_url: '', thumbnail_url: '' } }
          );
          galCleared += result.modifiedCount;
        }
        if (i % 5000 === 0) {
          process.stdout.write(`\r  Cleared ${galCleared} gallery_images (${i + chunk.length}/${splitPageIds.length} pages)...`);
        }
      }
      console.log(`\n  Done: cleared ${galCleared} gallery_images`);

      // 2. Clear pages.detected_images[*].extracted_url using arrayFilters
      console.log('\nClearing pages detected_images extracted_url/thumbnail_url...');
      let pageCleared = 0;
      for (let i = 0; i < splitPageIds.length; i += 500) {
        const chunk = splitPageIds.slice(i, i + 500);
        try {
          const result = await db.collection('pages').updateMany(
            {
              id: { $in: chunk },
              'detected_images.extracted_url': { $exists: true }
            },
            {
              $unset: {
                'detected_images.$[elem].extracted_url': '',
                'detected_images.$[elem].thumbnail_url': ''
              }
            },
            {
              arrayFilters: [{ 'elem.extracted_url': { $exists: true } }]
            }
          );
          pageCleared += result.modifiedCount;
        } catch (err) {
          console.error(`\n  Batch ${i} failed: ${err.message}, retrying...`);
          await new Promise(r => setTimeout(r, 3000));
          const result = await db.collection('pages').updateMany(
            {
              id: { $in: chunk },
              'detected_images.extracted_url': { $exists: true }
            },
            {
              $unset: {
                'detected_images.$[elem].extracted_url': '',
                'detected_images.$[elem].thumbnail_url': ''
              }
            },
            {
              arrayFilters: [{ 'elem.extracted_url': { $exists: true } }]
            }
          );
          pageCleared += result.modifiedCount;
        }
        if (i % 5000 === 0) {
          process.stdout.write(`\r  Cleared ${pageCleared} pages (${i + chunk.length}/${splitPageIds.length} checked)...`);
        }
      }
      console.log(`\n  Done: cleared ${pageCleared} pages`);
      return;
    }

    if (regenerate) {
      console.log(`\nRegenerating gallery images via ${baseUrl}/api/admin/generate-gallery-thumbnails`);
      console.log('This will process 200 pages per request...\n');

      const authToken = process.env.ADMIN_API_KEY || process.env.NEXTAUTH_SECRET;
      let totalProcessed = 0;
      let round = 0;
      let consecutiveEmpty = 0;

      while (true) {
        round++;
        try {
          const resp = await fetch(`${baseUrl}/api/admin/generate-gallery-thumbnails?limit=200`, {
            method: 'POST',
            headers: {
              'Cookie': `next-auth.session-token=${authToken}`,
              'Content-Type': 'application/json',
            }
          });

          const data = await resp.json();

          if (data.pagesScanned === 0 || (data.processed === 0 && ++consecutiveEmpty >= 3)) {
            console.log(`\nDone! Total processed: ${totalProcessed} across ${round} rounds`);
            break;
          }
          if (data.processed > 0) consecutiveEmpty = 0;

          totalProcessed += data.processed || 0;
          console.log(`Round ${round}: scanned ${data.pagesScanned}, processed ${data.processed}, failed ${data.failed} (total: ${totalProcessed})`);

          if (data.errors?.length > 0) {
            console.log(`  Errors: ${data.errors.slice(0, 3).join(', ')}`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
          console.error(`Round ${round} failed:`, err.message);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      return;
    }

    console.log('\nUsage:');
    console.log('  --dry-run     Count affected pages');
    console.log('  --clear       Clear stale gallery data (step 1)');
    console.log('  --regenerate  Regenerate via API (step 2)');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
