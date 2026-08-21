#!/usr/bin/env node
/**
 * Migrate remaining Vercel Blob stragglers to R2 (actual file transfers).
 * Handles pages where no R2 copy exists yet.
 *
 * Run on Hetzner:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/migrate-blob-stragglers.mjs
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const CONCURRENCY = 10;
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

async function uploadR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx]); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  console.log('Migrate Blob stragglers → R2');
  console.log('Start:', new Date().toISOString());

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const books = db.collection('books');

  let transferred = 0;
  let errors = 0;

  // Phase 1: Pages with photo still on Blob (no R2 archived_photo or cropped_photo)
  console.log('\nPhase 1: photo on Blob — transfer to R2');
  const blobPhotos = await pages.find({
    photo: { $regex: 'blob\\.vercel-storage' },
  }).project({ _id: 1, book_id: 1, page_number: 1, photo: 1 }).toArray();
  console.log(`  Found: ${blobPhotos.length}`);

  const photoResults = await parallelMap(blobPhotos, async (page) => {
    const key = `archived/${page.book_id}/${String(page.page_number).padStart(4, '0')}.jpg`;
    assertBookScopedKey(key, page.book_id, 'migrate-blob-stragglers');
    const { buffer, contentType } = await download(page.photo);
    const newUrl = await uploadR2(key, buffer, contentType);
    await pages.updateOne({ _id: page._id }, { $set: {
      photo: newUrl,
      archived_photo: newUrl,
    }});
    return { ok: true };
  }, CONCURRENCY);
  const p1ok = photoResults.filter(r => r?.ok).length;
  const p1err = photoResults.filter(r => r?.error).length;
  transferred += p1ok;
  errors += p1err;
  console.log(`  Transferred: ${p1ok}, Errors: ${p1err}`);

  // Phase 2: photo_original still on Blob
  console.log('\nPhase 2: photo_original on Blob — transfer to R2');
  const blobOriginals = await pages.find({
    photo_original: { $regex: 'blob\\.vercel-storage' },
  }).project({ _id: 1, book_id: 1, page_number: 1, photo_original: 1, archived_photo: 1 }).toArray();
  console.log(`  Found: ${blobOriginals.length}`);

  const origResults = await parallelMap(blobOriginals, async (page) => {
    // If archived_photo exists on R2, just repoint
    if (page.archived_photo?.includes('images.sourcelibrary.org')) {
      await pages.updateOne({ _id: page._id }, { $set: { photo_original: page.archived_photo } });
      return { ok: true, repoint: true };
    }
    // Otherwise transfer the file
    const key = `uploads/${page.book_id}/${String(page.page_number).padStart(4, '0')}-original.jpg`;
    const { buffer, contentType } = await download(page.photo_original);
    const newUrl = await uploadR2(key, buffer, contentType);
    await pages.updateOne({ _id: page._id }, { $set: { photo_original: newUrl } });
    return { ok: true };
  }, CONCURRENCY);
  const p2ok = origResults.filter(r => r?.ok).length;
  const p2repoint = origResults.filter(r => r?.repoint).length;
  const p2err = origResults.filter(r => r?.error).length;
  transferred += p2ok;
  errors += p2err;
  console.log(`  Done: ${p2ok} (${p2repoint} repointed, ${p2ok - p2repoint} transferred), Errors: ${p2err}`);

  // Phase 3: thumbnail still on Blob
  console.log('\nPhase 3: thumbnail on Blob — transfer to R2');
  const blobThumbs = await pages.find({
    thumbnail: { $regex: 'blob\\.vercel-storage' },
  }).project({ _id: 1, book_id: 1, page_number: 1, thumbnail: 1, thumbnail_blob: 1 }).toArray();
  console.log(`  Found: ${blobThumbs.length}`);

  const thumbResults = await parallelMap(blobThumbs, async (page) => {
    if (page.thumbnail_blob?.includes('images.sourcelibrary.org')) {
      await pages.updateOne({ _id: page._id }, { $set: { thumbnail: page.thumbnail_blob } });
      return { ok: true, repoint: true };
    }
    const key = `thumbnails/${page.book_id}/${String(page.page_number).padStart(4, '0')}.jpg`;
    const { buffer, contentType } = await download(page.thumbnail);
    const newUrl = await uploadR2(key, buffer, contentType);
    await pages.updateOne({ _id: page._id }, { $set: { thumbnail: newUrl, thumbnail_blob: newUrl } });
    return { ok: true };
  }, CONCURRENCY);
  const p3ok = thumbResults.filter(r => r?.ok).length;
  const p3repoint = thumbResults.filter(r => r?.repoint).length;
  const p3err = thumbResults.filter(r => r?.error).length;
  transferred += p3ok;
  errors += p3err;
  console.log(`  Done: ${p3ok} (${p3repoint} repointed, ${p3ok - p3repoint} transferred), Errors: ${p3err}`);

  // Phase 4: Book thumbnails on Blob
  console.log('\nPhase 4: book thumbnails on Blob');
  const blobBookThumbs = await books.find({
    thumbnail: { $regex: 'blob\\.vercel-storage' },
  }).project({ _id: 1, id: 1, thumbnail: 1 }).toArray();
  console.log(`  Found: ${blobBookThumbs.length}`);

  for (const book of blobBookThumbs) {
    // Try to find an R2 URL from the first page
    const firstPage = await pages.findOne(
      { book_id: book.id },
      { projection: { cropped_photo: 1, archived_photo: 1, photo: 1 }, sort: { page_number: 1 } }
    );
    const r2Url = firstPage?.cropped_photo || firstPage?.archived_photo || firstPage?.photo;
    if (r2Url && !r2Url.includes('blob.vercel-storage')) {
      await books.updateOne({ _id: book._id }, { $set: { thumbnail: r2Url } });
      transferred++;
    } else if (book.thumbnail) {
      // Transfer the thumbnail itself
      try {
        const key = `book-thumbnails/${book.id}.jpg`;
        const { buffer, contentType } = await download(book.thumbnail);
        const newUrl = await uploadR2(key, buffer, contentType);
        await books.updateOne({ _id: book._id }, { $set: { thumbnail: newUrl } });
        transferred++;
      } catch (e) {
        console.log(`  FAIL book ${book.id}: ${e.message}`);
        errors++;
      }
    }
  }
  console.log(`  Done`);

  // Final check
  console.log('\n=== Final Blob/S3 references ===');
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
  const blobBooksRemain = await books.countDocuments({ thumbnail: { $regex: 'blob\\.vercel-storage' } });
  console.log(`  book thumbnails on Blob: ${blobBooksRemain}`);

  console.log(`\nTotal: ${transferred} transferred/repointed, ${errors} errors`);
  console.log('Done:', new Date().toISOString());
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
