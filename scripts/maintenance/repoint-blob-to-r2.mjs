#!/usr/bin/env node
/**
 * Repoint page URL fields from Vercel Blob → existing R2 URLs.
 *
 * Files are already on R2 (archived_photo, cropped_photo, thumbnail_blob).
 * This script updates photo, photo_original, and thumbnail to point to R2.
 *
 * NO file transfers — pure MongoDB updates.
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/repoint-blob-to-r2.mjs
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/repoint-blob-to-r2.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

async function main() {
  console.log(`Repoint Blob → R2 (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`);

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const pages = db.collection('pages');

  // Phase 1: Update photo → cropped_photo (R2) where cropped_photo exists on R2
  console.log('\nPhase 1: photo → cropped_photo (for split pages with R2 crops)');
  const phase1 = await countAndUpdate(pages, {
    filter: {
      photo: { $regex: 'blob\\.vercel-storage' },
      cropped_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    update: [{ $set: { photo: '$cropped_photo' } }],
    label: 'photo → cropped_photo',
  });

  // Phase 2: photo → archived_photo (R2) for remaining Blob pages
  console.log('\nPhase 2: photo → archived_photo (for pages without R2 crop)');
  const phase2 = await countAndUpdate(pages, {
    filter: {
      photo: { $regex: 'blob\\.vercel-storage' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    update: [{ $set: { photo: '$archived_photo' } }],
    label: 'photo → archived_photo',
  });

  // Phase 3: photo_original → archived_photo (R2)
  console.log('\nPhase 3: photo_original → archived_photo');
  const phase3 = await countAndUpdate(pages, {
    filter: {
      photo_original: { $regex: 'blob\\.vercel-storage' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    update: [{ $set: { photo_original: '$archived_photo' } }],
    label: 'photo_original → archived_photo',
  });

  // Phase 4: thumbnail → thumbnail_blob (R2)
  console.log('\nPhase 4: thumbnail → thumbnail_blob');
  const phase4 = await countAndUpdate(pages, {
    filter: {
      thumbnail: { $regex: 'blob\\.vercel-storage' },
      thumbnail_blob: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    update: [{ $set: { thumbnail: '$thumbnail_blob' } }],
    label: 'thumbnail → thumbnail_blob',
  });

  // Phase 5: S3 photo → archived_photo (for old BPH books)
  console.log('\nPhase 5: S3 photo → archived_photo');
  const phase5 = await countAndUpdate(pages, {
    filter: {
      photo: { $regex: 'book-translation-data\\.s3' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    update: [{ $set: { photo: '$archived_photo' } }],
    label: 'S3 photo → archived_photo',
  });

  // Phase 6: Book thumbnails on Blob
  console.log('\nPhase 6: book.thumbnail → R2');
  const books = db.collection('books');
  const blobBooks = await books.countDocuments({ thumbnail: { $regex: 'blob\\.vercel-storage' } });
  console.log(`  Books with Blob thumbnail: ${blobBooks}`);
  // For books, we need to find the first page's R2 URL
  if (!DRY_RUN && blobBooks > 0) {
    const cursor = books.find({ thumbnail: { $regex: 'blob\\.vercel-storage' } })
      .project({ _id: 1, id: 1, thumbnail: 1 }).batchSize(100);
    let updated = 0;
    for await (const book of cursor) {
      const firstPage = await pages.findOne(
        { book_id: book.id },
        { projection: { cropped_photo: 1, archived_photo: 1, photo: 1 }, sort: { page_number: 1 } }
      );
      const newThumb = firstPage?.cropped_photo || firstPage?.archived_photo || firstPage?.photo;
      if (newThumb && !newThumb.includes('blob.vercel-storage')) {
        await books.updateOne({ _id: book._id }, { $set: { thumbnail: newThumb } });
        updated++;
      }
      if (updated % 100 === 0 && updated > 0) console.log(`  ${updated} book thumbnails updated`);
    }
    console.log(`  Done: ${updated} book thumbnails repointed`);
  }

  // Summary: check what's left
  console.log('\n=== Remaining Blob references ===');
  const remainPhoto = await pages.countDocuments({ photo: { $regex: 'blob\\.vercel-storage' } });
  const remainOriginal = await pages.countDocuments({ photo_original: { $regex: 'blob\\.vercel-storage' } });
  const remainThumb = await pages.countDocuments({ thumbnail: { $regex: 'blob\\.vercel-storage' } });
  const remainS3 = await pages.countDocuments({ photo: { $regex: 'book-translation-data\\.s3' } });
  console.log(`  photo on Blob: ${remainPhoto}`);
  console.log(`  photo_original on Blob: ${remainOriginal}`);
  console.log(`  thumbnail on Blob: ${remainThumb}`);
  console.log(`  photo on old S3: ${remainS3}`);

  await client.close();
}

async function countAndUpdate(collection, { filter, update, label }) {
  const count = await collection.countDocuments(filter);
  console.log(`  Matching: ${count}`);
  if (count === 0) return 0;
  if (DRY_RUN) {
    console.log(`  DRY RUN: would update ${count} pages`);
    return count;
  }
  const result = await collection.updateMany(filter, update);
  console.log(`  Updated: ${result.modifiedCount} (${label})`);
  return result.modifiedCount;
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
