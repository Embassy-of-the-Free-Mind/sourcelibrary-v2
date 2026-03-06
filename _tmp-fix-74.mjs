import { MongoClient } from 'mongodb';
import { put } from '@vercel/blob';

async function checkUrl(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000), redirect: 'follow' });
    return resp.status < 400;
  } catch {
    return false;
  }
}

async function downloadAndUpload(url, bookId, pageNum) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const blob = await put(`thumbnails/${bookId}/${pageNum}.jpg`, buffer, {
    access: 'public',
    contentType: 'image/jpeg',
    addRandomSuffix: false,
  });
  return blob.url;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Phase 1: Find books with broken IA/Harvard thumbnails
  const books = await db.collection('books').find({
    $or: [
      { thumbnail: { $regex: /archive\.org\/download/ } },
      { thumbnail: { $regex: /ids\.lib\.harvard\.edu/ } },
    ],
    pages_count: { $gt: 0 },
  }).project({ title: 1, thumbnail: 1, id: 1, pages_count: 1, _id: 0 }).toArray();

  console.log(`Checking ${books.length} external thumbnails...`);

  // Check which thumbnails are broken (parallel batches of 30)
  const brokenBooks = [];
  const BATCH = 30;
  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(b => checkUrl(b.thumbnail)));
    for (let j = 0; j < batch.length; j++) {
      if (!results[j]) brokenBooks.push(batch[j]);
    }
  }
  console.log(`Found ${brokenBooks.length} broken thumbnails`);

  // Phase 2: For each broken book, check if local page images exist (quick check)
  const noLocalImages = [];
  for (const book of brokenBooks) {
    const localPage = await db.collection('pages').findOne(
      { book_id: book.id, $or: [
        { thumbnail_blob: { $exists: true, $ne: null, $ne: '' } },
        { cropped_photo: { $exists: true, $ne: null, $ne: '' } },
        { archived_photo: { $exists: true, $ne: null, $ne: '' } },
      ]},
      { projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1, _id: 0 } }
    );
    if (localPage) {
      // Has local images — fix thumbnail from local
      const url = localPage.thumbnail_blob || localPage.cropped_photo || localPage.archived_photo;
      await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail: url } });
      console.log(`FIXED (local): ${book.title?.substring(0, 60)}`);
    } else {
      noLocalImages.push(book);
    }
  }

  console.log(`\n${noLocalImages.length} books have NO local page images. Trying to fetch from IA...`);

  // Phase 3: For books without local images, try to download a page image from IA
  let downloaded = 0;
  let iaBlocked = 0;
  const stillBroken = [];

  for (const book of noLocalImages) {
    // Find best page to use as thumbnail
    let page = await db.collection('pages').findOne(
      { book_id: book.id, page_type: 'title-page' },
      { projection: { page_number: 1, photo: 1, photo_original: 1, _id: 0 } }
    );
    if (!page) {
      page = await db.collection('pages').findOne(
        { book_id: book.id, page_type: 'frontispiece' },
        { projection: { page_number: 1, photo: 1, photo_original: 1, _id: 0 } }
      );
    }
    if (!page) {
      page = await db.collection('pages').findOne(
        { book_id: book.id },
        { sort: { page_number: 1 }, skip: 1, projection: { page_number: 1, photo: 1, photo_original: 1, _id: 0 } }
      );
    }
    if (!page) {
      page = await db.collection('pages').findOne(
        { book_id: book.id },
        { sort: { page_number: 1 }, projection: { page_number: 1, photo: 1, photo_original: 1, _id: 0 } }
      );
    }

    const imageUrl = page?.photo_original || page?.photo;
    if (!imageUrl) {
      console.log(`  NO PAGES: ${book.title?.substring(0, 60)}`);
      stillBroken.push({ ...book, reason: 'no page images' });
      continue;
    }

    // Try to download the image
    const accessible = await checkUrl(imageUrl);
    if (!accessible) {
      // IA blocked — try a smaller size variant
      const smallUrl = imageUrl.replace(/\/full\/pct:\d+\//, '/full/pct:10/');
      const smallAccessible = await checkUrl(smallUrl);
      if (!smallAccessible) {
        console.log(`  IA BLOCKED: ${book.title?.substring(0, 60)} | ${imageUrl.substring(0, 80)}`);
        stillBroken.push({ ...book, reason: 'ia_blocked', url: imageUrl });
        iaBlocked++;
        continue;
      }
    }

    // Download and upload to Vercel Blob
    try {
      const fetchUrl = accessible ? imageUrl : imageUrl.replace(/\/full\/pct:\d+\//, '/full/pct:10/');
      const blobUrl = await downloadAndUpload(fetchUrl, book.id, page.page_number || 1);
      await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail: blobUrl } });
      // Also set thumbnail_blob on the page
      await db.collection('pages').updateOne(
        { book_id: book.id, page_number: page.page_number },
        { $set: { thumbnail_blob: blobUrl } }
      );
      downloaded++;
      console.log(`  DOWNLOADED: ${book.title?.substring(0, 60)}`);
    } catch (err) {
      console.log(`  DOWNLOAD FAILED: ${book.title?.substring(0, 60)} | ${err.message}`);
      stillBroken.push({ ...book, reason: 'download_failed', error: err.message });
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Total broken thumbnails: ${brokenBooks.length}`);
  console.log(`Fixed from local images: ${brokenBooks.length - noLocalImages.length}`);
  console.log(`Downloaded from IA: ${downloaded}`);
  console.log(`IA blocked: ${iaBlocked}`);
  console.log(`Still broken: ${stillBroken.length}`);

  if (stillBroken.length > 0) {
    console.log(`\nStill broken:`);
    for (const b of stillBroken) {
      console.log(`  ${b.reason} | ${b.title?.substring(0, 70)}`);
    }
  }

  await client.close();
}

main();
