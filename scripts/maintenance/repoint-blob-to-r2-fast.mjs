#!/usr/bin/env node
/**
 * Repoint page URL fields from Vercel Blob → existing R2 URLs.
 * Fast version — skips counting, just runs updateMany directly.
 *
 * NO file transfers — pure MongoDB updates.
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/repoint-blob-to-r2-fast.mjs
 */

import { MongoClient } from 'mongodb';

async function main() {
  console.log('Repoint Blob → R2 (LIVE)');
  console.log('Start:', new Date().toISOString());

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const books = db.collection('books');

  // Phase 1: photo → cropped_photo (for split pages with R2 crops)
  console.log('\nPhase 1: photo → cropped_photo');
  const r1 = await pages.updateMany(
    {
      photo: { $regex: 'blob\\.vercel-storage' },
      cropped_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    [{ $set: { photo: '$cropped_photo' } }]
  );
  console.log(`  Updated: ${r1.modifiedCount}`);

  // Phase 2: photo → archived_photo (remaining Blob pages without R2 crop)
  console.log('\nPhase 2: photo → archived_photo');
  const r2 = await pages.updateMany(
    {
      photo: { $regex: 'blob\\.vercel-storage' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    [{ $set: { photo: '$archived_photo' } }]
  );
  console.log(`  Updated: ${r2.modifiedCount}`);

  // Phase 3: photo_original → archived_photo
  console.log('\nPhase 3: photo_original → archived_photo');
  const r3 = await pages.updateMany(
    {
      photo_original: { $regex: 'blob\\.vercel-storage' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    [{ $set: { photo_original: '$archived_photo' } }]
  );
  console.log(`  Updated: ${r3.modifiedCount}`);

  // Phase 4: thumbnail → thumbnail_blob
  console.log('\nPhase 4: thumbnail → thumbnail_blob');
  const r4 = await pages.updateMany(
    {
      thumbnail: { $regex: 'blob\\.vercel-storage' },
      thumbnail_blob: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    [{ $set: { thumbnail: '$thumbnail_blob' } }]
  );
  console.log(`  Updated: ${r4.modifiedCount}`);

  // Phase 5: S3 photo → archived_photo (old BPH books)
  console.log('\nPhase 5: S3 photo → archived_photo');
  const r5 = await pages.updateMany(
    {
      photo: { $regex: 'book-translation-data\\.s3' },
      archived_photo: { $regex: 'images\\.sourcelibrary\\.org' },
    },
    [{ $set: { photo: '$archived_photo' } }]
  );
  console.log(`  Updated: ${r5.modifiedCount}`);

  // Phase 6: Book thumbnails
  console.log('\nPhase 6: book thumbnails');
  const cursor = books.find({ thumbnail: { $regex: 'blob\\.vercel-storage' } })
    .project({ _id: 1, id: 1 }).batchSize(200);
  let bookUpdated = 0;
  for await (const book of cursor) {
    const firstPage = await pages.findOne(
      { book_id: book.id },
      { projection: { cropped_photo: 1, archived_photo: 1, photo: 1 }, sort: { page_number: 1 } }
    );
    const newThumb = firstPage?.cropped_photo || firstPage?.archived_photo || firstPage?.photo;
    if (newThumb && !newThumb.includes('blob.vercel-storage') && !newThumb.includes('book-translation-data.s3')) {
      await books.updateOne({ _id: book._id }, { $set: { thumbnail: newThumb } });
      bookUpdated++;
    }
    if (bookUpdated % 200 === 0 && bookUpdated > 0) console.log(`  ${bookUpdated} book thumbnails...`);
  }
  console.log(`  Updated: ${bookUpdated} book thumbnails`);

  // Verify
  console.log('\n=== Remaining Blob/S3 references ===');
  // Use aggregation for faster counting
  const remaining = await pages.aggregate([
    { $facet: {
      blobPhoto: [{ $match: { photo: { $regex: 'blob\\.vercel-storage' } } }, { $count: 'n' }],
      blobOriginal: [{ $match: { photo_original: { $regex: 'blob\\.vercel-storage' } } }, { $count: 'n' }],
      blobThumb: [{ $match: { thumbnail: { $regex: 'blob\\.vercel-storage' } } }, { $count: 'n' }],
      s3Photo: [{ $match: { photo: { $regex: 'book-translation-data\\.s3' } } }, { $count: 'n' }],
    }}
  ]).toArray();
  const r = remaining[0];
  console.log(`  photo on Blob: ${r.blobPhoto[0]?.n || 0}`);
  console.log(`  photo_original on Blob: ${r.blobOriginal[0]?.n || 0}`);
  console.log(`  thumbnail on Blob: ${r.blobThumb[0]?.n || 0}`);
  console.log(`  photo on S3: ${r.s3Photo[0]?.n || 0}`);

  const blobBooks = await books.countDocuments({ thumbnail: { $regex: 'blob\\.vercel-storage' } });
  console.log(`  book thumbnails on Blob: ${blobBooks}`);

  console.log('\nDone:', new Date().toISOString());
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
