/**
 * Archive images for all pages that have OCR data to Vercel Blob
 * Ensures OCR'd content always has fast, reliable image access
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { put } from '@vercel/blob';

const BATCH_SIZE = 10; // Pages per batch
const DELAY_MS = 200; // Delay between batches

async function archiveOcrImages() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Archiving OCR Image Assets to Vercel Blob ===\n');

  // Find pages with OCR data that need archiving
  const query = {
    // Has OCR data
    'ocr.data': { $exists: true, $ne: null, $ne: '' },
    // Has an image source
    photo: { $exists: true, $ne: null, $ne: '' },
    // Not already archived
    $or: [
      { archived_photo: { $exists: false } },
      { archived_photo: null },
      { archived_photo: '' }
    ]
  };

  const totalCount = await db.collection('pages').countDocuments(query);
  console.log(`Found ${totalCount} OCR'd pages needing image archiving\n`);

  if (totalCount === 0) {
    console.log('Nothing to archive!');
    await client.close();
    return;
  }

  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let startTime = Date.now();

  // Process in batches
  while (true) {
    const pages = await db.collection('pages')
      .find(query)
      .limit(BATCH_SIZE)
      .toArray();

    if (pages.length === 0) break;

    // Process batch in parallel
    const results = await Promise.all(
      pages.map(async (page) => {
        const sourceUrl = page.photo;

        try {
          // Download image
          const response = await fetch(sourceUrl, { timeout: 30000 });
          if (!response.ok) {
            return { success: false, pageId: page.id, error: `HTTP ${response.status}` };
          }

          const buffer = await response.arrayBuffer();
          const bytes = buffer.byteLength;

          // Upload to Vercel Blob
          const filename = `archived/${page.book_id}/${page.page_number}.jpg`;
          const blob = await put(filename, Buffer.from(buffer), {
            access: 'public',
            contentType: response.headers.get('content-type') || 'image/jpeg',
            addRandomSuffix: false,
          });

          // Update page record
          await db.collection('pages').updateOne(
            { id: page.id },
            {
              $set: {
                archived_photo: blob.url,
                'archive_metadata.archived_at': new Date(),
                'archive_metadata.source_url': sourceUrl,
                'archive_metadata.bytes': bytes,
                updated_at: new Date()
              }
            }
          );

          return { success: true, pageId: page.id, bytes };
        } catch (error) {
          // Skip "already exists" errors - page was already archived
          if (error.message.includes('already exists')) {
            return { success: true, pageId: page.id, bytes: 0, skipped: true };
          }
          return {
            success: false,
            pageId: page.id,
            error: error.message
          };
        }
      })
    );

    // Count results
    for (const r of results) {
      if (r.success) {
        archived++;
        totalBytes += r.bytes;
      } else {
        failed++;
        if (failed <= 5) {
          console.log(`  Failed: ${r.pageId} - ${r.error}`);
        }
      }
    }

    const remaining = totalCount - archived - failed;
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    const rate = (archived / ((Date.now() - startTime) / 1000)).toFixed(1);
    console.log(`Archived: ${archived} | Failed: ${failed} | Remaining: ~${remaining} | Size: ${mb}MB | Rate: ${rate} pages/sec`);

    // Delay between batches
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Complete ===`);
  console.log(`Archived: ${archived}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total size: ${(totalBytes / (1024 * 1024)).toFixed(1)}MB`);
  console.log(`Duration: ${duration}s`);

  await client.close();
}

archiveOcrImages().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
