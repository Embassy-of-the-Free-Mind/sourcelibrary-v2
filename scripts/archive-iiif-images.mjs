/**
 * Archive images from IIIF sources (Vatican, Gallica, Bodleian) to Vercel Blob
 * This speeds up OCR by having all images in fast storage
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { MongoClient } from 'mongodb';
import { put } from '@vercel/blob';

const BATCH_SIZE = 10; // Pages per batch
const DELAY_MS = 200; // Delay between batches

async function archiveIiifImages() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Archiving IIIF Images to Vercel Blob ===\n');

  // Find pages with IIIF sources that need archiving
  const iiifPatterns = [
    'digi.vatlib',              // Vatican
    'gallica',                  // Gallica (BnF)
    'bodleian',                 // Bodleian
    'digital.bodleian',
    'digitale-sammlungen',      // MDZ/BSB (Bavarian State Library)
    'iiif'                      // Other IIIF
  ];

  // Build regex pattern
  const regexPattern = iiifPatterns.join('|');

  const query = {
    // Has an IIIF source image
    photo: { $regex: regexPattern, $options: 'i' },
    // Not already archived
    $or: [
      { archived_photo: { $exists: false } },
      { archived_photo: null },
      { archived_photo: '' }
    ]
  };

  const totalCount = await db.collection('pages').countDocuments(query);
  console.log(`Found ${totalCount} IIIF pages needing archiving\n`);

  if (totalCount === 0) {
    console.log('Nothing to archive!');
    await client.close();
    return;
  }

  let archived = 0;
  let failed = 0;
  let totalBytes = 0;

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
          const response = await fetch(sourceUrl);
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
            allowOverwrite: true,
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
        console.log(`  Failed: ${r.pageId} - ${r.error}`);
      }
    }

    const remaining = totalCount - archived - failed;
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    console.log(`Archived: ${archived} | Failed: ${failed} | Remaining: ~${remaining} | Size: ${mb}MB`);

    // Delay between batches
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n=== Complete ===`);
  console.log(`Archived: ${archived}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total size: ${(totalBytes / (1024 * 1024)).toFixed(1)}MB`);

  await client.close();
}

archiveIiifImages().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
